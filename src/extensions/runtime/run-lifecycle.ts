/** Stops package workers after settling any begun native file write as ambiguous. */
import type { OperationPrincipal } from "../contracts/operation";
import type { FileActionAnswer, PendingExtensionFileAction } from "../contracts/file-actions";
import type { HostActionPort } from "./host-action-port";
import type { HostFileActionPort } from "./file-action-port";

type TrackedCall = { operation: string; settled: Promise<void> };

export function createExtensionRunStopper(input: {
  stoppingPackages: Set<string>;
  activeRuns: Map<string, Set<AbortController>>;
  activePrincipals: Map<string, Set<OperationPrincipal>>;
  runPrincipals: Map<AbortController, OperationPrincipal>;
  brokerCalls: Map<AbortController, Set<TrackedCall>>;
  fileActions?: HostFileActionPort;
  hostActions?: HostActionPort;
  answerFileAction(id: string, result: FileActionAnswer): Promise<boolean>;
}) {
  return async function stopPackageRuns(packageId: string): Promise<void> {
    input.stoppingPackages.add(packageId);
    const settlements = new Set<Promise<void>>();
    for (const ticketId of input.fileActions?.startedWritesForPackage(packageId) ?? []) {
      const ticket = input.fileActions?.pending().find((item): item is Extract<PendingExtensionFileAction, { action: "write" }> => item.id === ticketId && item.action === "write");
      if (!ticket) continue;
      const settled = await input.answerFileAction(ticket.id, { status: "ambiguous", bytes: ticket.proposedBytes,
        digest: ticket.proposedDigest, consistency: "commit-unknown" }).catch(() => false);
      if (settled) for (const [controller, principal] of input.runPrincipals) {
        if (principal.packageId === ticket.packageId && principal.runEpoch === ticket.principal.runEpoch) {
          for (const call of input.brokerCalls.get(controller) ?? []) if (call.operation === ticket.operation) settlements.add(call.settled);
        }
      }
    }
    const runs = input.activeRuns.get(packageId) ?? new Set<AbortController>();
    await Promise.allSettled([...settlements]);
    for (const controller of runs) controller.abort();
    input.activeRuns.delete(packageId);
    input.activePrincipals.delete(packageId);
    input.fileActions?.invalidatePackage(packageId);
    input.hostActions?.invalidatePackage(packageId);
  };
}
