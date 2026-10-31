/** Tests exact scene and content resource scopes for extension event subscriptions. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import operations from "./subscription-operations";

const context = (operation: string): ExtensionOperationContext => ({
  principal: { storeId: "store", packageId: "fixture.extension", packageDigest: "d", apiMajor: 1, policyFingerprint: "f", grantRevision: 1, runEpoch: 1 },
  signal: new AbortController().signal, invocation: { resources: [] }, resources: [{ kind: "event", id: "scene.turn.completed" }, { kind: "scene", id: "scene-1" }],
  grantedOperations: [operation], host: "desktop", availableOperations: [], availableGrants: [], operationReceipts: [],
  access: { resources: [{ kind: "event", id: "scene.turn.completed" }, { kind: "scene", id: "scene-1" }], fields: ["payload"], methods: [], destinations: [] },
  commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "fixture.extension", packageDigest: "d", policyFingerprint: "f", grantRevision: 1, operation, access: { resources: [{ kind: "event", id: "scene.turn.completed" }, { kind: "scene", id: "scene-1" }], fields: ["payload"], methods: [], destinations: [] }, now: () => 1 },
  confirm: async () => true, assertCurrent: async () => {},
});

test("event subscription operations persist only the package, event and scene authority", async () => {
  let call: unknown[] = [];
  const services = { events: {
    subscribe: async (...args: unknown[]) => { call = args; return true; },
    unsubscribe: async (...args: unknown[]) => { call = args; return true; },
  } } as unknown as ExtensionOperationServices;
  const input = { scope: "scene" as const, event: "scene.turn.completed" as const, sceneId: "scene-1" };
  const ctx = context("events.subscribe");
  expect(await operations[0]!.execute(input, ctx, services)).toEqual({ status: "subscribed" });
  expect(call).toEqual(["fixture.extension", input, ctx.commit]);
  expect(await operations[0]!.review!(input, ctx, services)).toEqual({ action: "subscribe", ...input });
  const off = context("events.unsubscribe");
  expect(await operations[1]!.execute(input, off, services)).toEqual({ status: "unsubscribed" });
  expect(call[2]).toBe(off.commit);
  const content = { scope: "content" as const, event: "content.changed" as const, resource: { kind: "character" as const, id: "vera" } };
  expect(await operations[0]!.execute(content, ctx, services)).toEqual({ status: "subscribed" });
  expect(call).toEqual(["fixture.extension", content, ctx.commit]);
});
