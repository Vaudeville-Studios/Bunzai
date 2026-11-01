/** Purpose: verify Browser, Terminal, and Desktop can share one fenced event-subscription owner. */
import { expect, test } from "bun:test";
import { canonicalJsonBytes } from "../contracts/value";
import { decodeExtensionPackageInput } from "../contracts/package-validation";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createExtensionEventServices } from "./event-services";

test("event subscriptions require a declared panel event, exact grants and fenced CAS", async () => {
  const store = memoryExtensionStore(() => 1);
  const fence = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", 1, 30_000);
  if (!fence) throw new Error("fixture could not acquire runtime fence");
  const pkg = await decodeExtensionPackageInput({ manifest: {
    schemaVersion: 1, id: "example.events", version: "1.0.0", name: "Events", description: "", author: "test",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js", requirements: [],
    contributions: [{ type: "panel", id: "watch", title: "Watch", events: ["content.changed"] }],
  }, files: { "main.js": "bunzai.extension.define({events:{'content.changed':()=>null}});" } });
  await store.savePackage({ digest: pkg.digest, bytes: canonicalJsonBytes(pkg.package) }, fence);
  const control = {
    id: "example.events", revision: 0, packageDigest: pkg.digest, policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: ["events.subscribe", "events.unsubscribe"].map((operation) => ({ operation, resources: [
      { kind: "event", id: "content.changed" }, { kind: "character", id: "Ada" },
    ], fields: ["payload"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 5, bytes: 50_000, tokens: 0 } })),
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const,
  };
  expect(await store.compareAndSaveControl(control, -1, fence)).toBe("saved");
  const commit = (operation: "events.subscribe" | "events.unsubscribe") => ({ ...fence, packageId: control.id, packageDigest: pkg.digest,
    policyFingerprint: control.policyFingerprint, grantRevision: control.grantRevision, operation, access: { resources: [{ kind: "event", id: "content.changed" }, { kind: "character", id: "Ada" }], fields: ["payload"], methods: [], destinations: [] }, now: () => 1 });
  const services = createExtensionEventServices(store);
  const subscription = { scope: "content" as const, event: "content.changed" as const, resource: { kind: "character" as const, id: "Ada" } };
  expect(await services.subscribe(control.id, subscription, commit("events.subscribe"))).toBe(true);
  expect(await services.subscribe(control.id, subscription, commit("events.subscribe"))).toBe(false);
  expect(await store.readControl(control.id)).toMatchObject({ revision: 1, eventSubscriptions: [subscription] });
  await expect(services.subscribe(control.id, { ...subscription, resource: { kind: "character", id: "Bea" } }, commit("events.subscribe"))).rejects.toThrow(/authority changed/);
  expect(await services.unsubscribe(control.id, subscription, commit("events.unsubscribe"))).toBe(true);
  expect(await store.readControl(control.id)).toMatchObject({ revision: 2, eventSubscriptions: [] });
  await store.releaseRuntimeFence(fence);
});
