/** Public operation contract regressions for exact destination/method review and bounded host access. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { ExtensionOperationContext, OperationPrincipal } from "../../contracts/operation";
import type { JsonValue } from "../../contracts/value";
import { createExtensionBroker } from "../../broker/invoke";
import { bindExtensionOperation } from "../../contracts/operation";
import { networkOperations } from "./request";
import type { ExtensionNetworkServices } from "./_services";

const definition = networkOperations[0]!;
const invocation = { url: "https://api.example/v1", method: "POST" as const, body: { text: "share" } };
const context = (methods: string[], destinations: string[]): ExtensionOperationContext => ({
  principal: { storeId: "fixture", packageId: "example.test", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 },
  signal: new AbortController().signal, invocation: { resources: [] }, resources: [], grantedOperations: ["network.request"], host: "desktop", availableOperations: [], availableGrants: [], operationReceipts: [],
  access: { resources: [], fields: [], methods, destinations }, commit: {} as ExtensionOperationContext["commit"], confirm: async () => true, assertCurrent: async () => {},
});

test("network request resolves only the exact HTTPS origin and declared method", () => {
  expect(definition.metadata.resolveAccess(invocation)).toEqual({ resources: [], fields: [], methods: ["POST"], destinations: ["https://api.example"] });
  expect(definition.metadata.resolveAccess({ ...invocation, url: "http://api.example/v1" }).destinations).toEqual([]);
  expect(definition.metadata.resolveAccess({ ...invocation, url: "https://user:pass@api.example/v1" }).destinations).toEqual([]);
});

test("outbound payload is host-reviewed and the adapter receives only the approved method/origin and bounded response cap", async () => {
  let called: unknown[] | undefined;
  const network: ExtensionNetworkServices = { request: async (...args) => { called = args; return { status: 202, contentType: "application/json", body: "{\"ok\":true}" }; } };
  const services = { content: {} as never, network };
  const review = await definition.review!(invocation, context(["POST"], ["https://api.example"]), services);
  expect(review).toMatchObject({ method: "POST", destination: "https://api.example", path: "/v1", body: { text: "share" }, maximumResponseBytes: 262_144 });
  await expect(definition.execute(invocation, context(["POST"], ["https://api.example"]), services)).resolves.toEqual({ status: 202, contentType: "application/json", body: "{\"ok\":true}" });
  expect(called?.slice(0, 4)).toEqual([invocation.url, "POST", new TextEncoder().encode("{\"text\":\"share\"}"), 262_144]);
});

test("a method/origin mismatch and oversized body cause no host network call", async () => {
  let calls = 0;
  const services = { content: {} as never, network: { request: async () => { calls++; return { status: 200, contentType: null, body: "" }; } } as ExtensionNetworkServices };
  await expect(definition.execute(invocation, context(["GET"], ["https://api.example"]), services)).rejects.toThrow(/not approved/);
  const huge = { ...invocation, body: "x".repeat(32_769) };
  expect(definition.metadata.input.safeParse(huge).success).toBe(false);
  expect(calls).toBe(0);
});

test("the broker confirms exact HTTP method and destination before the vetted adapter sends", async () => {
  const principal: OperationPrincipal = { storeId: "fixture", packageId: "example.test", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: principal.grantRevision, grants: [{ operation: "network.request", resources: [], fields: [], methods: ["POST"], destinations: ["https://api.example"], duration: "session", budget: { requests: 5, bytes: 1_000_000, tokens: 0 } }] };
  const sent: unknown[][] = []; const records: EffectReceipt[] = []; let confirmed: JsonValue | undefined;
  const network: ExtensionNetworkServices = { request: async (...args) => { sent.push(args); return { status: 200, contentType: "text/plain", body: "ok" }; } };
  const operation = bindExtensionOperation(definition, { content: {} as never, network });
  const invoke = createExtensionBroker([operation], {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], selectedScope: () => [], signal: new AbortController().signal,
    confirm: async (effect) => { confirmed = effect; return true; }, reserveBudget: async (_reservation: ExtensionBudgetReservation, _limits: ExtensionBudget) => true,
    settleBudget: async (_packageId, _id, bytes) => bytes <= 1_000_000, record: async (receipt) => { records.push(receipt); }, readReceipts: async () => [], now: () => 5, id: () => "receipt",
    commitContext: (current, operationName, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation: operationName, now: () => 5 }),
  });
  await expect(invoke({ v: 1, type: "request", id: 1, operation: "network.request", args: invocation })).resolves.toEqual({ status: 200, contentType: "text/plain", body: "ok" });
  expect(confirmed).toMatchObject({ methods: ["POST"], destinations: ["https://api.example"], review: { method: "POST", destination: "https://api.example", body: { text: "share" } } });
  expect(sent).toHaveLength(1);
  expect(records.map(({ status }) => status)).toEqual(["admitted", "committed"]);
});
