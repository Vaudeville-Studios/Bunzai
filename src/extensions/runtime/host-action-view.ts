/** Filters per-store host UI state through current controls, grants, package declarations and live tickets. */
import { extensionHostActionSnapshotSchema, type ExtensionHostActionAnswer, type ExtensionRunPrincipal } from "../contracts/host-actions";
import { inspectExtensionPackage } from "../contracts/package-validation";
import type { ExtensionOperationDescriptor, HostFeature, OperationPrincipal } from "../contracts/operation";
import type { ExtensionStore } from "../../stage/contracts/extension-store";
import type { HostActionPort } from "./host-action-port";

const samePrincipal = (left: OperationPrincipal | ExtensionRunPrincipal, right: OperationPrincipal | ExtensionRunPrincipal): boolean =>
  left.storeId === right.storeId && left.packageId === right.packageId && left.packageDigest === right.packageDigest
  && left.grantRevision === right.grantRevision && left.runEpoch === right.runEpoch;

export function createExtensionHostActionView(input: {
  store: ExtensionStore; port?: HostActionPort; storeId: string; host: HostFeature;
  operations: ReadonlyMap<string, ExtensionOperationDescriptor>; active: ReadonlyMap<string, ReadonlySet<OperationPrincipal>>;
  requireFence(): Promise<unknown>;
  assertLiveFence(packageId: string): Promise<void>;
}) {
  const current = async (principal: ExtensionRunPrincipal, operation: string, requireActive: boolean) => {
    if (principal.storeId !== input.storeId || (requireActive && ![...(input.active.get(principal.packageId) ?? [])].some((item) => samePrincipal(item, principal)))) return null;
    const descriptor = input.operations.get(operation);
    if (!descriptor?.hosts.includes(input.host)) return null;
    const control = await input.store.readControl(principal.packageId);
    if (!control?.enabled || control.recoveryRequired || control.hostTrusted || control.packageDigest !== principal.packageDigest
      || control.grantRevision !== principal.grantRevision
      || !control.grants.some((grant) => grant.operation === operation)) return null;
    return control;
  };
  const declaredPanel = async (packageId: string, digest: string, contributionId: string): Promise<boolean> => {
    const stored = await input.store.readPackage(digest);
    if (!stored) return false;
    try {
      const pkg = (await inspectExtensionPackage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown)).package;
      return pkg.manifest.id === packageId && pkg.manifest.contributions.some((item) => item.type === "panel" && item.id === contributionId);
    } catch { return false; }
  };
  return {
    async snapshot() {
      await input.requireFence();
      const raw = input.port?.snapshot() ?? { actions: [], panels: [], statuses: [], notices: [] };
      const actions = [];
      for (const ticket of raw.actions) if (await current(ticket.principal, ticket.operation, true)) actions.push(ticket);
      const panels = [];
      for (const panel of raw.panels) {
        if (panel.digest === panel.principal.packageDigest && await current(panel.principal, "ui.panel.set", false)
          && await declaredPanel(panel.packageId, panel.digest, panel.contributionId)) panels.push(panel);
      }
      const statuses = [];
      for (const status of raw.statuses) if (await current(status.principal, "ui.status.set", false)) statuses.push(status);
      const notices = [];
      for (const notice of raw.notices) if (await current(notice.principal, "ui.notice.show", false)) notices.push(notice);
      return extensionHostActionSnapshotSchema.parse({ actions, panels, statuses, notices });
    },
    async answer(id: string, answer: ExtensionHostActionAnswer) {
      await input.requireFence();
      const ticket = input.port?.get(id);
      if (!ticket || !await current(ticket.principal, ticket.operation, true)) return false;
      return input.port?.answer(id, answer) ?? false;
    },
    async claim(id: string) {
      await input.requireFence();
      const candidate = input.port?.actions().find((item) => item.id === id);
      if (!candidate || !await current(candidate.principal, candidate.operation, true)) return null;
      await input.assertLiveFence(candidate.packageId);
      const ticket = input.port?.claim(id);
      if (!ticket || !await current(ticket.principal, ticket.operation, true)) {
        if (ticket) input.port?.answer(id, { status: "cancelled" });
        return null;
      }
      return ticket;
    },
  };
}
