/**
 * Final Cut's routes (ChatStore rule 44): `POST /api/chats/final-cut` changes a scene's switch, passes and tool overrides (the store checks
 * the patch), `GET /api/chats/final-cut/run` reads what the passes did to one saved reply (its trace's `finalCut`), and
 * `POST /api/chats/final-cut/rerun` runs the scene's passes over a saved reply again and answers the result without writing it
 * (studio/final-cut-rerun.ts). A failed model call is a 502 carrying the provider's category and code, as a draft's is.
 */
import { libraryFor } from "../studio/library-content";
import { str } from "../core/guards";
import { sceneRuntimeFor } from "./server-scene-runtime";
import type { ChatFinalCutPatch, ChatStore } from "../stage/contracts/chat-store";
import { ProviderError } from "../stage/contracts/provider";
import type { StateStore } from "../stage/contracts/state-store";
import { deleteAgent, deleteBank, finalCutBanksOf, listAgents, listBanks, saveAgent, saveBank } from "../studio/final-cut-library";
import { applyFinalCutRerun, rerunFinalCut } from "../studio/final-cut-rerun";
import type { TurnDeps } from "../studio/scene-turn";
import type { ReadPreset } from "../studio/scene-turn-load";
import { connect } from "../kit/providers/scene-connect";
import { err, json } from "./server-security";
import type { StudioStoreLike } from "../studio/contracts";

type Body = Record<string, unknown>;

export async function handleFinalCutRoute(req: Request, url: URL, chats: ChatStore, state: StateStore, readPreset: ReadPreset, readRegex: TurnDeps["readRegex"], b: Body | null, store: StudioStoreLike): Promise<Response | null> {
  const p = url.pathname;
  if (req.method === "GET" && p === "/api/chats/final-cut/run") {
    const chat = await chats.getChat(url.searchParams.get("chatId") ?? "");
    const { messages } = chat ? await chats.readMessages(chat.activeBranchId, { limit: 100_000 }) : { messages: [] };
    const message = messages.find((m) => m.id === url.searchParams.get("messageId") && !m.cut && m.role === "assistant");
    if (!chat || !message) return err("that reply is gone", 404);
    const swipe = message.swipes[message.current]!;
    const trace = await chats.swipeTrace(message.id, swipe.id);
    return json({ messageId: message.id, swipeId: swipe.id, text: swipe.content, run: trace?.["finalCut"] ?? null });
  }
  if (req.method === "GET" && p === "/api/chats/final-cut/library") return json({ banks: await listBanks(state), agents: await listAgents(store, state) });
  if (req.method !== "POST" || !b) return null;
  if (p === "/api/chats/final-cut/library/bank") return json(await saveBank(state, b["bank"], Date.now()));
  if (p === "/api/chats/final-cut/library/agent") return json(await saveAgent(store, state, b["agent"], Date.now()));
  if (p === "/api/chats/final-cut/library/bank/delete") return json({ deleted: await deleteBank(state, str(b["id"]), Date.now()) });
  if (p === "/api/chats/final-cut/library/agent/delete") return json({ deleted: await deleteAgent(store, state, str(b["id"]), str(b["revision"])) });
  if (p === "/api/chats/final-cut") {
    const chat = await chats.setFinalCut(str(b["chatId"]), b["finalCut"] as ChatFinalCutPatch);
    return chat ? json(chat) : err("that scene is gone", 404);
  }
  if (p === "/api/chats/final-cut/rerun/apply") {
    const expectedVersion = b["expectedVersion"];
    if (typeof expectedVersion !== "number") return err("expected { chatId, rerunId, expectedVersion }");
    const chatId = str(b["chatId"]);
    const library = libraryFor(store.studioPath());
    const owner = library?.coreTurns && await library.core?.sceneFor(chatId) ? library.coreTurns : undefined;
    return json(await applyFinalCutRerun({ chats, now: Date.now, ...(owner ? { edit: (messageId: string, swipeId: string, content: string, version: number) =>
      owner.hostMessage({ kind: "edit", sceneId: chatId, messageId, swipeId, content, expectedVersion: version }) } : {}) }, { chatId, rerunId: str(b["rerunId"]), expectedVersion }));
  }
  if (p === "/api/chats/final-cut/rerun") {
    try {
      return json(await rerunFinalCut({ runtime: sceneRuntimeFor(chats), chats, connect, readPreset, ...(readRegex ? { readRegex } : {}), now: Date.now, finalCutBanks: () => finalCutBanksOf(state) }, { chatId: str(b["chatId"]), messageId: str(b["messageId"]) }, req.signal));
    } catch (e) {
      if (e instanceof ProviderError) return json({ error: e.message, code: e.code, category: e.category }, 502);
      throw e;
    }
  }
  return null;
}
