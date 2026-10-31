/** Tests bounded event dispatch admission, package subscriptions and isolated activations. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createExtensionEventDispatcher } from "./event-dispatch";

const uuid = "00000000-0000-4000-8000-000000000001";

test("invalid event payloads never consume bounded queue slots", async () => {
  const dispatcher = createExtensionEventDispatcher(memoryExtensionStore(() => 1), async () => undefined, async () => undefined);
  for (let index = 0; index < 40; index++) await expect(dispatcher.dispatch({ type: "content.changed", kind: "bad", id: "x", revision: "1", invalidations: [] })).rejects.toThrow();
  expect(dispatcher.status()).toEqual({ queued: 0, dropped: 0 });
  await dispatcher.dispatch({ type: "scene.opened", sceneId: "scene-1" });
  expect(dispatcher.status().queued).toBe(0);
  await dispatcher.close();
});

test("content event A to B to A cascades terminate at the host depth bound", async () => {
  const store = memoryExtensionStore(() => 1_000);
  const fence = await store.acquireRuntimeFence(uuid, 1_000, 30_000);
  for (const id of ["fixture.a", "fixture.b"]) {
    expect(await store.compareAndSaveControl({ id, revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 0,
      grants: [{ operation: "events.subscribe", resources: [{ kind: "event", id: "content.changed" }, { kind: "character", id: "Ada" }], fields: [], methods: [], destinations: [],
        duration: "persistent", budget: { requests: 100, bytes: 10_000, tokens: 0 } }], themeScopes: [],
      eventSubscriptions: [{ scope: "content", event: "content.changed", resource: { kind: "character", id: "Ada" } }], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
      enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" }, -1, fence!)).toBe("saved");
  }
  let dispatcher!: ReturnType<typeof createExtensionEventDispatcher>;
  const runs = new Map<string, number>();
  let observedResources: readonly { kind: string; id: string }[] = [];
  dispatcher = createExtensionEventDispatcher(store, async () => undefined, async (id, _kind, _contribution, _input, hostContext) => {
    observedResources = hostContext.resources;
    runs.set(id, (runs.get(id) ?? 0) + 1);
    await dispatcher.dispatch({ type: "content.changed", kind: "character", id: "Ada", revision: `${runs.get(id)}`, invalidations: ["body"] }, id);
  });
  await dispatcher.dispatch({ type: "content.changed", kind: "character", id: "Ada", revision: "1", invalidations: ["body"] });
  await dispatcher.close();
  expect(runs.get("fixture.a")).toBeGreaterThan(0);
  expect(runs.get("fixture.b")).toBeGreaterThan(0);
  expect(observedResources).toEqual([{ kind: "character", id: "Ada" }]);
  expect((runs.get("fixture.a") ?? 0) + (runs.get("fixture.b") ?? 0)).toBeLessThan(32);
  expect(dispatcher.status().dropped).toBeGreaterThan(0);
});
