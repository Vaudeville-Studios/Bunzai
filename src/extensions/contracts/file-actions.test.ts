/** Ensures file tickets expose bounded host metadata only, never paths or native handles. */
import { expect, test } from "bun:test";
import { fileActionAnswerSchema, pendingExtensionFileActionSchema } from "./file-actions";

const ticket = { id: "ticket", packageId: "demo.files", packageName: "Files", principal: { storeId: "store", packageId: "demo.files", packageDigest: "a".repeat(64), grantRevision: 1, runEpoch: 2 }, expiresAt: 100, operation: "files.pick" as const, action: "pick" as const, mode: "read" as const };

test("file action ticket carries only bounded, principal-bound values", () => {
  expect(pendingExtensionFileActionSchema.parse(ticket)).toEqual(ticket);
  expect(pendingExtensionFileActionSchema.safeParse({ ...ticket, path: "C:\\private\\secret.txt" }).success).toBe(false);
  expect(pendingExtensionFileActionSchema.safeParse({ ...ticket, nativeHandle: {} }).success).toBe(false);
  expect(pendingExtensionFileActionSchema.safeParse({ ...ticket, principal: { ...ticket.principal, packageDigest: "bad" } }).success).toBe(false);
});

test("file action answers reject paths, oversized reads and unbound selection metadata", () => {
  expect(fileActionAnswerSchema.safeParse({ status: "picked", handle: { id: "opaque", name: "file.txt", size: 2, mediaType: "text/plain", mode: "read" } }).success).toBe(true);
  expect(fileActionAnswerSchema.safeParse({ status: "picked", handle: { id: "opaque", name: "file.txt", size: 2, mediaType: "text/plain", mode: "read", path: "C:\\private" } }).success).toBe(false);
  expect(fileActionAnswerSchema.safeParse({ status: "read", bytes: 180_001, digest: "a".repeat(64) }).success).toBe(false);
});
