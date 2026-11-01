/** Scene/take/message DTOs filtered before any ChatStore read or bounded paging. */
import type { Chat, ChatStore, Message } from "../../stage/contracts/chat-store";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import type { ResourceRef } from "../contracts/operation";
import type { JsonValue } from "../contracts/value";
import { MAX_VALUE_BYTES } from "../contracts/limits";
import type { ExtensionSceneServices } from "../operations/scenes/_services";
import type { StudioStoreLike } from "../../studio/contracts";
import { freezeCast } from "../../studio/scenes";
import type { ContentStore } from "../../stage/contracts/content-store";
import type { SceneSettingChange, SceneSettingSelector } from "../../stage/contracts/scene-settings";
import { assertExtensionSceneCreateSupported, assertExtensionSceneNotCore, type ExtensionCoreSceneOwnership } from "./core-scene-guard";
import { ExtensionServiceError } from "./service-errors";

const libraryScope = (scope: readonly ResourceRef[]): boolean => scope.some(({ kind, id }) => kind === "library" && id === "library");
const selected = (scope: readonly ResourceRef[], kind: string, id: string): boolean => scope.some((item) => item.kind === kind && item.id === id);
const selectedScene = (scope: readonly ResourceRef[], id: string): boolean => libraryScope(scope) || selected(scope, "scene", id);
const selectedTake = (scope: readonly ResourceRef[], sceneId: string, takeId: string): boolean => selectedScene(scope, sceneId) && (libraryScope(scope) || selected(scope, "take", takeId));
const messageFields = new Set(["message.seq", "message.id", "message.role", "message.createdAt", "message.hidden", "message.content"]);
const validateFields = (fields: readonly string[]): void => { if (fields.some((field) => !messageFields.has(field))) throw new Error("message fields exceed the read projection"); };
const sceneDto = (chat: Chat) => ({ id: chat.id, title: chat.title, activeTakeId: chat.activeBranchId, updatedAt: chat.updatedAt,
  character: { id: chat.cast.character.id, name: chat.cast.character.name ?? chat.cast.character.id } });
const sceneDetails = (chat: Chat, fields: readonly string[]): JsonValue => ({ ...sceneDto(chat),
  ...(fields.includes("scene.connection") ? { connection: chat.connection ? { id: chat.connection.id, model: chat.connection.model } : null } : {}),
  ...(fields.includes("scene.preset") ? { preset: chat.preset ? { kind: chat.preset.kind, id: chat.preset.id } : null } : {}),
  ...(fields.includes("scene.folder") ? { folderId: chat.folderId ?? null } : {}),
  ...(fields.includes("scene.favorite") ? { favoredAt: chat.favoredAt ?? null } : {}),
  ...(fields.includes("scene.variant") ? { variantId: chat.variantId ?? null } : {}),
});
const truncateUtf8 = (text: string, maxBytes: number): { text: string; truncated: boolean } => {
  const encoder = new TextEncoder(); let size = 0; let result = "";
  for (const point of text) { const next = encoder.encode(point).byteLength; if (size + next > maxBytes) return { text: result, truncated: true }; result += point; size += next; }
  return { text: result, truncated: false };
};
const fitsWire = (value: unknown): boolean => new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_VALUE_BYTES;

export function createExtensionSceneServices(chats: ChatStore, content?: ContentStore, isCoreScene?: ExtensionCoreSceneOwnership,
  createCoreScene?: (sceneId: string, takeId: string, commit: ExtensionCommitContext) => Promise<void>,
  appendCoreMessage?: (input: { sceneId: string; takeId: string; content: string; expectedVersion: number; commit: ExtensionCommitContext }) => Promise<Message | null>,
  editCoreMessage?: (input: { sceneId: string; takeId: string; seq: number; content: string; expectedVersion: number; commit: ExtensionCommitContext }) => Promise<Message | null>): ExtensionSceneServices {
  const studio: Pick<StudioStoreLike, "readVersioned"> | undefined = content ? { readVersioned: async (kind, id) => kind === "character" || kind === "persona" ? content.read(kind, id) : null } : undefined;
  async function preparedScene(input: { characterId: string; characterVersion: number; personaId?: string; personaVersion?: number }, scope: readonly ResourceRef[]) {
    if (!studio || !selected(scope, "character", input.characterId) || (input.personaId && !selected(scope, "persona", input.personaId))) throw new Error("scene source is outside the approved grant");
    const frozen = await freezeCast(studio, input.characterId, input.personaId);
    if (frozen.cast.character.version !== input.characterVersion || (input.personaId && frozen.cast.persona?.version !== input.personaVersion)) throw new Error("source changed after review; inspect again");
    return frozen;
  }
  async function branch(sceneId: string, takeId: string, scope: readonly ResourceRef[]) {
    if (!selectedTake(scope, sceneId, takeId)) throw new Error("take scope is outside the approved grant");
    const chat = await chats.getChat(sceneId);
    if (!chat) return null;
    const item = (await chats.listBranches(sceneId)).find((candidate) => candidate.id === takeId);
    return item ? { chat, branch: item } : null;
  }
  const summary = async (sceneId: string, scope: readonly ResourceRef[]): Promise<Chat | null> => {
    if (!selectedScene(scope, sceneId)) throw new Error("scene scope is outside the approved grant");
    return chats.getChat(sceneId);
  };
  const checkSettingHost = async (sceneId: string, selector: SceneSettingSelector): Promise<void> => {
    if (isCoreScene === undefined) await assertExtensionSceneNotCore(isCoreScene, sceneId);
    if (isCoreScene && await isCoreScene(sceneId) && selector.group !== "connection" && selector.group !== "backdrop") {
      throw new ExtensionServiceError("UNSUPPORTED_HOST", "Core-linked scenes currently support only connection and backdrop setting selectors.");
    }
  };
  return {
    async previewCreateScene(input, scope) {
      assertExtensionSceneCreateSupported(isCoreScene, createCoreScene !== undefined && chats.createCoreChat !== undefined);
      const frozen = await preparedScene(input, scope);
      return { action: "create scene", title: input.title ?? frozen.title, character: { id: input.characterId, name: frozen.cast.character.name ?? input.characterId, version: frozen.cast.character.version },
        ...(frozen.cast.persona ? { persona: { id: frozen.cast.persona.id, name: frozen.cast.persona.name ?? frozen.cast.persona.id, version: frozen.cast.persona.version } } : {}) };
    },
    async createScene(input, scope, commit) {
      assertExtensionSceneCreateSupported(isCoreScene, createCoreScene !== undefined && chats.createCoreChat !== undefined);
      const frozen = await preparedScene(input, scope);
      const scene = { ...frozen, title: input.title ?? frozen.title };
      const created = isCoreScene === null
        ? await chats.createChat(scene, commit)
        : chats.createCoreChat && createCoreScene
          ? await chats.createCoreChat(scene, commit)
          : (() => { throw new ExtensionServiceError("UNSUPPORTED_HOST", "Core scene creation is unavailable on this host."); })();
      if (isCoreScene !== null && createCoreScene) await createCoreScene(created.id, created.activeBranchId, commit);
      return { id: created.id, title: created.title, characterId: created.cast.character.id, personaId: created.cast.persona?.id ?? null, activeTakeId: created.activeBranchId, createdAt: created.createdAt };
    },
    async list(scope, limit) {
      if (!libraryScope(scope) && !scope.some((item) => item.kind === "scene")) throw new Error("scene list requires explicit scene scope");
      const ids = libraryScope(scope) ? null : [...new Set(scope.filter((item) => item.kind === "scene").map((item) => item.id))];
      const rows: Chat[] = ids ? (await Promise.all(ids.map((id) => chats.getChat(id)))).filter((chat): chat is Chat => chat !== null) : (await chats.listChats()).chats;
      return rows.filter((chat) => selectedScene(scope, chat.id)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, limit).map(sceneDto);
    },
    async read(sceneId, scope) { const chat = await summary(sceneId, scope); return chat ? sceneDto(chat) : null; },
    async readDetails(sceneId, scope, fields) { const chat = await summary(sceneId, scope); return chat ? sceneDetails(chat, fields) : null; },
    async listTakes(sceneId, scope, limit) {
      if (!selectedScene(scope, sceneId)) throw new Error("scene scope is outside the approved grant");
      const chat = await chats.getChat(sceneId); if (!chat) return [];
      const takeRefs = scope.filter((item) => item.kind === "take");
      const selectedTakes = libraryScope(scope) || takeRefs.length === 0 ? null : new Set(takeRefs.map((item) => item.id));
      return (await chats.listBranches(sceneId)).filter((item) => !selectedTakes || selectedTakes.has(item.id))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, limit)
        .map((item) => ({ id: item.id, sceneId: item.chatId, name: item.name, parentId: item.parentBranchId, version: item.version, createdAt: item.createdAt, forkPosition: item.forkPosition ?? null }));
    },
    async readTake(sceneId, takeId, scope) {
      const found = await branch(sceneId, takeId, scope); if (!found) return null;
      return { id: found.branch.id, sceneId, name: found.branch.name, parentId: found.branch.parentBranchId, version: found.branch.version,
        createdAt: found.branch.createdAt, forkPosition: found.branch.forkPosition ?? null };
    },
    async listMessages(sceneId, takeId, fromSeq, limit, scope, fields) {
      validateFields(fields); if (!await branch(sceneId, takeId, scope)) return { messages: [], nextSeq: null, branchVersion: null };
      const page = await chats.readMessages(takeId, { ...(fromSeq === undefined ? {} : { fromSeq }), limit });
      const messages: JsonValue[] = []; let nextSeq = page.nextSeq;
      for (let index = 0; index < page.messages.length; index++) {
        const message = page.messages[index]!;
        const next = index + 1 < page.messages.length ? page.messages[index + 1]!.seq : page.nextSeq;
        const dto = messageDto(message, fields);
        const candidate = { messages: [...messages, dto], nextSeq: next, branchVersion: page.branchVersion };
        if (!fitsWire(candidate)) { nextSeq = message.seq; break; }
        messages.push(dto); nextSeq = next;
      }
      return { messages, nextSeq, branchVersion: page.branchVersion };
    },
    async readMessage(sceneId, takeId, seq, scope, fields) {
      validateFields(fields); if (!await branch(sceneId, takeId, scope)) return null;
      const page = await chats.readMessages(takeId, { fromSeq: seq, limit: 1 });
      const message = page.messages.find((item) => item.seq === seq); return message ? messageDto(message, fields) : null;
    },
    async listMessageVersions(sceneId, takeId, seq, fromIndex, scope) {
      const found = await branch(sceneId, takeId, scope); if (!found) return { versions: [], nextIndex: null };
      const page = await chats.readMessages(takeId, { fromSeq: seq, limit: 1 });
      const message = page.messages.find((item) => item.seq === seq); if (!message) return { versions: [], nextIndex: null };
      const first = await chats.readMessageSwipe(takeId, message.id, fromIndex);
      const count = first.swipeCount, versions: JsonValue[] = []; let nextIndex: number | null = fromIndex;
      for (let index = fromIndex; index < Math.min(count, fromIndex + 32); index++) {
        const opened = index === fromIndex ? first : await chats.readMessageSwipe(takeId, message.id, index);
        if (!opened.swipe) { nextIndex = index + 1; continue; }
        const content = truncateUtf8(opened.swipe.content, 3_000);
        const version = { index, content: content.text, contentTruncated: content.truncated, createdAt: opened.swipe.createdAt, pinned: opened.swipe.pinned };
        const candidate = { versions: [...versions, version], nextIndex: index + 1 < count ? index + 1 : null };
        if (!fitsWire(candidate)) { nextIndex = index; break; }
        versions.push(version); nextIndex = index + 1 < count ? index + 1 : null;
      }
      return { versions, nextIndex };
    },
    async sendMessage(sceneId, takeId, content, expectedVersion, scope, commit: ExtensionCommitContext) {
      const found = await branch(sceneId, takeId, scope); if (!found) return null;
      if (isCoreScene && await isCoreScene(sceneId)) {
        if (!appendCoreMessage) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Core-linked message append is unavailable on this host.");
        const saved = await appendCoreMessage({ sceneId, takeId, content, expectedVersion, commit });
        return saved ? { id: saved.id, seq: saved.seq, role: saved.role, branchVersion: (await chats.listBranches(sceneId)).find((item) => item.id === takeId)?.version ?? null } : null;
      }
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      const message = await chats.appendMessage(takeId, { role: "user", content }, { expectedVersion }, commit);
      return message ? { id: message.id, seq: message.seq, role: message.role, branchVersion: (await chats.listBranches(sceneId)).find((item) => item.id === takeId)?.version ?? null } : null;
    },
    async editMessage(sceneId, takeId, seq, content, expectedVersion, scope, commit: ExtensionCommitContext) {
      const found = await branch(sceneId, takeId, scope); if (!found) return null;
      const page = await chats.readMessages(takeId, { fromSeq: seq, limit: 1 });
      const message = page.messages.find((item) => item.seq === seq); const swipe = message?.swipes[message.current];
      if (!message || !swipe) return null;
      if (isCoreScene && await isCoreScene(sceneId)) {
        if (!editCoreMessage) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Exact Core message editing is unavailable on this host.");
        const saved = await editCoreMessage({ sceneId, takeId, seq, content, expectedVersion, commit });
        return saved ? { id: saved.id, seq: saved.seq, role: saved.role, branchVersion: (await chats.listBranches(sceneId)).find((item) => item.id === takeId)?.version ?? null } : null;
      }
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      const saved = await chats.editSwipe(message.id, swipe.id, content, { expectedVersion }, commit);
      return saved ? { id: saved.id, seq: saved.seq, role: saved.role, branchVersion: (await chats.listBranches(sceneId)).find((item) => item.id === takeId)?.version ?? null } : null;
    },
    async deleteMessage(sceneId, takeId, seq, expectedVersion, scope, commit: ExtensionCommitContext) {
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      const found = await branch(sceneId, takeId, scope); if (!found) return null;
      const page = await chats.readMessages(takeId, { fromSeq: seq, limit: 1 });
      const message = page.messages.find((item) => item.seq === seq); if (!message) return null;
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      const cut = await chats.cutMessages(takeId, message.id, "one", { expectedVersion }, commit);
      return cut ? { id: message.id, seq, cutId: cut.cutId, count: cut.count, branchVersion: (await chats.listBranches(sceneId)).find((item) => item.id === takeId)?.version ?? null } : null;
    },
    async forkTake(sceneId, takeId, messageId, swipeId, name, expectedVersion, scope, commit: ExtensionCommitContext) {
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      const found = await branch(sceneId, takeId, scope); if (!found) return null;
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      const forked = await chats.fork(takeId, messageId, { name, ...(swipeId ? { swipeId } : {}), expectedVersion }, commit);
      return forked ? { id: forked.id, sceneId, name: forked.name, parentId: forked.parentBranchId, version: forked.version, createdAt: forked.createdAt } : null;
    },
    async previewSceneSetting(sceneId, selector: SceneSettingSelector, change: SceneSettingChange, scope) {
      await checkSettingHost(sceneId, selector);
      if (!selectedScene(scope, sceneId)) throw new Error("scene settings are outside the approved scope");
      return chats.previewSceneSetting(sceneId, selector, change);
    },
    async applySceneSetting(sceneId, selector: SceneSettingSelector, change: SceneSettingChange, expectedRevision, scope, commit) {
      await checkSettingHost(sceneId, selector);
      if (!selectedScene(scope, sceneId)) throw new Error("scene settings are outside the approved scope");
      await checkSettingHost(sceneId, selector);
      const result = await chats.applySceneSetting(sceneId, selector, change, expectedRevision, commit);
      if (!result) throw new Error("scene settings target is unavailable");
      return result;
    },
  };
}

function messageDto(message: Awaited<ReturnType<ChatStore["readMessages"]>>["messages"][number], fields: readonly string[]): JsonValue {
  const value: Record<string, JsonValue> = {};
  if (fields.includes("message.seq")) value.seq = message.seq;
  if (fields.includes("message.id")) value.id = message.id;
  if (fields.includes("message.role")) value.role = message.role;
  if (fields.includes("message.createdAt")) value.createdAt = message.createdAt;
  if (fields.includes("message.hidden")) value.hidden = message.hidden === true;
  if (fields.includes("message.content")) {
    const content = message.swipes[message.current]?.content;
    if (content !== undefined) { const bounded = truncateUtf8(content, 3_000); value.content = bounded.text; if (bounded.truncated) value.contentTruncated = true; }
  }
  return value;
}
