/** A person's own message changes on a Core scene: rp-core's journal first, then the scene (CoreTurnOwner.hostMessage). */
import { str } from "../core/guards";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { CoreSceneRecords } from "../stage/contracts/core-record-store";
import type { StudioStoreLike } from "../studio/contracts";
import type { CoreTurnOwner } from "../studio/core-turn-owner";
import { openScene, takeName } from "../studio/scenes";
import { corePromptingRefusal, corePropsRefusal } from "../studio/core-library";
import { err, json } from "./server-security";

export const CORE_MESSAGE_ROUTES = new Set(["/api/chats/edit", "/api/chats/hide", "/api/chats/select-swipe", "/api/chats/fork", "/api/chats/take", "/api/chats/delete-take", "/api/chats/cut", "/api/chats/restore-cut", "/api/chats/cut-version", "/api/chats/restore-version"]);

/** Scene writes that change the cast: the old engine's route writes the scene, then rp-core's session follows (CoreTurnOwner.syncCast). */
export const CORE_CAST_ROUTES = new Set(["/api/chats/persona", "/api/chats/update-card", "/api/chats/revert-card", "/api/chats/save-member", "/api/chats/variant"]);

/** Answers only for a scene linked to rp-core; anything else falls through to the old engine's route. */
export async function handleCoreMessageWrite(p: string, b: Record<string, unknown>, chats: ChatStore, store: StudioStoreLike, records: CoreSceneRecords | undefined, owner: CoreTurnOwner | undefined): Promise<Response | null> {
  if (records && p === "/api/chats/prompting" && await records.sceneFor(str(b["chatId"]))) {
    const refusal = corePromptingRefusal(b["prompting"]);
    if (refusal) return err(refusal, 501);
  }
  if (records && p === "/api/chats/props" && await records.sceneFor(str(b["chatId"]))) {
    const refusal = corePropsRefusal(b["props"]);
    if (refusal) return err(refusal, 501);
  }
  if (!records || !CORE_MESSAGE_ROUTES.has(p)) return null;
  // A removed version comes back from the Trash too, which names it `messageId:swipeId` (SceneGrave).
  const [graveMessage = "", graveSwipe = ""] = p === "/api/chats/restore-version" ? str(b["id"]).split(":") : [];
  const messageId = str(b["messageId"]) || graveMessage;
  const sceneId = p === "/api/chats/edit" || p === "/api/chats/restore-version" ? await records.sceneForMessage(messageId)
    : p === "/api/chats/take" || p === "/api/chats/delete-take" ? str(b["chatId"]) || await records.sceneForBranch(str(b["branchId"])) : str(b["chatId"]);
  if (!sceneId || !await records.sceneFor(sceneId)) return null;
  if (!owner) return err("the Core turn owner is unavailable", 503);
  const reopen = async () => {
    const opened = await openScene(chats, store, sceneId);
    return opened ? json({ ...opened, core: true }) : err("that scene is gone", 404);
  };
  if (p === "/api/chats/take") { await owner.switchTake({ sceneId, takeId: str(b["branchId"]) }); return reopen(); }
  if (p === "/api/chats/delete-take") return await owner.deleteTake({ sceneId, takeId: str(b["branchId"]) }) ? reopen() : err("that scene is gone", 404);
  if (p === "/api/chats/restore-version") { await owner.cutVersion({ sceneId, messageId, swipeId: graveSwipe, cut: false }); return reopen(); }
  const expectedVersion = b["expectedVersion"];
  if (typeof expectedVersion !== "number") return err("expected an expectedVersion");
  if (p === "/api/chats/edit") {
    const content = b["content"];
    if (typeof content !== "string" || content.trim() === "") return err("expected { messageId, swipeId, content, expectedVersion } with some text");
    return json(await owner.hostMessage({ kind: "edit", sceneId, messageId, swipeId: str(b["swipeId"]), content, expectedVersion }));
  }
  if (p === "/api/chats/cut") {
    const scope = b["scope"] === "from" ? "from" : b["scope"] === "one" ? "one" : null;
    if (!scope) return err('scope must be "one" or "from"');
    await owner.cut({ sceneId, messageId, scope, expectedVersion });
    return reopen();
  }
  if (p === "/api/chats/cut-version") {
    await owner.cutVersion({ sceneId, messageId, swipeId: str(b["swipeId"]), cut: true, expectedVersion });
    return reopen();
  }
  if (p === "/api/chats/restore-cut") {
    await owner.restoreCut({ sceneId, cutId: str(b["cutId"]), expectedVersion });
    return reopen();
  }
  if (p === "/api/chats/fork") {
    const name = await takeName(chats, sceneId, typeof b["name"] === "string" ? b["name"] : undefined);
    await owner.forkTake({ sceneId, messageId, name, expectedVersion });
    return reopen();
  }
  if (p === "/api/chats/hide") {
    if (typeof b["hidden"] !== "boolean") return err("expected { chatId, messageId, hidden, expectedVersion }");
    await owner.hostMessage({ kind: "hide", sceneId, messageId, hidden: b["hidden"], expectedVersion });
  } else {
    if (typeof b["index"] !== "number") return err("expected { chatId, messageId, index, expectedVersion }");
    await owner.hostMessage({ kind: "select", sceneId, messageId, index: b["index"], expectedVersion });
  }
  return reopen();
}
