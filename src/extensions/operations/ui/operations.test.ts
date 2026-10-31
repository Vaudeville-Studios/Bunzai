/** UI contribution handlers emit only bounded, principal-bound descriptors and host tickets. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { createHostActionPort } from "../../runtime/host-action-port";
import { uiOperations } from "./operations";

const principal = { storeId: "store", packageId: "demo.ui", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 3 };
const context = (): ExtensionOperationContext => ({ principal, declaredCommands: ["run"], declaredPanels: ["panel"], declaredAssets: [], signal: new AbortController().signal, resources: [], grantedOperations: [], availableGrants: [], operationReceipts: [], host: "desktop", availableOperations: [], access: { resources: [], fields: ["panel", "notice", "dialog", "status"], methods: [], destinations: [] }, commit: {}, confirm: async () => true } as unknown as ExtensionOperationContext);

test("UI operations set and remove bounded panels, status and notices", async () => {
  const port = createHostActionPort({ now: () => 10, id: () => "notice-1" });
  const services = { hostActions: port } as unknown as ExtensionOperationServices;
  await expect(uiOperations[0]!.execute({ contributionId: "panel", descriptor: { version: 1, root: { type: "text", text: "Safe" } } }, context(), services)).resolves.toEqual({ changed: true });
  await expect(uiOperations[0]!.execute({ contributionId: "undeclared", descriptor: { version: 1, root: { type: "text", text: "Unsafe" } } }, context(), services)).rejects.toThrow(/not declared/);
  await expect(uiOperations[0]!.execute({ contributionId: "panel", descriptor: { version: 1, root: { type: "button", id: "bad", label: "Run", command: "missing" } } }, context(), services)).rejects.toThrow(/undeclared command/);
  await expect(uiOperations[0]!.execute({ contributionId: "panel", descriptor: { version: 1, root: { type: "image", asset: "a".repeat(64), alt: "Unapproved" } } }, context(), services)).rejects.toThrow(/unapproved asset/);
  await expect(uiOperations[2]!.execute({ text: "Hello" }, context(), services)).resolves.toEqual({ shown: true });
  await expect(uiOperations[4]!.execute({ text: "Ready" }, context(), services)).resolves.toEqual({ changed: true });
  expect(port.snapshot()).toMatchObject({ panels: [{ contributionId: "panel" }], statuses: [{ text: "Ready" }], notices: [{ text: "Hello" }] });
  await expect(uiOperations[1]!.execute({ contributionId: "panel" }, context(), services)).resolves.toEqual({ changed: true });
  expect(port.snapshot().panels).toEqual([]);
});

test("dialog responses must come from the exact typed host action answer", async () => {
  const port = createHostActionPort({ now: () => 10, id: () => "dialog-1" });
  const services = { hostActions: port } as unknown as ExtensionOperationServices;
  const pending = uiOperations[3]!.execute({ message: "Continue?" }, context(), services);
  const ticket = port.actions()[0]!;
  expect(ticket).toMatchObject({ action: "ui.dialog.request", operation: "ui.dialog.request", message: "Continue?", principal: { packageId: principal.packageId } });
  expect(port.answer(ticket.id, { status: "read", text: "no" })).toBe(false);
  expect(port.answer(ticket.id, { status: "declined" })).toBe(true);
  await expect(pending).resolves.toEqual({ accepted: false });
  expect(uiOperations[3]!.metadata.receiptStatus?.({ accepted: false })).toBe("completed");
});

test("navigation requests are bound to their exact granted targets and host answer", async () => {
  const port = createHostActionPort({ now: () => 10, id: () => "nav-1" });
  const services = { hostActions: port } as unknown as ExtensionOperationServices;
  const scene = { ...context(), access: { resources: [{ kind: "scene", id: "scene-1" }], fields: ["navigation.scene"], methods: [], destinations: [] } };
  const pendingScene = uiOperations[5]!.execute({ sceneId: "scene-1" }, scene, services);
  expect(port.actions()[0]).toMatchObject({ action: "ui.scene.open", sceneId: "scene-1" });
  expect(port.answer("nav-1", { status: "completed" })).toBe(true);
  await expect(pendingScene).resolves.toEqual({ opened: true });

  const editor = { ...context(), access: { resources: [{ kind: "character", id: "ada" }], fields: ["navigation.editor"], methods: [], destinations: [] } };
  const pendingEditor = uiOperations[6]!.execute({ kind: "character", id: "ada" }, editor, services);
  expect(port.actions()[0]).toMatchObject({ action: "ui.editor.open", kind: "character", entityId: "ada" });
  expect(port.answer("nav-1", { status: "completed" })).toBe(true);
  await expect(pendingEditor).resolves.toEqual({ opened: true });
  await expect(uiOperations[6]!.execute({ kind: "character", id: "other" }, editor, services)).rejects.toThrow(/outside the approved/);
});

test("navigation receipts do not report a committed open when the host did nothing", () => {
  const scene = uiOperations[5]!.metadata.receiptStatus;
  const editor = uiOperations[6]!.metadata.receiptStatus;
  expect(scene?.({ opened: true })).toBe("committed"); expect(scene?.({ opened: false })).toBe("conflicted");
  expect(editor?.({ opened: true })).toBe("committed"); expect(editor?.({ opened: false })).toBe("conflicted");
});

test("status receipts distinguish a stored update from a stale no-op", () => {
  expect(uiOperations[4]!.metadata.receiptStatus?.({ changed: true })).toBe("committed");
  expect(uiOperations[4]!.metadata.receiptStatus?.({ changed: false })).toBe("conflicted");
});
