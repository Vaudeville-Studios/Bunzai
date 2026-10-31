/** Purpose: prove regex.preview waits for a typed host worker result and denies unsupported hosts. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { createHostActionPort } from "../../runtime/host-action-port";
import { regexPreviewOperations } from "./preview";

const principal = { storeId: "store", packageId: "demo.regex", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const context = (host: "desktop" | "browser" | "terminal" = "desktop"): ExtensionOperationContext => ({
  principal, signal: new AbortController().signal, resources: [], grantedOperations: [], availableGrants: [], operationReceipts: [],
  host, availableOperations: [], access: { resources: [], fields: ["regex.preview"], methods: [], destinations: [] }, commit: {}, confirm: async () => true,
} as unknown as ExtensionOperationContext);

test("regex.preview returns only the exact bounded worker answer", async () => {
  const port = createHostActionPort({ now: () => 1, id: () => "regex-ticket" });
  const operation = regexPreviewOperations[0]!;
  const services = { hostActions: port } as unknown as ExtensionOperationServices;
  const pending = operation.execute({ phase: "input", text: "Hello", rules: [] }, context(), services);
  expect(port.actions()[0]).toMatchObject({ action: "regex.preview", operation: "regex.preview", phase: "input", text: "Hello", rules: [] });
  expect(port.answer("regex-ticket", { status: "regex-result", ok: true, text: "Hello!", error: null })).toBe(true);
  await expect(pending).resolves.toEqual({ ok: true, text: "Hello!", error: null });
});

test("regex.preview requires an isolated host adapter and enforces its byte bound", async () => {
  const operation = regexPreviewOperations[0]!;
  await expect(operation.execute({ phase: "input", text: "", rules: [] }, context("terminal"), {} as ExtensionOperationServices)).rejects.toThrow("UNSUPPORTED_HOST");
  expect(operation.metadata.input.safeParse({ phase: "input", text: "x".repeat(16_385), rules: [] }).success).toBe(false);
});
