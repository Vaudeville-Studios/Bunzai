/** Reject unsupported writes addressed by any scene, message, version or take identity. */
import { str } from "../core/guards";
import type { CoreSceneRecords } from "../stage/store/sqlite/core-record-store";
import { INCOMPLETE_CORE_SCENE_MESSAGE } from "../studio/core-scene";
import { err } from "./server-security";

const ALLOWED = new Set(["start", "send", "turn", "stop", "review", "connection", "search", "rename", "delete", "favorite", "folder", "core-settings"]);
export async function coreWriteGuard(path: string, body: Record<string, unknown>, records?: CoreSceneRecords): Promise<Response | null> {
  if (!records || !path.startsWith("/api/chats/")) return null;
  const ids = [str(body.chatId), str(body.sceneId), str(body.id)];
  const branchIds = [str(body.branchId), str(body.id)].filter(Boolean);
  const birthBranches = await Promise.all([...new Set(branchIds)].map((id) => records.unlinkedBirthForBranch(id)));
  const birthSceneIds = birthBranches.flatMap((birth) => birth ? [birth.sceneId] : []);
  const candidateSceneIds = [...new Set([...ids.filter(Boolean), ...birthSceneIds])];
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
