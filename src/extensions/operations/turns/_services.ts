/** Narrow roleplay-core adapter; implementations must use the caller's exact commit fence. */
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import type { ExtensionTurnKind, ExtensionTurnOutcome, ExtensionTurnStatus } from "../../contracts/turns";

export interface ExtensionTurnFollowOn { summary: boolean; compendium: boolean; lorebookIds: readonly string[] }
export interface ExtensionTurnConnectionSnapshot { model: string; fingerprint: string }

export interface ExtensionTurnServices {
  review(sceneId: string, kind: ExtensionTurnKind, expectedVersion: number, scope: readonly { kind: string; id: string }[], followOn: ExtensionTurnFollowOn): Promise<{ connectionId: string; model: string; configFingerprint: string; branchVersion: number } | null>;
  run(principal: OperationPrincipal, sceneId: string, connectionId: string, approvedModel: string, configFingerprint: string, kind: ExtensionTurnKind, expectedVersion: number, scope: readonly { kind: string; id: string }[], commit: ExtensionCommitContext, signal: AbortSignal, assertCurrent: () => Promise<void>): Promise<ExtensionTurnOutcome>;
  cancel(packageId: string, sceneId: string, turnId: string, scope: readonly { kind: string; id: string }[]): Promise<boolean>;
  status(packageId: string, sceneId: string, scope: readonly { kind: string; id: string }[]): Promise<ExtensionTurnStatus>;
}
