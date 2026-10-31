/** Memory StateStore commit fencing for extension scene-state writes. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "./extension-store";
import { memoryStateStore } from "./state-store";

test("browser state CAS checks the live extension control at the synchronous write door", async () => {
  const now = 1_000;
  const owner = "00000000-0000-4000-8000-000000000001";
  const extensions = memoryExtensionStore(() => now);
  const lease = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const control = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "collections.create", resources: [{ kind: "library", id: "library" }], fields: ["collections"], methods: [], destinations: [], duration: "persistent" as const,
      budget: { requests: 4, bytes: 20_000, tokens: 0 } }], themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true,
    recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const state = memoryStateStore({ authorizeExtensionCommit: (context) => extensions.assertCommitContext(context) });
  const readVersioned = state.readVersioned;
  const compareAndWrite = state.compareAndWrite;
  if (!readVersioned || !compareAndWrite) throw new Error("fixture state store lacks extension CAS support");
  const context = { ...lease, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "collections.create", access: { resources: [{ kind: "library", id: "library" }], fields: ["collections"], methods: [], destinations: [] }, now: () => now };
  expect(await readVersioned("collections")).toEqual({ text: null, revision: -1 });
  expect(await compareAndWrite("collections", "{}", -1, context)).toBe("saved");
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease)).toBe("saved");
  await expect(compareAndWrite("collections", "{\"late\":true}", 0, context)).rejects.toThrow("authority changed");
  expect(await state.read("collections")).toBe("{}");
});
