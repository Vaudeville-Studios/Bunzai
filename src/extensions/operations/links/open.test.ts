/** Rejects unsafe destinations and verifies the granted origin is exact. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { linkOperations } from "./open";

const principal = { storeId: "store", packageId: "demo.links", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 3 };
const context = (destinations: string[]) => ({ principal, signal: new AbortController().signal, resources: [], grantedOperations: [], availableGrants: [], operationReceipts: [], host: "desktop", availableOperations: [], access: { resources: [], fields: [], methods: [], destinations }, commit: {}, confirm: async () => true } as unknown as ExtensionOperationContext);

test("link open requires public HTTPS destination grant and host action", async () => {
  const calls: unknown[] = [];
  const services = { hostActions: { request: async (ticket: unknown) => { calls.push(ticket); return { status: "completed" }; } } } as unknown as ExtensionOperationServices;
  const operation = linkOperations[0]!;
  await expect(operation.execute({ url: "https://example.com/path" }, context(["https://example.com"]), services)).resolves.toEqual({ opened: true });
  expect(calls).toMatchObject([{ action: "links.open", url: "https://example.com/path", principal: { packageId: principal.packageId } }]);
  await expect(operation.execute({ url: "https://example.com/path" }, context([]), services)).rejects.toThrow(/outside the approved/);
  await expect(operation.metadata.input.parseAsync({ url: "http://example.com" })).rejects.toThrow();
  await expect(operation.metadata.input.parseAsync({ url: "https://user:pass@example.com" })).rejects.toThrow();
});

test("link receipt does not claim a committed external effect when the host reports no open", () => {
  expect(linkOperations[0]!.metadata.receiptStatus?.({ opened: true })).toBe("committed");
  expect(linkOperations[0]!.metadata.receiptStatus?.({ opened: false })).toBe("conflicted");
});
