/** Public host relay regressions for UI-selected handles and binary bytes. */
import { expect, test } from "bun:test";
import type { OperationPrincipal } from "../contracts/operation";
import { createHostFileActionPort } from "./file-action-port";

const principal: OperationPrincipal = { storeId: "store", packageId: "demo.files", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 3, runEpoch: 5 };
const options = () => { let id = 0; return { now: () => 10, id: () => `action-${++id}` }; };
async function select(port: ReturnType<typeof createHostFileActionPort>, mode: "read" | "create" | "overwrite", id: string, name: string): Promise<void> {
  const selected = port.pick({ packageName: "Files", principal, mode, signal: new AbortController().signal }); const [ticket] = port.pending();
  expect(port.answer(ticket!.id, { status: "picked", handle: { id, name, size: 0, mediaType: "text/plain", mode } })).toBe(true); await selected;
}

test("pick tickets bind package identity and return only opaque host file metadata", async () => {
  const port = createHostFileActionPort(options());
  const result = port.pick({ packageName: "Files", principal, mode: "read", signal: new AbortController().signal });
  const [ticket] = port.pending();
  expect(ticket).toMatchObject({ action: "pick", mode: "read", principal: { storeId: "store", packageId: "demo.files", packageDigest: principal.packageDigest, grantRevision: 3, runEpoch: 5 } });
  expect("path" in ticket!).toBe(false);
  expect(port.answer(ticket!.id, { status: "picked", handle: { id: "opaque-1", name: "notes.txt", size: 5, mediaType: "text/plain", mode: "read" } })).toBe(true);
  await expect(result).resolves.toEqual({ id: "opaque-1", name: "notes.txt", size: 5, mediaType: "text/plain", mode: "read" });
  expect(port.answer(ticket!.id, { status: "cancelled" })).toBe(false);
});

test("read bytes arrive through a one-shot bounded relay, not through ticket JSON", async () => {
  const port = createHostFileActionPort(options());
  await select(port, "read", "opaque-1", "notes.txt");
  const result = port.read({ packageName: "Files", principal, handleId: "opaque-1", maxBytes: 10, signal: new AbortController().signal });
  const [ticket] = port.pending();
  expect(ticket).toMatchObject({ action: "read", handleId: "opaque-1", maxBytes: 10 });
  const bytes = new TextEncoder().encode("file bytes");
  expect(await port.completeReadChunk(ticket!.id, 0, bytes.length, bytes.subarray(0, 4), false)).toBe(true);
  expect(await port.completeReadChunk(ticket!.id, 4, bytes.length, bytes.subarray(4), true)).toBe(true);
  await expect(result).resolves.toEqual(bytes);
  expect(await port.completeReadChunk(ticket!.id, 0, bytes.length, bytes, true)).toBe(false);
  const tooLarge = port.read({ packageName: "Files", principal, handleId: "opaque-1", maxBytes: 3, signal: new AbortController().signal });
  const [next] = port.pending(); expect(await port.completeReadChunk(next!.id, 0, bytes.length, bytes, true)).toBe(false);
  const canceled = tooLarge.then((value) => value);
  expect(port.answer(next!.id, { status: "cancelled" })).toBe(true); await expect(canceled).resolves.toBeNull();
});

test("write relay delivers reviewed bytes once and requires matching digest/size receipt", async () => {
  const port = createHostFileActionPort(options()); const bytes = new TextEncoder().encode("new draft");
  await select(port, "overwrite", "opaque-2", "draft.txt");
  const reviewed = port.previewWrite({ packageName: "Files", principal, handleId: "opaque-2", bytes, signal: new AbortController().signal });
  const [previewTicket] = port.pending(); expect(previewTicket).toMatchObject({ action: "preview-write", fileName: "draft.txt" });
  expect(port.answer(previewTicket!.id, { status: "previewed", current: { size: 3, lastModified: 1, digest: "b".repeat(64) } })).toBe(true);
  const preview = await reviewed; expect(preview).toMatchObject({ proposedBytes: bytes.length });
  expect(port.reviewWrite(preview!.previewId, principal)).toMatchObject({ fileName: "draft.txt", current: { size: 3, lastModified: 1 } });
  const staged = port.stageWrite({ packageName: "Files", principal, previewId: preview!.previewId, signal: new AbortController().signal });
  expect(staged).toMatchObject({ action: "write", fileName: "draft.txt" });
  const result = port.write({ packageName: "Files", principal, previewId: preview!.previewId, signal: new AbortController().signal });
  const ticket = port.pending()[0];
  if (!ticket || ticket.action !== "write") throw new Error("write ticket missing");
  expect(ticket).toMatchObject({ action: "write", mode: "overwrite", proposedBytes: bytes.byteLength });
  const chunk = port.writeChunk(ticket.id, 0);
  if (!chunk) throw new Error("write chunk missing");
  expect([...chunk.bytes]).toEqual([...bytes]); expect(chunk).toMatchObject({ offset: 0, totalBytes: bytes.length, final: true, digest: staged.proposedDigest });
  expect(port.answer(ticket.id, { status: "written", bytes: bytes.byteLength, digest: ticket.proposedDigest, consistency: "checked-before-write" })).toBe(true);
  await expect(result).resolves.toBe("written");
});

test("uncertain native commit answers are linked as ambiguous, never successful", async () => {
  const port = createHostFileActionPort(options()); const bytes = new TextEncoder().encode("possibly committed");
  await select(port, "overwrite", "opaque-3", "draft.txt");
  const reviewed = port.previewWrite({ packageName: "Files", principal, handleId: "opaque-3", bytes, signal: new AbortController().signal });
  const [previewTicket] = port.pending();
  expect(port.answer(previewTicket!.id, { status: "previewed", current: { size: 0, lastModified: 1, digest: "c".repeat(64) } })).toBe(true);
  const preview = await reviewed;
  port.stageWrite({ packageName: "Files", principal, previewId: preview!.previewId, signal: new AbortController().signal });
  const completion = port.write({ packageName: "Files", principal, previewId: preview!.previewId, signal: new AbortController().signal });
  const writeTicket = port.pending().find((ticket) => ticket.action === "write");
  if (!writeTicket || writeTicket.action !== "write") throw new Error("write ticket missing");
  expect(port.answer(writeTicket.id, { status: "ambiguous", bytes: bytes.length, digest: writeTicket.proposedDigest, consistency: "commit-unknown" })).toBe(true);
  await expect(completion).resolves.toBe("ambiguous");
});

test("a begun write survives abort and package invalidation until an ambiguous result is recorded", async () => {
  const port = createHostFileActionPort(options()), bytes = new TextEncoder().encode("write in flight"), abort = new AbortController();
  await select(port, "create", "opaque-started", "draft.txt");
  const reviewed = port.previewWrite({ packageName: "Files", principal, handleId: "opaque-started", bytes, signal: new AbortController().signal });
  const previewTicket = port.pending().find((ticket) => ticket.action === "preview-write");
  if (!previewTicket) throw new Error("preview ticket missing");
  port.answer(previewTicket.id, { status: "previewed", current: { size: 0, lastModified: 0, digest: "c".repeat(64) } });
  const preview = await reviewed;
  port.stageWrite({ packageName: "Files", principal, previewId: preview!.previewId, signal: abort.signal });
  const completion = port.write({ packageName: "Files", principal, previewId: preview!.previewId, signal: abort.signal });
  const ticket = port.pending().find((item) => item.action === "write");
  if (!ticket || ticket.action !== "write") throw new Error("write ticket missing");
  expect(port.beginWrite(ticket.id)).toBe(true);
  abort.abort(); port.invalidatePackage(principal.packageId);
  expect(port.startedWritesForPackage(principal.packageId)).toEqual([ticket.id]);
  expect(port.pending().some((item) => item.id === ticket.id)).toBe(true);
  expect(port.answer(ticket.id, { status: "ambiguous", bytes: bytes.length, digest: ticket.proposedDigest, consistency: "commit-unknown" })).toBe(true);
  await expect(completion).resolves.toBe("ambiguous");
});

test("protected write expiry invokes host settlement and resolves ambiguously", async () => {
  let now = 10;
  const port = createHostFileActionPort({ ...options(), now: () => now, ttlMs: 20 });
  const bytes = new TextEncoder().encode("late result");
  await select(port, "create", "opaque-expiry", "draft.txt");
  const reviewed = port.previewWrite({ packageName: "Files", principal, handleId: "opaque-expiry", bytes, signal: new AbortController().signal });
  const previewTicket = port.pending().find((ticket) => ticket.action === "preview-write");
  if (!previewTicket) throw new Error("preview ticket missing");
  port.answer(previewTicket.id, { status: "previewed", current: { size: 0, lastModified: 0, digest: "c".repeat(64) } });
  const preview = await reviewed;
  port.stageWrite({ packageName: "Files", principal, previewId: preview!.previewId, signal: new AbortController().signal });
  const completion = port.write({ packageName: "Files", principal, previewId: preview!.previewId, signal: new AbortController().signal });
  const ticket = port.pending().find((item) => item.action === "write");
  if (!ticket || ticket.action !== "write") throw new Error("write ticket missing");
  port.beginWrite(ticket.id);
  let settled = false;
  port.setStartedWriteExpiryHandler((expired) => {
    settled = true;
    port.answer(expired.id, { status: "ambiguous", bytes: expired.proposedBytes, digest: expired.proposedDigest, consistency: "commit-unknown" });
  });
  now += 21;
  port.pending();
  await expect(completion).resolves.toBe("ambiguous");
  expect(settled).toBe(true);
});

test("abort and close cancel pending work and reject late UI answers", async () => {
  const port = createHostFileActionPort(options()); const abort = new AbortController();
  const pending = port.pick({ packageName: "Files", principal, mode: "create", signal: abort.signal }); const [ticket] = port.pending();
  abort.abort(); await expect(pending).resolves.toBeNull(); expect(port.answer(ticket!.id, { status: "cancelled" })).toBe(false);
  const next = port.pick({ packageName: "Files", principal, mode: "create", signal: new AbortController().signal }); const [active] = port.pending();
  port.close(); await expect(next).resolves.toBeNull(); expect(port.pending()).toEqual([]); expect(port.answer(active!.id, { status: "cancelled" })).toBe(false);
});
