/** The host manager API for typed effect, file and host-action tickets. */
import type { ExtensionStore } from "../../stage/contracts/extension-store";
import type { ExtensionManagerApi } from "./service-api";
import { isRecord } from "../../core/guards";
import type { OperationPrincipal } from "../contracts/operation";
import type { FileActionAnswer, PendingExtensionFileAction } from "../contracts/file-actions";
import type { ExtensionHostActionAnswer, PendingExtensionHostAction } from "../contracts/host-actions";
import { extensionHostActionAnswerSchema } from "../contracts/host-actions";
import type { JsonValue } from "../contracts/value";
import type { PendingExtensionEffect } from "./confirmation";
import type { HostFileActionPort } from "./file-action-port";
import type { HostActionPort } from "./host-action-port";
import type { createExtensionHostActionView } from "./host-action-view";
import type { ExtensionRuntimeFence } from "../../stage/contracts/extension-store";
import type { ExtensionRunPrincipal } from "../contracts/host-actions";

type ActivePrincipalMap = Map<string, Set<OperationPrincipal>>;
type SceneOpenedTicket = Extract<PendingExtensionHostAction, { action: "ui.scene.open" | "composer.draft.set" }>;

export function createExtensionHostActionApi(input: {
  store: ExtensionStore;
  storeId: string;
  fileActions?: HostFileActionPort;
  hostActions?: HostActionPort;
  activePrincipals: ActivePrincipalMap;
  mutations: { exclusive<T>(action: () => Promise<T>): Promise<T> };
  hostActionView: ReturnType<typeof createExtensionHostActionView>;
  requireFence(): Promise<ExtensionRuntimeFence>;
  assertLiveFence(packageId: string): Promise<void>;
  pendingEffects?(): readonly PendingExtensionEffect[] | Promise<readonly PendingExtensionEffect[]>;
  answerEffect?(id: string, approved: boolean): boolean | Promise<boolean>;
  pendingEffectForFileAction(id: string): Promise<PendingExtensionEffect | null>;
  completedFileEffects: Map<string, "written" | "ambiguous">;
  recordSceneNavigation(ticket: SceneOpenedTicket): void;
}): Pick<ExtensionManagerApi,
  "pendingEffects" | "answerEffect" | "pendingFileActions" | "beginFileWrite" | "answerFileAction"
  | "completeFileReadChunk" | "fileWriteChunk" | "hostActions" | "claimHostAction" | "answerHostAction"> {
  return {
    async pendingEffects(): Promise<readonly PendingExtensionEffect[]> { await input.requireFence(); return await input.pendingEffects?.() ?? []; },
    async answerEffect(id: string, approved: boolean): Promise<boolean> {
      await input.requireFence();
      const effect = (await input.pendingEffects?.() ?? []).find((item) => item.id === id);
      const review = effect && isRecord(effect.review) ? effect.review : null;
      const hostAction = review && isRecord(review.hostAction) ? review.hostAction : null;
      if (hostAction) {
        if (approved) return false;
        const ticketId = (hostAction as Record<string, JsonValue>).ticketId;
        if (typeof ticketId === "string") input.fileActions?.answer(ticketId, { status: "cancelled" });
      }
      return await input.answerEffect?.(id, approved) ?? false;
    },
    async pendingFileActions(): Promise<readonly PendingExtensionFileAction[]> { await input.requireFence(); return input.fileActions?.pending() ?? []; },
    async beginFileWrite(id: string): Promise<boolean> {
      return input.mutations.exclusive(async () => {
        await input.requireFence();
        const ticket = input.fileActions?.pending().find((item) => item.id === id);
        if (!ticket || ticket.action !== "write" || ticket.principal.storeId !== input.storeId) return false;
        const active = [...(input.activePrincipals.get(ticket.packageId) ?? [])].some((principal) => sameRun(principal, ticket.principal));
        if (!active) return false;
        const control = await input.store.readControl(ticket.packageId);
        if (!control?.enabled || control.recoveryRequired || control.hostTrusted || control.packageDigest !== ticket.principal.packageDigest
          || control.grantRevision !== ticket.principal.grantRevision || !control.grants.some((grant) => grant.operation === ticket.operation)) return false;
        const effect = await input.pendingEffectForFileAction(id);
        if (!effect || effect.packageId !== ticket.packageId || effect.operation !== ticket.operation) return false;
        const review = isRecord(effect.review) ? effect.review : null;
        const hostAction = review && isRecord(review.hostAction) ? review.hostAction : null;
        if (!hostAction || hostAction.ticketId !== id) return false;
        await input.assertLiveFence(ticket.packageId);
        return input.fileActions?.beginWrite(id) ?? false;
      });
    },
    async answerFileAction(id: string, result: FileActionAnswer): Promise<boolean> {
      await input.requireFence();
      const action = input.fileActions?.pending().find((item) => item.id === id);
      if (!action) return false;
      const linked = await input.pendingEffectForFileAction(id);
      if (action.action === "write" && !linked) return false;
      if (!input.fileActions?.answer(id, result)) return false;
      if (linked) {
        if (result.status === "written" || result.status === "ambiguous") {
          input.completedFileEffects.set(id, result.status);
          while (input.completedFileEffects.size > 8) input.completedFileEffects.delete(input.completedFileEffects.keys().next().value!);
        }
        return await input.answerEffect?.(linked.id, result.status === "written" || result.status === "ambiguous") ?? false;
      }
      return result.status !== "written";
    },
    async completeFileReadChunk(id: string, offset: number, totalBytes: number, bytes: Uint8Array, final: boolean): Promise<boolean> {
      await input.requireFence(); return input.fileActions?.completeReadChunk(id, offset, totalBytes, bytes, final) ?? false;
    },
    async fileWriteChunk(id: string, offset: number) { await input.requireFence(); return input.fileActions?.writeChunk(id, offset) ?? null; },
    async hostActions() { return input.hostActionView.snapshot(); },
    async claimHostAction(id: string): Promise<PendingExtensionHostAction | null> {
      const ticket = await input.hostActionView.claim(id);
      if (ticket?.action === "ui.scene.open" || ticket?.action === "composer.draft.set") input.recordSceneNavigation(ticket);
      return ticket;
    },
    async answerHostAction(id: string, answer: ExtensionHostActionAnswer): Promise<boolean> {
      const parsed = extensionHostActionAnswerSchema.parse(answer);
      const accepted = await input.hostActionView.answer(id, parsed);
      return accepted;
    },
  };
}

function sameRun(left: OperationPrincipal, right: ExtensionRunPrincipal): boolean {
  return left.storeId === right.storeId && left.packageId === right.packageId && left.packageDigest === right.packageDigest
    && left.grantRevision === right.grantRevision && left.runEpoch === right.runEpoch;
}
