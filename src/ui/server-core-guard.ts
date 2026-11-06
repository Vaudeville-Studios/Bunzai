/** Reject unsupported writes addressed by any scene, message, version or take identity. */
import { str } from "../core/guards";
import type { CoreSceneRecords } from "../stage/store/sqlite/core-record-store";
import { INCOMPLETE_CORE_SCENE_MESSAGE } from "../studio/core-scene";
import { err } from "./server-security";

// The scene writes a Core scene takes, one group per line (a route named like a piece kind is a route, not a kind list).
const ALLOWED = new Set([
  // The turn and its gates; scene metadata. Backdrop is presentation state on the host chat, outside the journal.
  "start", "send", "turn", "stop", "review", "connection", "search", "rename", "delete", "favorite", "folder", "core-settings", "backdrop",
  // A person's own message changes, journal first (server-chats-core-messages.ts, studio/core-scene-ops.ts).
  "edit", "hide", "select-swipe", "discard", "add-anyway", "cut", "restore-cut", "cut-version", "restore-version",
  // Takes: one rp-core session each.
  "fork", "take", "delete-take", "rename-take", "restore-take",
  // Read for each Core turn and handed to rp-core (studio/core-library.ts).
  "lore",
  "preset",
  "prompting",
  "regex", "regex-answer",
  "final-cut", "final-cut/rerun", "final-cut/rerun/apply",
  // The cast rp-core plays (CoreTurnOwner.syncCast), the opening's wording, and read-only drafts.
  "persona",
  "update-card", "revert-card", "save-member", "variant", "opening", "draft", "formula-try",
  // Outside the journal: the Trash flag on the host chat, the Cast wing's roster (no prompt reads it), and a request preview that writes nothing.
  "restore-scene", "forecast",
  "props",
  // Bunzai's own story systems read the scene and write beside it, never a message (studio/core-turn-plan.ts).
  "director-edit", "director-tracker-undo", "director-settings",
  "dramaturg-settings", "dramaturg-clear", "dramaturg-stop", "dramaturg-turn",
  "summary", "summary-settings", "summary-backfill", "summary-now",
  "tracker-state", "tracker-item", "tracker-refresh", "tracker-edit", "library-trackers", "trackers",
  "compendium", "compendium/reconcile", "compendium/undo", "compendium/undo-take", "compendium/clear-feed", "compendium/file-again",
  "compendium/ingest", "compendium/ingest-start", "compendium/ingest-cancel", "compendium/ingest-undo", "compendium/tree", "compendium/tree-build", "compendium/tree-undo", "compendium/tree-move", "compendium/standardize",
  "participants", "participants/reconcile", "participants/apply", "participants/undo",
]);
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
