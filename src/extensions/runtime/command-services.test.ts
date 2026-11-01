/** Exercises command subset replacement against an isolated, fenced ExtensionStore. */
import { expect, test } from "bun:test";
import { canonicalJsonBytes } from "../contracts/value";
import { decodeExtensionPackageInput } from "../contracts/package-validation";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { extensionCommandServices } from "./command-services";

test("command registrations are a fenced CAS subset of the immutable manifest", async () => {
  const store = memoryExtensionStore(() => 1);
  const fence = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", 1, 30_000);
  expect(fence).not.toBeNull();
  const pkg = await decodeExtensionPackageInput({ manifest: {
    schemaVersion: 1, id: "example.commands", version: "1.0.0", name: "Commands", description: "", author: "test",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js", requirements: [],
    contributions: [
      { type: "command", id: "run", label: "Run", operation: "commands.register" },
      { type: "command", id: "inspect", label: "Inspect", operation: "commands.register" },
    ],
  }, files: { "main.js": "bunzai.extension.define({commands:{run:()=>null,inspect:()=>null}});" } });
  await store.savePackage({ digest: pkg.digest, bytes: canonicalJsonBytes(pkg.package) }, fence!);
  const control = {
    id: "example.commands", revision: 0, packageDigest: pkg.digest, policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "commands.register", resources: [], fields: ["commands"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 5, bytes: 50_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: ["run", "inspect"], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const,
  };
  expect(await store.compareAndSaveControl(control, -1, fence!)).toBe("saved");
  const commit = { ...fence!, packageId: control.id, packageDigest: pkg.digest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "commands.register", access: { resources: [], fields: ["commands"], methods: [], destinations: [] }, now: () => 1 };
  const services = extensionCommandServices(store);
  await expect(services.replaceRegistered(control.id, ["run"], commit)).resolves.toEqual({ status: "saved", registered: ["run"], revision: 1 });
  expect(await services.registered(control.id)).toEqual(["run"]);
  await expect(services.replaceRegistered(control.id, ["other"], commit)).rejects.toThrow(/exact subset/);
  expect(await store.readControl(control.id)).toMatchObject({ revision: 1, grantRevision: 1, registeredCommands: ["run"] });
  await store.releaseRuntimeFence(fence!);
});
