/** User-action relay tests for bounded tickets, lifecycle invalidation and host-drawn UI state. */
import { expect, test } from "bun:test";
import { EXTENSION_BUDGET_PRESETS, bindExtensionDefinitions, type OperationPrincipal } from "../contracts/operation";
import type { EffectReceipt, ExtensionGrantSet } from "../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../stage/contracts/extension-store";
import { clipboardOperations } from "../operations/clipboard/operations";
import { createExtensionBroker, type BrokerAuthority } from "../broker/invoke";
import { createHostActionPort } from "./host-action-port";
import { runExtensionHostActionGesture } from "../../ui/extensions/host-action-gesture";

const principal = { storeId: "fixture", packageId: "demo.extension", packageDigest: "a".repeat(64), grantRevision: 2, runEpoch: 1 };
const panel = (runEpoch: number, text: string) => ({ packageId: principal.packageId, principal: { ...principal, runEpoch }, digest: principal.packageDigest,
  contributionId: "panel", descriptor: { version: 1 as const, root: { type: "text" as const, text } } });

test("host actions are bounded, typed and cancelled on package invalidation", async () => {
  let now = 10, id = 0;
  const port = createHostActionPort({ now: () => now, id: () => `ticket-${++id}` });
  const request = port.request({ action: "clipboard.read", operation: "clipboard.read", packageId: principal.packageId, principal }, new AbortController().signal);
  const ticket = port.actions()[0]!;
  expect(port.answer(ticket.id, { status: "completed" })).toBe(false);
  expect(port.answer(ticket.id, { status: "read", text: "copied text" })).toBe(true);
  await expect(request).resolves.toEqual({ status: "read", text: "copied text" });

  const blocked = port.request({ action: "links.open", operation: "links.open", packageId: principal.packageId, principal, url: "https://example.com/" }, new AbortController().signal);
  port.invalidatePackage(principal.packageId);
  await expect(blocked).resolves.toEqual({ status: "cancelled" });
  expect(port.actions()).toEqual([]);
  expect(() => port.request({ action: "links.open", operation: "links.open", packageId: principal.packageId, principal, url: "javascript:alert(1)" }, new AbortController().signal)).toThrow();
});

test("panel/status projections reject stale runs and are removed with their package", () => {
  const port = createHostActionPort({ now: () => 10, id: () => "notice-1" });
  expect(port.setPanel(panel(2, "new"))).toBe(true);
  expect(port.setPanel(panel(1, "stale"))).toBe(false);
  expect(port.snapshot().panels[0]?.descriptor.root).toEqual({ type: "text", text: "new" });
  expect(port.removePanel(principal.packageId, "panel", { ...principal, runEpoch: 3 })).toBe(true);
  expect(port.snapshot().panels).toEqual([]);
  expect(port.setStatus({ packageId: principal.packageId, principal, text: "Ready" })).toBe(true);
  port.showNotice(principal.packageId, principal, "A safe text-only notice");
  expect(port.snapshot()).toMatchObject({ statuses: [{ text: "Ready" }], notices: [{ text: "A safe text-only notice" }] });
  port.invalidatePackage(principal.packageId);
  expect(port.snapshot()).toMatchObject({ statuses: [], notices: [], panels: [] });
});

test("action queue releases a ticket when its caller aborts", async () => {
  const port = createHostActionPort({ now: () => 10, id: () => "ticket-abort" });
  const controller = new AbortController();
  const result = port.request({ action: "ui.dialog.request", operation: "ui.dialog.request", packageId: principal.packageId, principal, message: "Continue?" }, controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(port.actions()).toEqual([]);
});

test("a host action can be claimed once and settled after the claim", async () => {
  const port = createHostActionPort({ now: () => 10, id: () => "ticket-claim" });
  const request = port.request({ action: "links.open", operation: "links.open", packageId: principal.packageId, principal, url: "https://example.com/" }, new AbortController().signal);
  const ticket = port.actions()[0]!;
  expect(port.claim(ticket.id)).toEqual(ticket);
  expect(port.actions()).toEqual([]);
  expect(port.claim(ticket.id)).toBeNull();
  expect(port.answer(ticket.id, { status: "completed" })).toBe(true);
  await expect(request).resolves.toEqual({ status: "completed" });
});

test("a claimed clipboard write that reaches its ticket deadline settles the broker receipt as ambiguous", async () => {
  let now = 10, requestId = 0, ticketId = 0;
  const port = createHostActionPort({ now: () => now, id: () => `ticket-${++ticketId}`, ttlMs: 100 });
  const operationPrincipal: OperationPrincipal = { storeId: principal.storeId, packageId: principal.packageId, packageDigest: principal.packageDigest, apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: principal.grantRevision, runEpoch: principal.runEpoch };
  const grants: ExtensionGrantSet = { packageId: operationPrincipal.packageId, packageDigest: operationPrincipal.packageDigest, policyFingerprint: operationPrincipal.policyFingerprint, revision: operationPrincipal.grantRevision,
    grants: [{ operation: "clipboard.write", resources: [], fields: ["clipboard.text"], methods: [], destinations: [], duration: "persistent", budget: EXTENSION_BUDGET_PRESETS.external }] };
  const records: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  const authority: BrokerAuthority = {
    principal: () => operationPrincipal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal, activationOrigin: "command",
    confirm: async () => true,
    reserveBudget: async (reservation: ExtensionBudgetReservation, _limits: ExtensionBudget) => { reservations.push(reservation); return true; },
    settleBudget: async (_packageId: string, id: string, bytes: number) => reservations.some((row) => row.id === id && bytes <= row.bytes),
    record: async (receipt) => { records.push(receipt); }, readReceipts: async () => records,
    now: () => now, id: () => `receipt-${++requestId}`, commitContext: () => ({}) as never,
  };
  const operation = bindExtensionDefinitions(clipboardOperations, { hostActions: port });
  const invoke = createExtensionBroker(operation, authority);
  const running = invoke({ v: 1, type: "request", id: 1, operation: "clipboard.write", args: { text: "approved" } });
  for (let attempt = 0; attempt < 100 && port.actions().length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 1));
  const ticket = port.actions()[0]!;
  let nativeWriteSucceeded = false;
  const gesture = await runExtensionHostActionGesture(ticket, {
    claimHostAction: async (id) => port.claim(id),
    answerHostAction: async (id, answer) => port.answer(id, answer),
  }, {
    now: () => now,
    clipboard: { readText: async () => "", writeText: async (text) => { expect(text).toBe("approved"); nativeWriteSucceeded = true; now = ticket.expiresAt; port.actions(); } },
    openLink: () => {}, music: { get: () => ({ playing: false }) } as never, acquireMusic: () => {}, releaseMusic: () => {}, groups: [],
    openScene: () => {}, openEditor: () => {},
  });
  expect(gesture.status).toBe("unconfirmed");
  await expect(running).rejects.toMatchObject({ code: "operation-failed" });
  expect(nativeWriteSucceeded).toBe(true);
  expect(records.map(({ status }) => status)).toEqual(["admitted", "ambiguous"]);
});

test("a claimed composer replacement cannot expire or be cancelled as a successful no-op", async () => {
  let now = 10;
  const port = createHostActionPort({ now: () => now, id: () => "draft-ticket", ttlMs: 100 });
  const request = port.request({ action: "composer.draft.set", operation: "composer.draft.set", packageId: principal.packageId, principal, sceneId: "scene-1", text: "approved replacement" }, new AbortController().signal);
  const ticket = port.actions()[0]!;
  expect(port.claim(ticket.id)).toEqual(ticket);
  now = ticket.expiresAt;
  port.actions();
  expect(port.answer(ticket.id, { status: "composer-draft-result", result: "applied" })).toBe(false);
  await expect(request).resolves.toEqual({ status: "ambiguous" });
});

test("claimed external actions become ambiguous on abort or package invalidation", async () => {
  const port = createHostActionPort({ now: () => 10, id: (() => { let next = 0; return () => `protected-${++next}`; })() });
  const controller = new AbortController();
  const aborted = port.request({ action: "clipboard.write", operation: "clipboard.write", packageId: principal.packageId, principal, text: "gesture" }, controller.signal);
  const abortTicket = port.actions()[0]!;
  expect(port.claim(abortTicket.id)).toEqual(abortTicket);
  controller.abort();
  await expect(aborted).resolves.toEqual({ status: "ambiguous" });

  const invalidated = port.request({ action: "links.open", operation: "links.open", packageId: principal.packageId, principal, url: "https://example.com/" }, new AbortController().signal);
  const invalidatedTicket = port.actions()[0]!;
  expect(port.claim(invalidatedTicket.id)).toEqual(invalidatedTicket);
  port.invalidatePackage(principal.packageId);
  await expect(invalidated).resolves.toEqual({ status: "ambiguous" });
});

test("an admitted native action can settle as ambiguous, but non-effects cannot", async () => {
  const port = createHostActionPort({ now: () => 10, id: () => "ticket-ambiguous" });
  const request = port.request({ action: "clipboard.write", operation: "clipboard.write", packageId: principal.packageId, principal, text: "safe" }, new AbortController().signal);
  const ticket = port.actions()[0]!;
  expect(port.answer(ticket.id, { status: "ambiguous" })).toBe(true);
  await expect(request).resolves.toEqual({ status: "ambiguous" });
  const dialog = port.request({ action: "ui.dialog.request", operation: "ui.dialog.request", packageId: principal.packageId, principal, message: "Continue?" }, new AbortController().signal);
  expect(port.answer(port.actions()[0]!.id, { status: "ambiguous" })).toBe(false);
  port.invalidatePackage(principal.packageId);
  await expect(dialog).resolves.toEqual({ status: "cancelled" });
});
