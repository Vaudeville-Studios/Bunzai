/** Own-namespace scene state port; writes require broker-created commit context. */
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";
import type { ResourceRef } from "../../contracts/operation";
import type { JsonValue } from "../../contracts/value";
import type { Delta } from "../../../core/scene-state/types";

export interface ExtensionSceneStateServices {
  read(packageId: string, sceneId: string, takeId: string, scope: readonly ResourceRef[]): Promise<readonly { slot: string; value: JsonValue }[] | null>;
  write(packageId: string, sceneId: string, takeId: string, target: { messageId?: string; turnId?: string }, expectedVersion: number, deltas: readonly Delta[], scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<"applied" | "pending" | "stale">;
}
