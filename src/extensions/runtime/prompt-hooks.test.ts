/** Verifies required and repeatedly failing optional prompt hooks before host provider invocation. */
import { expect, test } from "bun:test";
import { canonicalJsonBytes } from "../contracts/value";
import { decodeExtensionPackageInput } from "../contracts/package-validation";
import { createOperations } from "../operations/prompts/operations";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { storedExtensionControlSchema } from "../../stage/store/extension-store-rules";
import { createPromptHookRunner } from "./prompt-hooks";

async function fixture(required: boolean) {
  const store = memoryExtensionStore(() => 1);
  const fence = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", 1, 30_000);
  if (!fence) throw new Error("fixture runtime fence unavailable");
  const decoded = await decodeExtensionPackageInput({ manifest: {
    schemaVersion: 1, id: required ? "example.required-prompt" : "example.optional-prompt", version: "1.0.0", name: "Prompt", description: "", author: "test",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
    requirements: [{ operation: "prompts.contribute", resources: ["scene"], fields: ["system.append"], methods: [], destinations: [], purpose: "test hook failure policy", required: false }],
    contributions: [{ type: "prompt", id: "write", label: "Write", stage: "system.append", required }],
  }, files: { "main.js": "throw new Error('fixture failure')" } });
  await store.savePackage({ digest: decoded.digest, bytes: canonicalJsonBytes(decoded.package) }, fence);
  const control = {
    id: decoded.package.manifest.id, revision: 0, packageDigest: decoded.digest, policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "prompts.contribute", resources: [{ kind: "scene", id: "scene-1" }], fields: ["system.append"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 10, bytes: 20_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const,
  };
  await store.compareAndSaveControl(control, -1, fence);
  let activations = 0;
  let fail = true;
  let revokeAfterActivation = false;
  const run = createPromptHookRunner(store, createOperations({ content: {} as never }), async () => fence, async (_id, _kind, _contribution, _input, invocation) => {
    activations++;
    if (fail) throw new Error("hook failed");
    invocation?.contribute("candidate");
    if (revokeAfterActivation) {
      const current = await store.readControl(control.id);
      if (current) await store.compareAndSaveControl({ ...current, enabled: false, revision: current.revision + 1 }, current.revision, fence);
    }
  });
  return { store, control, run, activations: () => activations, setFail: (value: boolean) => { fail = value; }, revokeAfterActivation: () => { revokeAfterActivation = true; }, fence };
}

test("required prompt hook failure rejects the turn before the caller can send to a provider", async () => {
  const item = await fixture(true);
  await expect(item.run("scene-2", [{ role: "system", content: "unapproved scene" }], new AbortController().signal)).resolves.toEqual([]);
  expect(item.activations()).toBe(0);
  await expect(item.run("scene-1", [{ role: "system", content: "safe input" }], new AbortController().signal)).rejects.toThrow("hook failed");
  expect(item.activations()).toBe(1);
  expect(await item.store.readControl(item.control.id)).toMatchObject({ suspendedPromptIds: [], promptFailures: [] });
  await item.store.releaseRuntimeFence(item.fence);
});

test("pre-hook control records decode with empty failure state", async () => {
  const item = await fixture(false);
  const { promptFailures: _failures, suspendedPromptIds: _suspended, ...previous } = item.control;
  expect(storedExtensionControlSchema.parse(previous)).toMatchObject({ promptFailures: [], suspendedPromptIds: [] });
  await item.store.releaseRuntimeFence(item.fence);
});

test("optional prompt hooks reset after success and suspend after three consecutive failures", async () => {
  const item = await fixture(false);
  for (let attempt = 0; attempt < 2; attempt++) await expect(item.run("scene-1", [], new AbortController().signal)).resolves.toEqual([]);
  expect(await item.store.readControl(item.control.id)).toMatchObject({ suspendedPromptIds: [], promptFailures: [{ id: "write", count: 2 }] });
  item.setFail(false);
  await expect(item.run("scene-1", [], new AbortController().signal)).resolves.toEqual(["candidate"]);
  expect(await item.store.readControl(item.control.id)).toMatchObject({ suspendedPromptIds: [], promptFailures: [] });
  item.setFail(true);
  for (let attempt = 0; attempt < 3; attempt++) await expect(item.run("scene-1", [], new AbortController().signal)).resolves.toEqual([]);
  expect(item.activations()).toBe(6);
  expect(await item.store.readControl(item.control.id)).toMatchObject({ suspendedPromptIds: ["write"], promptFailures: [] });
  await expect(item.run("scene-1", [], new AbortController().signal)).resolves.toEqual([]);
  expect(item.activations()).toBe(6);
  await item.store.releaseRuntimeFence(item.fence);
});

test("a candidate is discarded when package control is revoked before acceptance", async () => {
  const required = await fixture(true);
  required.setFail(false);
  required.revokeAfterActivation();
  await expect(required.run("scene-1", [], new AbortController().signal)).rejects.toThrow("revoked before acceptance");
  expect(await required.store.readControl(required.control.id)).toMatchObject({ enabled: false });
  await required.store.releaseRuntimeFence(required.fence);

  const optional = await fixture(false);
  optional.setFail(false);
  optional.revokeAfterActivation();
  await expect(optional.run("scene-1", [], new AbortController().signal)).resolves.toEqual([]);
  expect(await optional.store.readControl(optional.control.id)).toMatchObject({ enabled: false });
  await optional.store.releaseRuntimeFence(optional.fence);
});
