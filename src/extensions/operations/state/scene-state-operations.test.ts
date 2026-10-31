/** Tests package-owned scene state reads and revision-checked writes through the broker operation boundary. */
import { describe, expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import operations from "./scene-state-operations";
import { memoryChatStore } from "../../../stage/store/chat-store";
import { CAST, SNAP } from "../../../stage/contracts/chat-store.contract-rig";
import { createExtensionSceneStateServices } from "../../runtime/scene-state-services";
import { createExtensionBroker } from "../../broker/invoke";
import { createOperations } from "./scene-state-operations";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";

const context = (): ExtensionOperationContext => ({
  principal: { storeId: "s", packageId: "fixture.extension", packageDigest: "d", apiMajor: 1, policyFingerprint: "f", grantRevision: 1, runEpoch: 1 },
  signal: new AbortController().signal, invocation: { resources: [] }, resources: [{ kind: "scene", id: "scene" }, { kind: "take", id: "take" }], grantedOperations: ["state.read", "state.write.apply"], host: "desktop", availableOperations: [], availableGrants: [], operationReceipts: [],
  access: { resources: [{ kind: "scene", id: "scene" }, { kind: "take", id: "take" }], fields: ["state"], methods: [], destinations: [] },
  commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "fixture.extension", packageDigest: "d", policyFingerprint: "f", grantRevision: 1, operation: "state.write.apply", access: { resources: [{ kind: "scene", id: "scene" }, { kind: "take", id: "take" }], fields: ["state"], methods: [], destinations: [] }, now: () => 1 },
  confirm: async () => true, assertCurrent: async () => {},
});

describe("own-package scene state operations", () => {
  test("describes only the package-owned JSON namespace", async () => {
    const result = await operations[3]!.execute({}, context(), {} as ExtensionOperationServices);
    expect(result).toEqual({ packageId: "fixture.extension", namespacePrefix: "ext:fixture.extension:", scope: "own-package", values: "JSON-only", sharedSlots: false });
    expect(operations[3]!.metadata.hosts).toEqual(["desktop", "browser", "terminal"]);
  });

  test("reads only the package namespace and sends narrowed scope to the port", async () => {
    let call: unknown[] = [];
    const services = { sceneState: { read: async (...args: unknown[]) => { call = args; return [{ slot: "ext:fixture.extension:memory", value: { count: 2 } }]; } } } as unknown as ExtensionOperationServices;
    const definition = operations[0]!;
    const result = await definition.execute({ sceneId: "scene", takeId: "take" }, context(), services);
    expect(call).toEqual(["fixture.extension", "scene", "take", [{ kind: "scene", id: "scene" }, { kind: "take", id: "take" }]]);
    expect(result.slots).toEqual([{ slot: "ext:fixture.extension:memory", value: { count: 2 } }]);
  });

  test("writes only package-prefixed slots with trusted commit and expected revision", async () => {
    let call: unknown[] = [];
    const services = { sceneState: { write: async (...args: unknown[]) => { call = args; return "applied"; } } } as unknown as ExtensionOperationServices;
    const definition = operations[2]!;
    const ctx = context();
    const input = { sceneId: "scene", takeId: "take", messageId: "message", expectedVersion: 7, deltas: [{ slot: "ext:fixture.extension:memory", path: ["count"], value: 3, at: 1 }] };
    expect(await definition.execute(input, ctx, services)).toEqual({ status: "applied", sceneId: "scene", takeId: "take", messageId: "message", turnId: null });
    expect(call.slice(0, 5)).toEqual(["fixture.extension", "scene", "take", { messageId: "message" }, 7]);
    expect(call[7]).toBe(ctx.commit);
    const pendingInput = { ...input, messageId: undefined, turnId: "active-turn" };
    const pendingServices = { sceneState: { write: async (...args: unknown[]) => { call = args; return "pending"; } } } as unknown as ExtensionOperationServices;
    expect(await definition.execute(pendingInput, ctx, pendingServices)).toEqual({ status: "pending", sceneId: "scene", takeId: "take", messageId: null, turnId: "active-turn" });
    expect(call.slice(0, 5)).toEqual(["fixture.extension", "scene", "take", { turnId: "active-turn" }, 7]);
    await expect(definition.execute({ ...input, deltas: [{ ...input.deltas[0]!, slot: "ext:other.extension:memory" }] }, context(), services)).rejects.toThrow("namespace");
  });

  test("scene and take grants must name an actual branch of that scene", async () => {
    const chats = memoryChatStore();
    const chat = await chats.createChat({ title: "Fixture", cast: CAST, snapshot: SNAP });
    const [take] = await chats.listBranches(chat.id);
    if (!take) throw new Error("fixture take unavailable");
    const services = createExtensionSceneStateServices(chats);
    const scope = [{ kind: "scene", id: chat.id }, { kind: "take", id: take.id }];
    expect(await services.read("fixture.extension", "wrong-scene", take.id, scope)).toBeNull();
    expect(await services.read("fixture.extension", chat.id, take.id, scope)).toEqual([]);
  });

  test("broker records a stale state apply as conflicted, not committed", async () => {
    const principal: OperationPrincipal = { storeId: "s", packageId: "fixture.extension", packageDigest: "d", apiMajor: 1, policyFingerprint: "f", grantRevision: 1, runEpoch: 1 };
    const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1,
      grants: [{ operation: "state.write.apply", resources: [{ kind: "scene", id: "scene" }, { kind: "take", id: "take" }], fields: ["state"], methods: [], destinations: [], duration: "persistent", budget: { requests: 10, bytes: 200_000, tokens: 0 } }] };
    const receipts: EffectReceipt[] = [];
    const apply = createOperations({ sceneState: { read: async () => [], write: async () => "stale" } } as unknown as ExtensionOperationServices).find((item) => item.id === "state.write.apply");
    if (!apply) throw new Error("state apply descriptor unavailable");
    const invoke = createExtensionBroker([apply], {
      principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
      confirm: async () => true, reserveBudget: async (_item: ExtensionBudgetReservation, _limits: ExtensionBudget) => true,
      settleBudget: async () => true, record: async (receipt: EffectReceipt) => { receipts.push(receipt); }, readReceipts: async () => [],
      now: () => 1, id: () => `r-${receipts.length}`,
      commitContext: (current, operation, access) => ({ owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: current.packageId, packageDigest: current.packageDigest,
        policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, access, now: () => 1 }),
    });
    await expect(invoke({ v: 1, type: "request", id: 1, operation: "state.write.apply", args: { sceneId: "scene", takeId: "take", messageId: "message", expectedVersion: 2,
      deltas: [{ slot: "ext:fixture.extension:memory", path: ["count"], value: 1, at: 1 }] } })).resolves.toMatchObject({ status: "stale" });
    expect(receipts.map(({ status }) => status)).toEqual(["admitted", "conflicted"]);
  });
});
