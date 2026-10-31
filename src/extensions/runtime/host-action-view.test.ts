/** Host action projections must stay bound to the active package run. */
import { expect, test } from "bun:test";
import type { ExtensionOperationDescriptor, OperationPrincipal } from "../contracts/operation";
import type { ExtensionRunPrincipal, PendingExtensionHostAction } from "../contracts/host-actions";
import { createExtensionHostActionView } from "./host-action-view";

test("an active run's host action is visible and answerable", async () => {
  const principal: OperationPrincipal = { storeId: "fixture", packageId: "bunzai.extension.demo", packageDigest: "a".repeat(64), apiMajor: 1,
    policyFingerprint: "b".repeat(64), grantRevision: 3, runEpoch: 8 };
  const runPrincipal: ExtensionRunPrincipal = { storeId: principal.storeId, packageId: principal.packageId, packageDigest: principal.packageDigest,
    grantRevision: principal.grantRevision, runEpoch: principal.runEpoch };
  const ticket: PendingExtensionHostAction = { id: "ticket", packageId: principal.packageId, principal: runPrincipal,
    action: "clipboard.read", operation: "clipboard.read", expiresAt: 100 };
  const control = { id: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint,
    grantRevision: principal.grantRevision, enabled: true, recoveryRequired: false, hostTrusted: false, grants: [{ operation: "clipboard.read" }] };
  let answered = false, claimed = false;
  const view = createExtensionHostActionView({
    store: { readControl: async () => control } as never, storeId: principal.storeId, host: "desktop",
    operations: new Map([["clipboard.read", { id: "clipboard.read", hosts: ["desktop"] } as unknown as ExtensionOperationDescriptor]]),
    active: new Map([[principal.packageId, new Set([principal])]]), requireFence: async () => undefined, assertLiveFence: async () => {},
    port: { snapshot: () => ({ actions: [ticket], panels: [], statuses: [], notices: [] }), actions: () => [ticket], get: () => ticket,
      claim: () => { if (claimed) return null; claimed = true; return ticket; },
      answer: () => { answered = true; return true; } } as never,
  });
  expect((await view.snapshot()).actions).toEqual([ticket]);
  expect(await view.claim(ticket.id)).toEqual(ticket);
  expect(await view.claim(ticket.id)).toBeNull();
  expect(await view.answer(ticket.id, { status: "read", text: "safe" })).toBe(true);
  expect(answered).toBe(true);
});
