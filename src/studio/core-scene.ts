/** New scenes may use rp-core as the turn engine while Bunzai keeps its scene projection. */
import { Engine, createOpenAIChatProvider, resolveCaps } from "rp-core";
import type { Character, Connection, Persona, PromptMsg } from "rp-core";
import type { AsyncSessionHandle, RecordStore } from "rp-core";
import { bodyOf } from "../core/guards";
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

const text = (value: unknown): string => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function coreCharacter(source: unknown): Character {
  const body = bodyOf(source);
  const identity = record(body["identity"]);
  const persona = record(body["persona"]);
  const prompts = record(body["prompts"]);
  const greetings = record(body["greetings"]);
  const examples = record(body["examples"]);
  return {
    name: text(identity["name"]), description: text(identity["description"]),
    ...(text(persona["personality"]) ? { personality: text(persona["personality"]) } : {}),
    ...(text(persona["scenario"]) ? { scenario: text(persona["scenario"]) } : {}),
    greetings: [text(greetings["firstMessage"]), ...((Array.isArray(greetings["alternateGreetings"]) ? greetings["alternateGreetings"] : []).map((g) => text(record(g)["text"])))].filter(Boolean),
    ...(text(examples["exampleMessages"]) ? { examples: text(examples["exampleMessages"]) } : {}),
    ...(text(prompts["systemPrompt"]) ? { systemPrompt: text(prompts["systemPrompt"]) } : {}),
    ...(text(prompts["postHistoryInstructions"]) ? { postHistory: text(prompts["postHistoryInstructions"]) } : {}),
  };
}

function corePersona(source: unknown): Persona {
  const body = bodyOf(source);
  return { name: text(body["name"]), description: text(body["content"]) };
}

/** Uses the same pinned host and saved secret as Kit; this first route is OpenAI-chat compatible. */
async function connectionFor(pick: ChatConnection): Promise<{ connection: Connection; fetch: typeof fetch; fingerprint: string }> {
  const saved = (await readVault()).providers.find((provider) => provider.id === pick.id);
  if (!saved) throw new StudioValidationError("the scene's Kit connection is gone");
  const catalog = await spokes();
  const spoke = catalog.get(saved.kind);
  if (!spoke?.scene) throw new StudioValidationError("this Kit connection cannot drive a scene");
  if (spoke.scene.native || (spoke.scene.resolve && saved.kind !== "ollama")) throw new StudioValidationError("this provider needs a native rp-core adapter");
  const baseUrl = spoke.scene.base({ ...saved, model: pick.model });
  if (!baseUrl) throw new StudioValidationError("this connection needs a base URL");
  const host = allowedHost(saved, spoke);
  if (new URL(baseUrl).host !== host) throw new StudioValidationError("the connection's host changed");
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(new URL(baseUrl).host);
  const origin = new URL(baseUrl).origin;
  const caps = resolveCaps({ dialect: "openai-chat", origin, local, model: pick.model, server: saved.kind, ...(saved.context ? { user: { contextLength: saved.context } } : {}) });
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
    connection: { id: pick.id, provider: createOpenAIChatProvider({ connectionId: pick.id, baseUrl, local }), caps, origin, local, key: saved.apiKey ?? null },
    fetch: guardedFetch(host), fingerprint: providerConfigFingerprint(saved, pick.model),
  };
}

export async function createCoreSceneSession(chats: ChatStore, records: CoreSceneRecords, home: string, chatId: string): Promise<void> {
  const snapshot = await chats.castSnapshot(chatId);
  const chat = await chats.getChat(chatId);
  if (!snapshot || !chat) throw new StudioValidationError("the new scene is gone");
  const engine = await Engine.openWithRecordStore({ home, recordStore: records.forHostSceneCreation(chatId, chat.activeBranchId), lane: "manual" });
  try {
    await engine.createSession({ character: coreCharacter(snapshot.character), ...(snapshot.persona ? { persona: corePersona(snapshot.persona) } : {}), title: chat.title });
  } finally { await engine.close(); }
}

export const INCOMPLETE_CORE_SCENE_MESSAGE = "RP-Core scene creation is incomplete; legacy chat actions are blocked. Reopen the library to finish a committed Core header; if no header was committed, delete the empty scene and create it again.";

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
    const session = await engine.createSession({ character: coreCharacter(snapshot.character), ...(snapshot.persona ? { persona: corePersona(snapshot.persona) } : {}), title: chat.title });
    try { await scoped.link(chatId, session.id, takeId); }
    catch (error) {
      const accepted = await records.pendingCreation(chatId);
      if (accepted?.operationId === commit.invocationId && accepted.sessionId === session.id) await records.recoverCreation(commit.invocationId);
      else throw error;
    }
  } finally { await engine.close(); }
}

export async function openCoreScene(records: CoreSceneRecords, home: string, sessionId: string, pick: ChatConnection, options: { recordStore?: RecordStore; configure?: boolean } = {}) {
  const { connection, fetch, fingerprint } = await connectionFor(pick);
  const engine = await Engine.openWithRecordStore({ home, recordStore: options.recordStore ?? records, connections: { [connection.id]: connection }, fetch, lane: "manual" });
  try {
    const session = await engine.session(sessionId);
    if (options.configure !== false) {
      const currentConfig = await session.configurationSnapshot();
      const narrator = currentConfig.roles?.narrator;
      // RP-Core journals configure writes; extension callers supply the scoped turn record store.
      if (narrator?.conn !== connection.id || narrator?.model !== pick.model) await session.configure({ roles: { narrator: { conn: connection.id, model: pick.model } } });
    }
    return { engine, session, connectionFingerprint: fingerprint };
  } catch (error) { await engine.close(); throw error; }
}

/** Builds the canonical shaped request on a private journal snapshot; the source Core store stays read-only. */
export async function previewCoreScene(chats: ChatStore, records: CoreSceneRecords, home: string, sceneId: string, draft: string, signal: AbortSignal,
  apply: (sceneId: string, messages: readonly { role: ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>,
  hasHooks: (sceneId: string) => Promise<boolean>): Promise<{ sceneId: string; messages: readonly { role: ProviderRole; content: string }[] } | null> {
  const chat = await chats.getChat(sceneId), linked = await records.sceneFor(sceneId);
  if (!chat || !linked || !chat.connection || chat.activeBranchId !== linked.branchId) return null;
  const branch = (await chats.listBranches(sceneId)).find((take) => take.id === linked.branchId);
  if (!branch) return null;
  const connection = await connectionFor(chat.connection);
  const basis = await Engine.previewWithRecordStore({
    engine: { home, connections: { [connection.connection.id]: connection.connection }, fetch: connection.fetch, lane: "manual" },
    recordStore: records, sessionId: linked.sessionId, preview: { draft }, narrator: { conn: connection.connection.id, model: chat.connection.model }, signal,
    hostHooks: { appendSystemContributions: async ({ messages }: { messages: readonly PromptMsg[] }, context) => {
      if (!await hasHooks(sceneId)) return [];
      const projected = messages.map((message) => {
        if (message.blocks.some((block) => block.k !== "text")) throw new StudioValidationError("This RP-Core request contains non-text blocks that extension preview cannot display safely.");
        return { role: message.role as ProviderRole, content: message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("") };
      });
      return apply(sceneId, projected, context.signal);
    } },
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
