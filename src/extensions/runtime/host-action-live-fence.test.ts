/** Native host tickets must be claimed only under the current store lease. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import type { ExtensionOperationDescriptor, OperationPrincipal } from "../contracts/operation";
import type { ExtensionRunPrincipal, PendingExtensionHostAction } from "../contracts/host-actions";
import type { PendingExtensionFileAction } from "../contracts/file-actions";
import { createLiveFenceGuard } from "./live-fence";
import { createExtensionHostActionView } from "./host-action-view";
import { createExtensionHostActionApi } from "./service-host-actions";

test("a takeover between ticket display and claim prevents the host action", async () => {
  let now = 1_000;
  const store = memoryExtensionStore(() => now);
  const old = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", now, 30_000);
  expect(old).not.toBeNull();
  const id = "bunzai.extension.demo", digest = "a".repeat(64), policy = "b".repeat(64);
  const control = { id, revision: 1, packageDigest: digest, policyFingerprint: policy, grantRevision: 1, grants: [{ operation: "clipboard.read", resources: [], fields: [], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 1, bytes: 1, tokens: 0 } }], themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  const principal: OperationPrincipal = { storeId: "fixture", packageId: id, packageDigest: digest, apiMajor: 1, policyFingerprint: policy, grantRevision: 1, runEpoch: 2 };
  const runPrincipal: ExtensionRunPrincipal = { storeId: principal.storeId, packageId: id, packageDigest: digest, grantRevision: 1, runEpoch: 2 };
  const ticket: PendingExtensionHostAction = { id: "ticket", packageId: id, principal: runPrincipal, action: "clipboard.read", operation: "clipboard.read", expiresAt: 100_000 };
  let claimed = false, lost = false;
  const guard = createLiveFenceGuard({ store, current: () => old, replace: () => {}, unavailable: () => false, blocked: () => false, now: () => now,
    onLost: () => { lost = true; }, fail: () => new Error("lease lost") });
  const view = createExtensionHostActionView({ store: { ...store, readControl: async () => control }, storeId: principal.storeId, host: "desktop",
    operations: new Map([["clipboard.read", { id: "clipboard.read", hosts: ["desktop"] } as unknown as ExtensionOperationDescriptor]]),
    active: new Map([[id, new Set([principal])]]), requireFence: async () => old, assertLiveFence: guard,
    port: { snapshot: () => ({ actions: [ticket], panels: [], statuses: [], notices: [] }), actions: () => [ticket], get: () => ticket,
      claim: () => { claimed = true; return ticket; }, answer: () => false } as never });
  now = 31_001;
  expect(await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000002", now, 30_000)).not.toBeNull();
  await expect(view.claim(ticket.id)).rejects.toThrow("lease lost");
  expect(claimed).toBe(false);
  expect(lost).toBe(true);
});

test("file write begin refuses the native port when the lease check fails", async () => {
  const principal: OperationPrincipal = { storeId: "fixture", packageId: "bunzai.extension.demo", packageDigest: "c".repeat(64), apiMajor: 1,
    policyFingerprint: "d".repeat(64), grantRevision: 1, runEpoch: 3 };
  const ticket: PendingExtensionFileAction = { id: "write-ticket", packageId: principal.packageId, packageName: "Demo", principal: {
    storeId: principal.storeId, packageId: principal.packageId, packageDigest: principal.packageDigest, grantRevision: 1, runEpoch: 3 },
    expiresAt: 10_000, action: "write", operation: "files.write.apply", handleId: "opaque", fileName: "notes.txt", mode: "create",
    current: { size: 0, lastModified: 0, digest: "e".repeat(64) }, proposedDigest: "f".repeat(64), proposedBytes: 4 };
  let began = false;
  const api = createExtensionHostActionApi({
    store: { readControl: async () => ({ enabled: true, recoveryRequired: false, hostTrusted: false, packageDigest: principal.packageDigest,
      grantRevision: 1, grants: [{ operation: "files.write.apply" }] }) } as never,
    storeId: principal.storeId, fileActions: { pending: () => [ticket], beginWrite: () => { began = true; return true; } } as never,
    activePrincipals: new Map([[principal.packageId, new Set([principal])]]), mutations: { exclusive: (action) => action() },
    hostActionView: {} as never, requireFence: async () => ({ owner: "fixture", epoch: 1 }), assertLiveFence: async () => { throw new Error("lease lost"); },
    pendingEffectForFileAction: async () => ({ id: "effect", packageId: ticket.packageId, operation: ticket.operation,
      review: { hostAction: { ticketId: ticket.id } } } as never), completedFileEffects: new Map(), recordSceneNavigation: () => {},
  });
  await expect(api.beginFileWrite(ticket.id)).rejects.toThrow("lease lost");
  expect(began).toBe(false);
});
