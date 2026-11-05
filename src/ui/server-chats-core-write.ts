/** Start and append routes that coordinate the Core journal with the ChatStore projection. */
import { str } from "../core/guards";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { SettingsStoreLike, StudioStoreLike } from "../studio/contracts";
import { createCoreSceneSession, ensureCoreScene, INCOMPLETE_CORE_SCENE_MESSAGE, reconcileCoreScene, sendCoreScene } from "../studio/core-scene";
import { greetingsOf, openScene, sendToScene, startSceneWithNotes } from "../studio/scenes";
import { libraryFor } from "../studio/library-content";
import { err, json } from "./server-security";

export async function handleCoreChatWrite(path: string, chats: ChatStore, store: StudioStoreLike, settings: SettingsStoreLike, body: Record<string, unknown>): Promise<Response | null> {
  if (path === "/api/chats/start") {
    const records = libraryFor(store.studioPath())?.core;
    const { chat, notes } = await startSceneWithNotes(chats, store, settings, str(body["characterId"]), records !== undefined);
    if (records) await createCoreSceneSession(chats, records, store.studioPath(), chat.id);
    return json(notes.length ? { ...chat, startNotes: notes } : chat);
  }
  if (path !== "/api/chats/send") return null;
  const { greetingIndex, expectedVersion } = body;
  if (typeof greetingIndex !== "number" || typeof expectedVersion !== "number" || typeof body["content"] !== "string") return err("expected { chatId, content, greetingIndex, expectedVersion }");
  const chatId = str(body["chatId"]);
  const records = libraryFor(store.studioPath())?.core;
  const resolved = records ? await ensureCoreScene(chats, records, store.studioPath(), chatId) : null;
  if (resolved?.incomplete) return err(INCOMPLETE_CORE_SCENE_MESSAGE, 409);
  const core = resolved?.link ?? null;
  if (core) {
    const chat = await chats.getChat(chatId);
    if (!chat || chat.activeBranchId !== core.branchId) return err("this take is not connected to rp-core yet", 409);
    const branch = (await chats.listBranches(chatId)).find((take) => take.id === core.branchId);
    if (branch?.version !== expectedVersion) return err("the scene changed; reload it and try again", 409);
    if (!str(body["content"]).trim()) return err("a message needs some text");
    if (await chats.countMessages(core.branchId) === 0) {
      const snapshot = await chats.castSnapshot(chatId);
      const greetings = snapshot ? greetingsOf(snapshot.character) : [];
      if (greetings.length > 0 && (!Number.isInteger(greetingIndex) || !greetings[greetingIndex])) return err("that greeting does not exist");
    }
  }
  const coreGreeting = records && core ? await sendCoreScene(chats, chatId, records, store.studioPath(), core.sessionId, str(body["content"]), greetingIndex) : undefined;
  let sent = await sendToScene(chats, store, { chatId, content: str(body["content"]), greetingIndex, expectedVersion, ...(coreGreeting === undefined ? {} : { coreGreeting }) });
  if (sent && core && records) {
    await reconcileCoreScene(chats, chatId, core.branchId, records, store.studioPath(), core.sessionId);
    sent = await openScene(chats, store, chatId);
  }
  return sent ? json(core ? { ...sent, core: true } : sent) : err("that scene is gone", 404);
}
