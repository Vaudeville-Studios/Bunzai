/** Reject unsupported writes addressed by any scene, message, version or take identity. */
import { str } from "../core/guards";
import type { CoreSceneRecords } from "../stage/store/sqlite/core-record-store";
import { INCOMPLETE_CORE_SCENE_MESSAGE } from "../studio/core-scene";
import { err } from "./server-security";

// Backdrop is persisted presentation state on the host chat, outside the RP-Core session journal/config.
// edit, hide and select-swipe go to rp-core's journal first (server-chats-core-messages.ts); the scene's
// lore and preset are read for each Core turn and handed to rp-core (studio/core-library.ts).
const ALLOWED = new Set(["start", "send", "turn", "stop", "review", "connection", "search", "rename", "delete", "favorite", "folder", "core-settings", "backdrop", "edit", "hide", "select-swipe", "lore", "preset", "prompting", "discard", "add-anyway", "fork", "take", "delete-take", "rename-take", "restore-take", "persona", "update-card", "revert-card", "save-member", "variant", "opening", "draft", "formula-try", "regex", "regex-answer", "final-cut", "final-cut/rerun", "final-cut/rerun/apply", "cut", "restore-cut"]);
/** `finish` completes a host-created scene whose rp-core session was never written (ensureCoreScene). */
export async function coreWriteGuard(path: string, body: Record<string, unknown>, records?: CoreSceneRecords, finish?: (sceneId: string) => Promise<unknown>): Promise<Response | null> {
  if (!records || !path.startsWith("/api/chats/")) return null;
  const ids = [str(body.chatId), str(body.sceneId), str(body.id)];
  const branchIds = [str(body.branchId), str(body.id)].filter(Boolean);
  const birthBranches = await Promise.all([...new Set(branchIds)].map((id) => records.unlinkedBirthForBranch(id)));
  const birthSceneIds = birthBranches.flatMap((birth) => birth ? [birth.sceneId] : []);
  const candidateSceneIds = [...new Set([...ids.filter(Boolean), ...birthSceneIds])];
  if (finish) {
    for (const id of candidateSceneIds) if ((await records.unlinkedBirth(id))?.origin === "host" && path !== "/api/chats/delete") await finish(id);
  }
  const sceneBirths = await Promise.all(candidateSceneIds.map((id) => records.unlinkedBirth(id)));
  const pendingBirthSceneIds = candidateSceneIds.filter((_, index) => sceneBirths[index]);
  if (pendingBirthSceneIds.length) {
    const deletingEmptyBirth = path === "/api/chats/delete"
      && (await Promise.all(pendingBirthSceneIds.map((id) => records.pendingCreation(id)))).every((projection) => projection === null);
    if (!deletingEmptyBirth) return err(INCOMPLETE_CORE_SCENE_MESSAGE, 409);
  }
  if (ALLOWED.has(path.slice("/api/chats/".length))) return null;
  const linked = await Promise.all(ids.filter(Boolean).map((id) => records.sceneFor(id)));
  const messages = [str(body.messageId), str(body.id).split(":")[0] ?? ""].filter(Boolean);
  const messageScenes = await Promise.all(messages.map((id) => records.sceneForMessage(id)));
  const branchScenes = await Promise.all([str(body.branchId), str(body.id)].filter(Boolean).map((id) => records.sceneForBranch(id)));
  if (linked.some(Boolean) || messageScenes.some(Boolean) || branchScenes.some(Boolean)) {
    return err("this action is not yet connected to rp-core; export the scene before changing it", 501);
  }
  return null;
}
