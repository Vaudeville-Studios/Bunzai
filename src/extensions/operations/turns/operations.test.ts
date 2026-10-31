/** Exercises turn follow-on access after broker grant matching and before the native service call. */
import { expect, test } from "bun:test";
import { createOperations } from "./operations";
import type { ExtensionTurnServices } from "./_services";
import { createExtensionBroker } from "../../broker/invoke";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";

const principal = { storeId: "fixture", packageId: "fixture.turns", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const sceneId = "scene-1";
const connectionId = "connection-1";
const baseFields = ["turn.run", "model.prompt"];
const followFields = ["summary.automatic.write", "summary.error.write", "compendium.receipts.write", "lorebook.entries.write"];

function harness(resources: { kind: string; id: string }[], fields: string[], writableBooks: readonly string[] = ["book-1"]) {
  let sequence = 0;
  let reviewed: { scope: readonly { kind: string; id: string }[]; followOn: { summary: boolean; compendium: boolean; lorebookIds: readonly string[] } } | undefined;
  let executedAccess: ExtensionCommitContext["access"];
  const services: ExtensionTurnServices = {
    review: async (_scene, _kind, _version, scope, followOn) => {
      reviewed = { scope, followOn };
      if (followOn.lorebookIds.some((id) => !writableBooks.includes(id))) return null;
      return { connectionId, model: "model-1", configFingerprint: "c".repeat(64), branchVersion: 3 };
    },
    run: async (_principal, _scene, _connection, _model, _fingerprint, _kind, _version, _scope, commit) => {
      executedAccess = commit.access;
      return { sceneId, status: "completed", turnId: "turn-1", messageId: "message-1" };
    },
    cancel: async () => false,
    status: async () => ({ sceneId, status: "idle", turnId: null, kind: null }),
  };
  const grant = {
    operation: "turns.start",
    resources,
    fields,
    methods: [],
    destinations: [`connection:${connectionId}`],
    duration: "persistent" as const,
    budget: { requests: 5, bytes: 100_000, tokens: 10_000 },
  };
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [grant] };
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  const content = {
    listSummaries: async () => [], searchSummaries: async () => [], readSummary: async () => null, readBody: async () => null,
    readSelectedFields: async () => null, readFields: async () => null, readPersonaIdentity: async () => null, readLinks: async () => null,
    listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null,
  };
  const invoke = createExtensionBroker(createOperations({ content, turns: services }).filter((operation) => operation.id === "turns.start"), {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => true,
    reserveBudget: async (reservation: ExtensionBudgetReservation, _limits: ExtensionBudget) => { reservations.push(reservation); return true; },
    settleBudget: async (_packageId, id) => reservations.some((item) => item.id === id),
    record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `receipt-${++sequence}`,
    commitContext: (current, operation, access) => ({ owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, access, now: () => 1 }),
  });
  const request = (followOn?: { summary: boolean; compendium: boolean; lorebookIds: string[] }) => invoke({
    v: 1, type: "request", id: 1, operation: "turns.start", args: { sceneId, connectionId, expectedVersion: 3, ...(followOn ? { followOn } : {}) },
  });
  return { request, get reviewed() { return reviewed; }, get executedAccess() { return executedAccess; }, receipts };
}

const exactResources = (books: string[] = []) => [
  { kind: "scene", id: sceneId }, { kind: "host-connection", id: connectionId }, ...books.map((id) => ({ kind: "lorebook", id })),
];

test("broker resolves no background access unless selected, and only the selected follow-on scopes", async () => {
  const base = harness(exactResources(), baseFields);
  await base.request();
  expect(base.reviewed?.followOn).toEqual({ summary: false, compendium: false, lorebookIds: [] });
  expect(base.reviewed?.scope).toEqual(exactResources());
  expect(base.executedAccess?.fields).toEqual(baseFields);

  const summary = harness(exactResources(), [...baseFields, "summary.automatic.write", "summary.error.write"]);
  await summary.request({ summary: true, compendium: false, lorebookIds: [] });
  expect(summary.executedAccess?.fields).toEqual([...baseFields, "summary.automatic.write", "summary.error.write"]);
  expect(summary.executedAccess?.resources).toEqual(exactResources());

  const compendium = harness(exactResources(["book-1"]), [...baseFields, "compendium.receipts.write", "lorebook.entries.write"]);
  await compendium.request({ summary: false, compendium: true, lorebookIds: ["book-1"] });
  expect(compendium.executedAccess?.fields).toEqual([...baseFields, "compendium.receipts.write", "lorebook.entries.write"]);
  expect(compendium.executedAccess?.resources).toEqual(exactResources(["book-1"]));
});

test("broker review fails closed when a selected lorebook is not currently writable", async () => {
  const broker = harness(exactResources(["book-2"]), [...baseFields, ...followFields], []);
  await expect(broker.request({ summary: false, compendium: true, lorebookIds: ["book-2"] })).rejects.toThrow("review the turn again");
  expect(broker.executedAccess).toBeUndefined();
  expect(broker.receipts.some(({ status }) => status === "admitted")).toBe(false);
});
