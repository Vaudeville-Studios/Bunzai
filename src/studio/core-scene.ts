/** New scenes may use rp-core as the turn engine while Bunzai keeps its scene projection. */
import { Engine, createAnthropicProvider, createOpenAIChatProvider, resolveCaps } from "rp-core";
import { messageFormatCaps } from "../kit/providers/message-format";
import type { Character, Connection, Persona, PromptMsg } from "rp-core";
import type { AsyncSessionHandle, RecordStore } from "rp-core";
import { bodyOf, isRecord, recOr, str } from "../core/guards";
import type { ChatConnection, ChatStore } from "../stage/contracts/chat-store";
import type { CoreSceneRecords } from "../stage/store/sqlite/core-record-store";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import { allowedHost, guardedFetch } from "../kit/providers/egress";
import { coreOllamaProvider } from "./core-ollama-provider";
import { spokes } from "../kit/providers/registry";
import { readVault } from "../kit/providers/vault";
import { providerConfigFingerprint } from "../kit/providers/config-fingerprint";
import { StudioValidationError } from "./errors";
import { StudioConflictError } from "./errors";
import type { ProviderRole } from "../stage/contracts/provider";
import { reconcileCoreProjection } from "./core-scene-projection";
import { playedBody } from "../entities/character/variant";
import type { CharacterBody } from "../entities/character/schema";
import { withUserGuides, type CoreSceneLibrary } from "./core-library";

/** The session config a Core scene's own settings call for, as a patch of what changed (journaled only then). */
function scenePatch(current: { preset?: string; lorebooks?: readonly string[]; narrator?: { maxRounds?: number } }, scene: CoreSceneLibrary | undefined) {
  if (!scene) return {};
  return {
    ...(current.preset !== scene.config.preset ? { preset: scene.config.preset } : {}),
    ...(JSON.stringify(current.lorebooks ?? []) !== JSON.stringify(scene.config.lorebooks) ? { lorebooks: scene.config.lorebooks } : {}),
    ...(scene.toolRounds !== undefined && current.narrator?.maxRounds !== scene.toolRounds ? { narrator: { maxRounds: scene.toolRounds } } : {}),
  };
}

/** The card rp-core plays: the scene's snapshot, as the scene's chosen alt-art variant when it has one (ChatStore rule 27). */
function coreCharacter(source: unknown, variantId?: string | null): Character {
  const body = variantId ? playedBody(bodyOf(source) as unknown as CharacterBody, variantId) as unknown as Record<string, unknown> : bodyOf(source);
  const identity = recOr(body["identity"]);
  const persona = recOr(body["persona"]);
  const prompts = recOr(body["prompts"]);
  const greetings = recOr(body["greetings"]);
  const examples = recOr(body["examples"]);
  return {
    name: str(identity["name"]), description: str(identity["description"]),
    ...(str(persona["personality"]) ? { personality: str(persona["personality"]) } : {}),
    ...(str(persona["scenario"]) ? { scenario: str(persona["scenario"]) } : {}),
    greetings: [str(greetings["firstMessage"]), ...((Array.isArray(greetings["alternateGreetings"]) ? greetings["alternateGreetings"] : []).map((g) => str(recOr(g)["text"])))].filter(Boolean),
    ...(str(examples["exampleMessages"]) ? { examples: str(examples["exampleMessages"]) } : {}),
    ...(str(prompts["systemPrompt"]) ? { systemPrompt: str(prompts["systemPrompt"]) } : {}),
    ...(str(prompts["postHistoryInstructions"]) ? { postHistory: str(prompts["postHistoryInstructions"]) } : {}),
  };
}

function corePersona(source: unknown): Persona {
  const body = bodyOf(source);
  return { name: str(body["name"]), description: str(body["content"]) };
}

const NO_PERSONA: Persona = { name: "User", description: "" };
/** Key-order-free equality for the JSON rp-core validated and the JSON Bunzai built. */
const stable = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

/**
 * Moves rp-core's cast onto the scene's: a persona change, an updated or reverted card, an edit saved
 * through the scene, an alt-art variant. Writes only what differs, so a turn can call it every time.
 */
export async function syncCoreCast(chats: ChatStore, sceneId: string, session: AsyncSessionHandle): Promise<void> {
  const chat = await chats.getChat(sceneId), snapshot = await chats.castSnapshot(sceneId);
  if (!chat || !snapshot) throw new StudioValidationError("the scene is gone");
  const cast = (await session.header()).cast;
  const character = coreCharacter(snapshot.character, chat.variantId);
  if (stable(cast.character) !== stable(character)) await session.setCharacter(character);
  const persona = snapshot.persona ? corePersona(snapshot.persona) : NO_PERSONA;
  const current = cast.persona ? { name: cast.persona.name, description: cast.persona.description } : NO_PERSONA;
  if (stable(current) !== stable(persona)) await session.setPersona(persona);
}

/** Uses the same pinned host and saved secret as Kit: native Anthropic, Ollama, or OpenAI-chat compatible. */
async function connectionFor(pick: ChatConnection): Promise<{ connection: Connection; fetch: typeof fetch; fingerprint: string }> {
  const saved = (await readVault()).providers.find((provider) => provider.id === pick.id);
  if (!saved) throw new StudioValidationError("the scene's Kit connection is gone");
  const catalog = await spokes();
  const spoke = catalog.get(saved.kind);
  if (!spoke?.scene) throw new StudioValidationError("this Kit connection cannot drive a scene");
  if ((spoke.scene.native && spoke.scene.native !== "anthropic") || (spoke.scene.resolve && saved.kind !== "ollama")) throw new StudioValidationError("this provider needs a native rp-core adapter");
  const baseUrl = spoke.scene.base({ ...saved, model: pick.model });
  if (!baseUrl) throw new StudioValidationError("this connection needs a base URL");
  const host = allowedHost(saved, spoke);
  if (new URL(baseUrl).host !== host) throw new StudioValidationError("the connection's host changed");
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(new URL(baseUrl).host);
  const origin = new URL(baseUrl).origin;
  const dialect = spoke.scene.native === "anthropic" ? "anthropic" as const : "openai-chat" as const;
  const format = dialect === "openai-chat" && saved.kind !== "ollama" && saved.baseURL ? messageFormatCaps(saved.messageFormat ?? { preset: "standard" }) : {};
  const caps = resolveCaps({ dialect, origin, local, model: pick.model, server: saved.kind, user: { ...format, ...(saved.context ? { contextLength: saved.context } : {}) } });
  if (saved.kind === "ollama" && spoke.scene.resolve) {
    const config = { ...saved, model: pick.model };
    const { provider: native, traits } = await spoke.scene.resolve(config, guardedFetch(host), saved.name ?? "Ollama");
    const ollamaCaps = {
      ...caps,
      ...(traits?.window ? { contextLength: traits.window } : {}),
      tools: traits?.tools ? "native" as const : "none" as const,
      midSystem: "native" as const,
      alternation: "free" as const,
      streamUsage: "always" as const,
      samplers: { ...caps.samplers, accepted: Array.from(new Set([...caps.samplers.accepted, "top_k", "min_p", "typical_p", "repetition_penalty"])) },
    };
    return { connection: { id: pick.id, provider: coreOllamaProvider(native), caps: ollamaCaps, origin, local, key: null }, fetch: guardedFetch(host), fingerprint: providerConfigFingerprint(saved, pick.model) };
  }
  return {
    connection: {
      id: pick.id,
      provider: dialect === "anthropic" ? createAnthropicProvider({ connectionId: pick.id, baseUrl, local }) : createOpenAIChatProvider({ connectionId: pick.id, baseUrl, local }),
      caps, origin, local, key: saved.apiKey ?? null,
    },
    fetch: guardedFetch(host), fingerprint: providerConfigFingerprint(saved, pick.model),
  };
}

/** One session creation per scene at a time: the start route and a finishing retry never race into two sessions. */
const creating = new Map<string, Promise<void>>();
export function createCoreSceneSession(chats: ChatStore, records: CoreSceneRecords, home: string, chatId: string): Promise<void> {
  const running = creating.get(chatId);
  if (running) return running;
  const created = createCoreSceneSessionOnce(chats, records, home, chatId).finally(() => creating.delete(chatId));
  creating.set(chatId, created);
  return created;
}

async function createCoreSceneSessionOnce(chats: ChatStore, records: CoreSceneRecords, home: string, chatId: string): Promise<void> {
  const snapshot = await chats.castSnapshot(chatId);
  const chat = await chats.getChat(chatId);
  if (!snapshot || !chat) throw new StudioValidationError("the new scene is gone");
  const engine = await Engine.openWithRecordStore({ home, recordStore: records.forHostSceneCreation(chatId, chat.activeBranchId), lane: "manual" });
  try {
    await engine.createSession({ character: coreCharacter(snapshot.character, chat.variantId), ...(snapshot.persona ? { persona: corePersona(snapshot.persona) } : {}), title: chat.title });
  } finally { await engine.close(); }
}

export const INCOMPLETE_CORE_SCENE_MESSAGE = "RP-Core scene creation is incomplete; legacy chat actions are blocked. Reopen the library to finish a committed Core header; if no header was committed, delete the empty scene and create it again.";

/**
 * resolveCoreScene for a host route: a scene the host created whose rp-core session header was never
 * written (a crash between the two steps) is finished here, so the person keeps the scene instead of
 * being told to delete it. A scene an extension created stays incomplete: only its reviewed
 * invocation may write that header.
 */
export async function ensureCoreScene(chats: ChatStore, records: CoreSceneRecords, home: string, sceneId: string): Promise<{ link: { sessionId: string; branchId: string } | null; incomplete: boolean }> {
  const resolved = await resolveCoreScene(records, sceneId);
  if (!resolved.incomplete || (await records.unlinkedBirth(sceneId))?.origin !== "host") return resolved;
  await createCoreSceneSession(chats, records, home, sceneId);
  return resolveCoreScene(records, sceneId);
}

export async function resolveCoreScene(records: CoreSceneRecords, sceneId: string): Promise<{ link: { sessionId: string; branchId: string } | null; incomplete: boolean }> {
  let link = await records.sceneFor(sceneId);
  if (link) return { link, incomplete: false };
  const accepted = await records.pendingCreation(sceneId);
  if (accepted) {
    await records.recoverCreation(accepted.operationId);
    link = await records.sceneFor(sceneId);
    if (link) return { link, incomplete: false };
  }
  return { link: null, incomplete: (await records.unlinkedBirth(sceneId)) !== null };
}

/** Creates and links an extension-approved Core scene under its durable birth authorization. */
export async function createExtensionCoreSceneSession(chats: ChatStore, records: CoreSceneRecords, home: string, chatId: string, takeId: string, commit: ExtensionCommitContext): Promise<void> {
  if (!commit.invocationId || commit.operation !== "scenes.create") throw new StudioValidationError("Core scene creation requires the approved scenes.create invocation");
  const chat = await chats.getChat(chatId), snapshot = await chats.castSnapshot(chatId);
  if (!chat || !snapshot || chat.activeBranchId !== takeId || await records.sceneFor(chatId)) throw new StudioConflictError("the approved scene birth is unavailable");
  const scoped = records.forExtension(commit, { operationId: commit.invocationId, sceneId: chatId, takeId, sessionId: null });
  const engine = await Engine.openWithRecordStore({ home, recordStore: scoped, lane: "manual" });
  try {
    const session = await engine.createSession({ character: coreCharacter(snapshot.character, chat.variantId), ...(snapshot.persona ? { persona: corePersona(snapshot.persona) } : {}), title: chat.title });
    try { await scoped.link(chatId, session.id, takeId); }
    catch (error) {
      const accepted = await records.pendingCreation(chatId);
      if (accepted?.operationId === commit.invocationId && accepted.sessionId === session.id) await records.recoverCreation(commit.invocationId);
      else throw error;
    }
  } finally { await engine.close(); }
}

export async function openCoreScene(records: CoreSceneRecords, home: string, sessionId: string, pick: ChatConnection, options: { recordStore?: RecordStore; configure?: boolean; scene?: CoreSceneLibrary } = {}) {
  const { connection, fetch, fingerprint } = await connectionFor(pick);
  const engine = await Engine.openWithRecordStore({ home, recordStore: options.recordStore ?? records, connections: { [connection.id]: connection }, fetch, lane: "manual",
    ...(options.scene ? { library: options.scene.library } : {}) });
  try {
    const session = await engine.session(sessionId);
    if (options.configure !== false) {
      const currentConfig = await session.configurationSnapshot();
      const narrator = currentConfig.roles?.narrator;
      // RP-Core journals configure writes; extension callers supply the scoped turn record store.
      const reasoning = options.scene?.reasoning;
      const patch = {
        ...(narrator?.conn !== connection.id || narrator?.model !== pick.model || narrator?.reasoning !== reasoning
          ? { roles: { narrator: { conn: connection.id, model: pick.model, ...(reasoning ? { reasoning } : {}) } } } : {}),
        ...scenePatch(currentConfig, options.scene),
      };
      if (Object.keys(patch).length) await session.configure(patch);
    }
    return { engine, session, connectionFingerprint: fingerprint };
  } catch (error) { await engine.close(); throw error; }
}

/** Builds the canonical shaped request on a private journal snapshot; the source Core store stays read-only. */
export async function previewCoreScene(chats: ChatStore, records: CoreSceneRecords, home: string, sceneId: string, draft: string, signal: AbortSignal,
  apply: (sceneId: string, messages: readonly { role: ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>,
  hasHooks: (sceneId: string) => Promise<boolean>, scene?: CoreSceneLibrary | null): Promise<{ sceneId: string; messages: readonly { role: ProviderRole; content: string }[] } | null> {
  const chat = await chats.getChat(sceneId), linked = await records.sceneFor(sceneId);
  if (!chat || !linked || !chat.connection || chat.activeBranchId !== linked.branchId) return null;
  const branch = (await chats.listBranches(sceneId)).find((take) => take.id === linked.branchId);
  if (!branch) return null;
  const connection = await connectionFor(chat.connection);
  const basis = await Engine.previewWithRecordStore({
    engine: { home, connections: { [connection.connection.id]: connection.connection }, fetch: connection.fetch, lane: "manual", ...(scene ? { library: scene.library } : {}) },
    recordStore: records, sessionId: linked.sessionId, preview: { draft }, narrator: { conn: connection.connection.id, model: chat.connection.model }, signal,
    ...(scene ? { config: scene.config } : {}),
    hostHooks: withUserGuides({ appendSystemContributions: async ({ messages }: { messages: readonly PromptMsg[] }, context) => {
      if (!await hasHooks(sceneId)) return [];
      const projected = messages.map((message) => {
        if (message.blocks.some((block) => block.k !== "text")) throw new StudioValidationError("This RP-Core request contains non-text blocks that extension preview cannot display safely.");
        return { role: message.role as ProviderRole, content: message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("") };
      });
      return apply(sceneId, projected, context.signal);
    } }, scene?.userGuides ?? [], scene?.answering)!,
  });
  if (!basis.preview.ok) throw new StudioValidationError(`RP-Core could not prepare this prompt preview (${basis.preview.code}): ${basis.preview.message}`);
  const latest = await chats.getChat(sceneId), latestBranch = (await chats.listBranches(sceneId)).find((take) => take.id === linked.branchId);
  const latestConnection = latest?.connection ? await connectionFor(latest.connection) : null;
  if (!latest || latest.activeBranchId !== linked.branchId || latestBranch?.version !== branch.version
    || (await records.sceneFor(sceneId))?.sessionId !== linked.sessionId || await records.journalRevision(linked.sessionId) !== basis.basis.sourceLastSeq
    || latest.connection?.id !== chat.connection.id || latest.connection.model !== chat.connection.model || latestConnection?.fingerprint !== connection.fingerprint) {
    throw new StudioConflictError("The Core scene changed during prompt preview; preview it again.");
  }
  const messages = basis.preview.messages.map((message) => {
    if (message.blocks.some((block) => block.k !== "text")) throw new StudioValidationError("This RP-Core preview contains non-text blocks that the extension preview cannot display safely.");
    return { role: message.role as ProviderRole, content: message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("") };
  });
  return { sceneId, messages };
}

/** Refuse a stale projection before a new turn can write from the wrong history. */
export async function checkCoreProjection(chats: ChatStore, records: CoreSceneRecords, chatId: string, session: AsyncSessionHandle, repairDeferredGreeting = false): Promise<number> {
  return reconcileCoreProjection(chats, records, chatId, session.id, session, repairDeferredGreeting);
}

export async function sendCoreScene(chats: ChatStore, chatId: string, records: CoreSceneRecords, home: string, sessionId: string, content: string, greetingIndex: number): Promise<string | undefined> {
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(sessionId);
    await checkCoreProjection(chats, records, chatId, session);
    const chat = await chats.getChat(chatId);
    const first = chat !== null && await chats.countMessages(chat.activeBranchId) === 0;
    const greetings = (await session.header()).cast.character.greetings;
    await session.send({ text: content, expectedVersion: await session.version(), ...(first && greetings.length ? { greetingIndex } : {}) });
    if (!first) return undefined;
    const activeGreeting = (await session.view()).path.find((message) => message.gen?.kind === "greeting");
    // The person's own wording of a greeting (rule 34) is a user edit of that greeting in rp-core, so the
    // scene, the journal and the next request all read the edited text.
    if (activeGreeting && chat?.opening?.edits.length) {
      for (const sibling of await session.messageSiblings(activeGreeting.id)) {
        const own = chat.opening.edits.find((edit) => edit.index === sibling.swipe.index);
        if (own) await session.edit({ messageId: sibling.id, text: own.text, expectedVersion: await session.version() });
      }
    }
    const canonicalGreeting = activeGreeting && (await session.messageSiblings(activeGreeting.id))[0];
    return canonicalGreeting?.blocks.filter((block) => block.k === "text").map((block) => block.text).join("");
  } finally { await engine.close(); }
}

/** Rebuilds a missing ChatStore tail after a crash between core commit and UI projection. */
export async function reconcileCoreScene(chats: ChatStore, chatId: string, branchId: string, records: CoreSceneRecords, home: string, sessionId: string): Promise<void> {
  const chat = await chats.getChat(chatId);
  if (!chat || chat.activeBranchId !== branchId) return;
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(sessionId);
    await reconcileCoreProjection(chats, records, chatId, sessionId, session);
  } catch (error) {
    // A live turn owns the journal. The saved scene can still open, and the next open
    // will reconcile it after the turn releases its lease.
    if (!(error instanceof Error && error.message === "rp-core session locked")) throw error;
  } finally { await engine.close(); }
}
