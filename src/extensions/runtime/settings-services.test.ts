/** Exercises schema-bound settings against the same fenced package-data store as extension storage. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { canonicalJsonBytes, digestJson, MAX_EXTENSION_PACKAGE_BYTES } from "../contracts/value";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import { EXTENSION_SETTINGS_DATA_KEY } from "../operations/settings/_services";
import { keySchema } from "../operations/storage/_schemas";
import { extensionSettingsServices } from "./settings-services";

const owner = "00000000-0000-4000-8000-000000000001";
const id = "bunzai.extension.settings-fixture";
const packageInput = {
  manifest: {
    schemaVersion: 1 as const, id, version: "1.0.0", name: "Settings Fixture", description: "", author: "test",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
    requirements: [{ operation: "settings.update", resources: [], fields: ["settings"], methods: [], destinations: [], purpose: "Change extension preferences", required: false }],
    contributions: [],
    settingsSchema: { type: "object", properties: { mode: { type: "string", enum: ["quiet", "loud"] }, count: { type: "integer", minimum: 0, maximum: 4 } }, required: ["mode"], additionalProperties: false },
    settings: { mode: "quiet", count: 1 },
  }, files: { "main.js": "bunzai.extension.define({});" },
};

test("settings read defaults and update use the package schema, digest, and CAS fence", async () => {
  const store = memoryExtensionStore(() => 1_000);
  const fence = await store.acquireRuntimeFence(owner, 1_000, 30_000);
  const digest = await digestJson(packageInput, MAX_EXTENSION_PACKAGE_BYTES);
  await store.savePackage({ digest, bytes: canonicalJsonBytes(packageInput, MAX_EXTENSION_PACKAGE_BYTES) }, fence!);
  const policyFingerprint = "b".repeat(64);
  await store.compareAndSaveControl({
    id, revision: 0, packageDigest: digest, policyFingerprint, grantRevision: 1,
    grants: [{ operation: "settings.update", resources: [], fields: ["settings"], methods: [], destinations: [], duration: "persistent", budget: { requests: 5, bytes: 50_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete",
  }, -1, fence!);
  const settings = extensionSettingsServices(store);
  expect(await settings.read(id, digest)).toMatchObject({ value: { mode: "quiet", count: 1 }, revision: -1 });
  const commit: ExtensionCommitContext = { owner, epoch: 1, packageId: id, packageDigest: digest, policyFingerprint, grantRevision: 1, operation: "settings.update", access: { resources: [], fields: ["settings"], methods: [], destinations: [] }, now: () => 1_000 };
  await expect(settings.write(id, digest, { mode: "loud", count: 2 }, -1, commit)).resolves.toEqual({ status: "saved", revision: 0 });
  expect(await settings.read(id, digest)).toMatchObject({ value: { mode: "loud", count: 2 }, revision: 0 });
  await expect(settings.write(id, digest, { mode: "quiet", count: 2 }, -1, commit)).resolves.toEqual({ status: "stale" });
  await expect(settings.write(id, digest, { mode: "invalid", count: 2 }, 0, commit)).rejects.toThrow();
  await expect(settings.read(id, "a".repeat(64))).rejects.toThrow();
});

test("generic storage cannot address the reserved settings key", () => {
  expect(keySchema.safeParse("preferences").success).toBe(true);
  expect(keySchema.safeParse(EXTENSION_SETTINGS_DATA_KEY).success).toBe(false);
});
