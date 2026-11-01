/** Theme revision stamps detect control replacement even when summed revisions would collide. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import type { StoredExtensionControl } from "../../stage/contracts/extension-store";
import { createExtensionThemeService } from "./theme-service";

const control = (id: string, revision: number): StoredExtensionControl => ({ id, revision, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 0,
  grants: [], themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" });

test("theme revision changes when one control is removed and another advances by the same amount", async () => {
  const store = memoryExtensionStore(() => 1);
  const lease = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", 1, 30_000);
  if (!lease) throw new Error("runtime lease unavailable");
  expect(await store.compareAndSaveControl(control("first.extension", 0), -1, lease)).toBe("saved");
  expect(await store.compareAndSaveControl(control("second.extension", 0), -1, lease)).toBe("saved");
  expect(await store.compareAndSaveControl(control("first.extension", 1), 0, lease)).toBe("saved");
  const themes = createExtensionThemeService({ store, builtinPackages: [], legacyThemes: [], safeThemes: false, policyFingerprint: async () => "b".repeat(64) });
  const before = await themes.revision();
  expect(await store.removeInstalled("first.extension", 1, lease)).toBe("saved");
  expect(await store.compareAndSaveControl(control("second.extension", 1), 0, lease)).toBe("saved");
  const after = await themes.revision();
  expect(after.epoch).toBe(before.epoch);
  expect(after.revision).toBeGreaterThan(before.revision);
  await store.releaseRuntimeFence(lease);
});
