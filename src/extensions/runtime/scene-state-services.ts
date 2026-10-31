/** Package-namespaced scene state over the canonical ChatStore commit door. */
import type { ChatStore } from "../../stage/contracts/chat-store";
import type { ExtensionSceneStateServices } from "../operations/state/_services";
import type { ResourceRef } from "../contracts/operation";
import type { JsonValue } from "../contracts/value";
import { decodeJsonValue } from "../contracts/value";
import { isRecord } from "../../core/guards";

const takeInScene = async (chats: ChatStore, sceneId: string, takeId: string, scope: readonly ResourceRef[]): Promise<boolean> =>
  scope.some((resource) => resource.kind === "take" && resource.id === takeId)
  && (await chats.listBranches(sceneId)).some((branch) => branch.id === takeId);

export function createExtensionSceneStateServices(chats: ChatStore): ExtensionSceneStateServices {
  return {
    async read(packageId, sceneId, takeId, scope) {
      if (!(await takeInScene(chats, sceneId, takeId, scope))) return null;
      const state = await chats.sceneState(takeId);
      if (!state) return null;
      const prefix = `ext:${packageId}:`;
      return Object.entries(state).filter(([slot]) => slot.startsWith(prefix)).map(([slot, raw]) => {
        if (!isRecord(raw)) throw new Error("stored extension scene slot is invalid");
        const value: Record<string, JsonValue> = {};
        for (const [key, cell] of Object.entries(raw)) {
          if (!isRecord(cell) || !("value" in cell)) throw new Error("stored extension scene field is invalid");
          value[key] = decodeJsonValue(cell.value);
        }
        return { slot, value };
      });
    },
    async write(packageId, sceneId, takeId, target, expectedVersion, deltas, scope, commit) {
      if (commit.packageId !== packageId || commit.operation !== "state.write.apply" || !(await takeInScene(chats, sceneId, takeId, scope))) throw new Error("extension scene state authority is invalid");
      if (target.turnId) return await chats.appendPendingExtensionDeltas(target.turnId, packageId, expectedVersion, [...deltas], commit) ? "pending" : "stale";
      if (!target.messageId) throw new Error("a state write needs one exact message or active turn target");
      return await chats.recordExtensionMessageDeltas(commit, takeId, target.messageId, [...deltas], { expectedVersion }) ? "applied" : "stale";
    },
  };
}
