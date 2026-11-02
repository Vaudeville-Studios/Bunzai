/** Core state metadata reuses the ChatStore fold, with fenced proposals and accepted-only repair. */
import type { ChatStore } from "../../contracts/chat-store";
import type { StateSql, StateSqlDeps } from "./chat-store-state";
import { requireExtensionCommit } from "./extension-commit-guard";
import { requireCommitResource } from "../extension-commit-access";
import { checkExtensionDeltas } from "../scene-state-rules";
import { corePendingState } from "./core-pending-state";
import { liveOf } from "./swipe-sql";

export function coreStateMethods(k: StateSqlDeps & { state: StateSql; clock(): number }): Pick<ChatStore,
  "stageCoreExtensionState" | "recordCoreExtensionState" | "applyCoreExtensionState" | "discardCorePendingState"> {
  const pending = corePendingState(k.database, k.cipher, k.clock);
  return {
    async stageCoreExtensionState(commit, target, deltas) {
      return k.write(() => pending.stage(commit, target, deltas));
    },
    async recordCoreExtensionState(commit, target, raw) {
      const deltas = checkExtensionDeltas(raw, commit.packageId);
      return k.write(() => {
        if (commit.operation !== "state.write.apply") throw new Error("Core state requires its dedicated write operation");
        requireExtensionCommit(k.database, k.cipher, commit);
        requireCommitResource(commit, { kind: "scene", id: target.sceneId }, ["state"]);
        requireCommitResource(commit, { kind: "take", id: target.takeId });
        const binding = k.one<{ swipe_id: string; lease_owner: string | null; lease_until: number | null }>(`SELECT x.swipe_id, s.lease_owner, s.lease_until
          FROM core_message_links x JOIN core_scene_links l ON l.session_id = x.session_id AND l.branch_id = x.branch_id
          JOIN core_sessions s ON s.id = l.session_id JOIN branches b ON b.id = l.branch_id JOIN chats c ON c.id = l.chat_id
          JOIN messages m ON m.id = x.message_id JOIN swipes w ON w.message_id = m.id AND w.swipe_id = x.swipe_id AND w.position = m.current_swipe
          WHERE x.message_id = ? AND l.chat_id = ? AND b.id = ? AND b.version = ? AND c.active_branch_id = b.id
            AND b.deleted_at IS NULL AND c.deleted_at IS NULL AND ${liveOf("m")} AND ${liveOf("w")}`, target.messageId, target.sceneId, target.takeId, target.expectedVersion);
        if (!binding) return false;
        if (binding.lease_owner && binding.lease_until !== null && binding.lease_until > commit.now()) throw new Error("Core scene state cannot be applied while its session is active");
        return k.state.applyExtensionOnSwipe(commit.packageId, target.takeId, target.messageId, binding.swipe_id, deltas);
      });
    },
    async applyCoreExtensionState(sessionId, coreMessageId) {
      await k.write(() => {
        pending.discardAbandoned(sessionId);
        for (const row of pending.accepted(sessionId, coreMessageId)) {
          const value = pending.verifyAccepted(row);
          const mapping = k.one<{ message_id: string; swipe_id: string }>(`SELECT x.message_id, x.swipe_id FROM core_message_links x
            JOIN core_scene_links l ON l.session_id = x.session_id AND l.branch_id = x.branch_id
            WHERE x.session_id = ? AND x.core_message_id = ? AND x.branch_id = ? AND l.chat_id = ?`, sessionId, row.core_message_id, value.turn.takeId, value.turn.sceneId);
          if (!mapping) continue;
          if (!k.state.applyExtensionOnSwipe(value.owner.packageId, value.turn.takeId, mapping.message_id, mapping.swipe_id, value.deltas)) throw new Error("Accepted Core state has no writable exact message projection");
          k.run("UPDATE core_pending_extension_state SET phase = 'applied' WHERE state_hash = ? AND phase = 'accepted'", row.state_hash);
        }
      });
    },
    async discardCorePendingState(operationId, turnId) {
      await k.write(() => pending.discard(operationId, turnId));
    },
  };
}
