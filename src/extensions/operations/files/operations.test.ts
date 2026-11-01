/** Operation-level bounds and host port calls for desktop and Terminal file adapters. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { PendingExtensionFileAction } from "../../contracts/file-actions";
import { filePickReadOperations } from "./pick-read";
import { fileWriteOperations } from "./write-operations";
import type { ExtensionOperationServices } from "../_services";
import { encodeFileBytes } from "./_bytes";

const principal = { storeId: "store", packageId: "demo.files", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 3 };
const context = (fields: string[] = ["file.contents"]) => ({ principal, signal: new AbortController().signal, resources: [], grantedOperations: [], availableGrants: [], operationReceipts: [], host: "desktop", availableOperations: [], access: { resources: [], fields, methods: [], destinations: [] }, commit: {}, confirm: async () => true } as unknown as ExtensionOperationContext);
test("file pick and read operations use only principal-bound host ports and bound outputs", async () => {
  const selected = { id: "opaque-file", name: "notes.txt", size: 4, mediaType: "text/plain", mode: "read" as const };
  const bytes = new TextEncoder().encode("safe");
  const calls: string[] = [];
  const services = { files: {
    pick: async (input: { principal: typeof principal; mode: string }) => { calls.push(`pick:${input.mode}:${input.principal.packageId}`); return selected; },
    read: async (input: { handleId: string; maxBytes: number; principal: typeof principal }) => { calls.push(`read:${input.handleId}:${input.maxBytes}:${input.principal.runEpoch}`); return bytes; },
  } } as unknown as ExtensionOperationServices;
  const picked = await filePickReadOperations[0].execute({ mode: "read" }, context(), services);
  expect(picked).toEqual(selected);
  const result = await filePickReadOperations[1].execute({ handleId: selected.id, maxBytes: 4 }, context(), services);
  expect(result).toMatchObject({ bytes: 4, base64: encodeFileBytes(bytes) });
  expect(calls).toEqual(["pick:read:demo.files", "read:opaque-file:4:3"]);
  await expect(filePickReadOperations[1].execute({ handleId: selected.id, maxBytes: 4 }, context([]), services)).rejects.toThrow("outside the approved grant");
});

test("file operations are absent from Browser hosts and fail closed if invoked there", async () => {
  const definition = filePickReadOperations[0];
  expect(definition.metadata.hosts).toEqual(["desktop", "terminal"]);
  const services = { files: { pick: async () => { throw new Error("must not call browser adapter"); } } } as unknown as ExtensionOperationServices;
  await expect(definition.execute({ mode: "read" }, { ...context(), host: "browser" }, services)).rejects.toThrow("unavailable on this host");
});

test("write preview rejects noncanonical/oversized bytes and apply review binds exact staged ticket", async () => {
  const bytes = new TextEncoder().encode("new");
  const staged = { id: "write-1", action: "write", operation: "files.write.apply", packageId: principal.packageId, packageName: principal.packageId, principal, expiresAt: 10, handleId: "opaque-file", fileName: "notes.txt", mode: "overwrite", current: { size: 4, lastModified: 1, digest: "c".repeat(64) }, proposedBytes: bytes.length, proposedDigest: "d".repeat(64) } as PendingExtensionFileAction & { action: "write" };
  let wrote = false, writeResult: "written" | "cancelled" | "ambiguous" = "written";
  const services = { files: {
    previewWrite: async ({ bytes: incoming }: { bytes: Uint8Array }) => ({ previewId: "preview-1", proposedBytes: incoming.length, proposedDigest: "d".repeat(64) }),
    reviewWrite: () => ({ fileName: "notes.txt", mode: "overwrite", current: staged.current, proposedBytes: staged.proposedBytes, proposedDigest: staged.proposedDigest }),
    stageWrite: () => staged,
    write: async () => { wrote = true; return writeResult; },
  } } as unknown as ExtensionOperationServices;
  const previewDef = fileWriteOperations[0];
  await expect(previewDef.execute({ handleId: "opaque-file", base64: "!" }, context(), services)).rejects.toThrow();
  await expect(previewDef.execute({ handleId: "opaque-file", base64: "A".repeat(240_004) }, context(), services)).rejects.toThrow();
  const preview = await previewDef.execute({ handleId: "opaque-file", base64: encodeFileBytes(bytes) }, context(), services);
  expect(preview).toMatchObject({ previewId: "preview-1", proposedBytes: 3 });
  const applyDef = fileWriteOperations[1];
  const reviewed = await applyDef.review!({ previewId: "preview-1" }, context(), services);
  expect(reviewed).toMatchObject({ hostAction: { kind: "bunzai.file.write", ticketId: "write-1" }, fileName: "notes.txt", proposedDigest: "d".repeat(64) });
  await expect(applyDef.execute({ previewId: "preview-1" }, context([]), services)).rejects.toThrow("outside the approved grant");
  await expect(applyDef.execute({ previewId: "preview-1" }, context(), services)).resolves.toEqual({ written: true });
  expect(wrote).toBe(true);
  writeResult = "ambiguous";
  await expect(applyDef.execute({ previewId: "preview-1" }, context(), services)).rejects.toThrow(/outcome is uncertain/);
});
