/** Verifies clipboard requests are principal-bound and require exact host approval. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { clipboardOperations } from "./operations";

const principal = { storeId: "store", packageId: "demo.clipboard", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 3 };
const context = (host = "desktop", fields = ["clipboard.text"]): ExtensionOperationContext => ({ principal, signal: new AbortController().signal, resources: [], grantedOperations: [], availableGrants: [], operationReceipts: [], host: host as "desktop", availableOperations: [], access: { resources: [], fields, methods: [], destinations: [] }, commit: {}, confirm: async () => true } as unknown as ExtensionOperationContext);

test("clipboard read and write use bounded, principal-bound host tickets", async () => {
  const calls: unknown[] = [];
  const hostActions = { request: async (ticket: unknown) => { calls.push(ticket); return calls.length === 1 ? { status: "read", text: "safe" } : { status: "completed" }; } };
  const services = { hostActions } as unknown as ExtensionOperationServices;
  await expect(clipboardOperations[0]!.execute({}, context(), services)).resolves.toEqual({ text: "safe" });
  await expect(clipboardOperations[1]!.execute({ text: "approved" }, context(), services)).resolves.toEqual({ written: true });
  expect(calls).toMatchObject([{ action: "clipboard.read", principal: { packageDigest: principal.packageDigest, runEpoch: 3 } }, { action: "clipboard.write", text: "approved" }]);
  await expect(clipboardOperations[1]!.execute({ text: "denied" }, context("desktop", []), services)).rejects.toThrow(/outside the approved grant/);
  await expect(clipboardOperations[0]!.execute({}, context("browser"), services)).rejects.toThrow(/unavailable on this host/);
});

test("clipboard write review binds exact bounded content and digest", async () => {
  const review = await clipboardOperations[1]!.review!({ text: "copy me" }, context(), {} as ExtensionOperationServices);
  expect(review).toMatchObject({ action: "write clipboard text", bytes: 7, text: "copy me" });
  await expect(clipboardOperations[1]!.metadata.input.parseAsync({ text: "x".repeat(65_537) })).rejects.toThrow();
});

test("clipboard receipts distinguish a completed host action from a no-effect response", () => {
  expect(clipboardOperations[0]!.metadata.receiptStatus?.({ text: "safe" })).toBe("completed");
  expect(clipboardOperations[0]!.metadata.receiptStatus?.(null)).toBe("conflicted");
  expect(clipboardOperations[1]!.metadata.receiptStatus?.({ written: true })).toBe("committed");
  expect(clipboardOperations[1]!.metadata.receiptStatus?.({ written: false })).toBe("conflicted");
});
