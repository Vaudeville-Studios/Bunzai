/** Host-side file action relay. It carries bytes and opaque values, never native handles or paths. */
import { createBoundedHostActionQueue } from "./confirmation";
import { sha256HexBytes } from "../../core/sha256";
import { MAX_EXTENSION_FILE_CHUNK_BYTES, MAX_EXTENSION_FILE_TRANSFER_BYTES } from "../contracts/limits";
import { fileActionAnswerSchema, pendingExtensionFileActionSchema, type FileActionAnswer, type FileHandleInfo, type PendingExtensionFileAction } from "../contracts/file-actions";
import type { OperationPrincipal } from "../contracts/operation";

type Completion = { answer: FileActionAnswer; bytes?: Uint8Array };
type ReadTransfer = { nextOffset: number; totalBytes: number | null; chunks: Uint8Array[] };
type NewFileActionTicket = PendingExtensionFileAction extends infer Ticket ? Ticket extends PendingExtensionFileAction ? Omit<Ticket, "id" | "expiresAt"> : never : never;
const principalOf = (value: OperationPrincipal) => ({ storeId: value.storeId, packageId: value.packageId, packageDigest: value.packageDigest, grantRevision: value.grantRevision, runEpoch: value.runEpoch });
export interface HostFileActionRequest { packageName: string; principal: OperationPrincipal; signal: AbortSignal }
export interface HostFileActionPort {
  pick(request: HostFileActionRequest & { mode: "read" | "create" | "overwrite"; suggestedName?: string }): Promise<FileHandleInfo | null>;
  read(request: HostFileActionRequest & { handleId: string; maxBytes: number }): Promise<Uint8Array | null>;
  previewWrite(request: HostFileActionRequest & { handleId: string; bytes: Uint8Array }): Promise<{ previewId: string; proposedBytes: number; proposedDigest: string } | null>;
  reviewWrite(previewId: string, principal: OperationPrincipal): { fileName: string; mode: "create" | "overwrite"; current: { size: number; lastModified: number; digest: string }; proposedBytes: number; proposedDigest: string };
  stageWrite(request: HostFileActionRequest & { previewId: string }): Extract<PendingExtensionFileAction, { action: "write" }>;
  beginWrite(id: string): boolean;
  startedWritesForPackage(packageId: string): readonly string[];
  setStartedWriteExpiryHandler(handler: (ticket: Extract<PendingExtensionFileAction, { action: "write" }>) => void | Promise<void>): void;
  write(request: HostFileActionRequest & { previewId: string }): Promise<"written" | "cancelled" | "ambiguous">;
  pending(): readonly PendingExtensionFileAction[];
  answer(id: string, result: FileActionAnswer): boolean;
  completeReadChunk(id: string, offset: number, totalBytes: number, chunk: Uint8Array, final: boolean): Promise<boolean>;
  writeChunk(id: string, offset: number): { offset: number; totalBytes: number; bytes: Uint8Array; final: boolean; digest: string } | null;
  invalidatePackage(packageId: string): number;
  close(): void;
}

/** One bounded action queue per runtime owner; broker policy/grant decisions remain upstream. */
export function createHostFileActionPort(options: { now(): number; id(): string; maxPending?: number; ttlMs?: number }): HostFileActionPort {
  const writeBodies = new Map<string, Uint8Array>();
  const readTransfers = new Map<string, ReadTransfer>();
  const handles = new Map<string, { principal: ReturnType<typeof principalOf>; info: FileHandleInfo }>();
  const previews = new Map<string, { principal: ReturnType<typeof principalOf>; handleId: string; current: { size: number; lastModified: number; digest: string }; proposedDigest: string; bytes: Uint8Array; expiresAt: number }>();
  const stagedWrites = new Map<string, { ticket: Extract<PendingExtensionFileAction, { action: "write" }>; completion: Promise<Completion | undefined>; timer: ReturnType<typeof setTimeout> }>();
  let onStartedWriteExpiry: ((ticket: Extract<PendingExtensionFileAction, { action: "write" }>) => void | Promise<void>) | undefined;
  const queue = createBoundedHostActionQueue<PendingExtensionFileAction, Completion>({ ...options,
    onSettled: (id) => { writeBodies.delete(id); readTransfers.delete(id); },
    onProtectedExpiry: (ticket) => { if (ticket.action === "write") return onStartedWriteExpiry?.(ticket); },
    protectedExpiryValue: (ticket) => ({ answer: ticket.action === "write"
      ? { status: "ambiguous", bytes: ticket.proposedBytes, digest: ticket.proposedDigest, consistency: "commit-unknown" }
      : { status: "cancelled" } }),
  });
  const request = async (fields: NewFileActionTicket, signal: AbortSignal): Promise<Completion | undefined> => {
    const ticket = pendingExtensionFileActionSchema.parse({ ...fields, id: options.id(), expiresAt: options.now() + Math.min(120_000, Math.max(1, options.ttlMs ?? 120_000)) });
    return queue.enqueue(ticket, signal);
  };
  const find = (id: string): PendingExtensionFileAction | undefined => queue.list().find((item) => item.id === id);
  const boundHandle = (id: string, principal: OperationPrincipal, modes: readonly string[]) => {
    const entry = handles.get(id); const caller = principalOf(principal);
    if (!entry || Object.keys(caller).some((key) => entry.principal[key as keyof typeof caller] !== caller[key as keyof typeof caller]) || !modes.includes(entry.info.mode)) throw new Error("File access is no longer available.");
    return entry.info;
  };
  return {
    async pick(input) {
      const completion = await request({ operation: "files.pick", action: "pick", packageId: input.principal.packageId, packageName: input.packageName, principal: principalOf(input.principal), mode: input.mode, suggestedName: input.suggestedName }, input.signal);
      if (input.signal.aborted || completion?.answer.status !== "picked" || completion.answer.handle.mode !== input.mode) return null;
      if (handles.has(completion.answer.handle.id)) throw new Error("The selected file handle is already in use.");
      handles.set(completion.answer.handle.id, { principal: principalOf(input.principal), info: completion.answer.handle });
      return completion.answer.handle;
    },
    async read(input) {
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0 || input.maxBytes > MAX_EXTENSION_FILE_TRANSFER_BYTES) throw new Error("Invalid file read limit.");
      const info = boundHandle(input.handleId, input.principal, ["read"]);
      const completion = await request({ operation: "files.read", action: "read", packageId: input.principal.packageId, packageName: input.packageName, principal: principalOf(input.principal), handleId: input.handleId, fileName: info.name, maxBytes: input.maxBytes }, input.signal);
      return input.signal.aborted ? null : completion?.answer.status === "read" ? completion.bytes ?? null : null;
    },
    async previewWrite(input) {
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > MAX_EXTENSION_FILE_TRANSFER_BYTES) throw new Error("The file exceeds the 180 KB write limit.");
      const info = boundHandle(input.handleId, input.principal, ["create", "overwrite"]); const principal = principalOf(input.principal);
      const completion = await request({ operation: "files.write.preview", action: "preview-write", packageId: input.principal.packageId, packageName: input.packageName, principal, handleId: input.handleId, fileName: info.name, mode: info.mode as "create" | "overwrite" }, input.signal);
      if (input.signal.aborted || completion?.answer.status !== "previewed") return null;
      const previewId = options.id(); if (!previewId || previews.has(previewId)) throw new Error("Could not create a unique write preview.");
      const proposedDigest = await digest(input.bytes);
      previews.set(previewId, { principal, handleId: input.handleId, current: completion.answer.current, proposedDigest, bytes: new Uint8Array(input.bytes), expiresAt: options.now() + Math.min(120_000, Math.max(1, options.ttlMs ?? 120_000)) });
      return { previewId, proposedBytes: input.bytes.byteLength, proposedDigest };
    },
    reviewWrite(previewId, principal) {
      const row = previews.get(previewId); const caller = principalOf(principal);
      if (!row || row.expiresAt <= options.now() || Object.keys(caller).some((key) => row.principal[key as keyof typeof caller] !== caller[key as keyof typeof caller])) throw new Error("This file preview is no longer available.");
      const info = boundHandle(row.handleId, principal, ["create", "overwrite"]);
      return { fileName: info.name, mode: info.mode as "create" | "overwrite", current: row.current, proposedBytes: row.bytes.byteLength, proposedDigest: row.proposedDigest };
    },
    stageWrite(input) {
      const existing = stagedWrites.get(input.previewId);
      if (existing) return existing.ticket;
      const row = previews.get(input.previewId); const principal = principalOf(input.principal);
      if (!row || row.expiresAt <= options.now() || Object.keys(principal).some((key) => row.principal[key as keyof typeof principal] !== principal[key as keyof typeof principal])) throw new Error("This file preview is no longer available.");
      const info = boundHandle(row.handleId, input.principal, ["create", "overwrite"]);
      const fields = { operation: "files.write.apply" as const, action: "write" as const, packageId: input.principal.packageId, packageName: input.packageName, principal, handleId: row.handleId, fileName: info.name, mode: info.mode as "create" | "overwrite", current: row.current, proposedDigest: row.proposedDigest, proposedBytes: row.bytes.byteLength };
      const id = options.id();
      if (queue.list().some((item) => item.id === id) || writeBodies.has(id)) throw new Error("Could not create a unique file action ticket.");
      const parsed = pendingExtensionFileActionSchema.parse({ ...fields, id, expiresAt: options.now() + Math.min(120_000, Math.max(1, options.ttlMs ?? 120_000)) });
      if (parsed.action !== "write") throw new Error("Invalid staged file write ticket.");
      const ticket = parsed;
      writeBodies.set(id, new Uint8Array(row.bytes)); previews.delete(input.previewId);
      const completion = queue.enqueue(ticket, input.signal);
      const timer = setTimeout(() => stagedWrites.delete(input.previewId), Math.max(1, ticket.expiresAt - options.now())); timer.unref?.();
      stagedWrites.set(input.previewId, { ticket, completion, timer });
      return ticket;
    },
    beginWrite(id) { const ticket = find(id); return ticket?.action === "write" ? queue.protect(id) : false; },
    startedWritesForPackage(packageId) { return queue.protectedIds().filter((id) => find(id)?.packageId === packageId); },
    setStartedWriteExpiryHandler(handler) { onStartedWriteExpiry = handler; },
    async write(input) {
      const staged = stagedWrites.get(input.previewId);
      if (!staged) throw new Error("This file write is no longer staged.");
      stagedWrites.delete(input.previewId); clearTimeout(staged.timer);
      const completion = await staged.completion;
      const ticket = staged.ticket;
      if (!completion || completion.answer.status === "cancelled") return "cancelled";
      if ((completion.answer.status === "written" || completion.answer.status === "ambiguous") && completion.answer.digest === ticket.proposedDigest && completion.answer.bytes === ticket.proposedBytes) return completion.answer.status;
      return "cancelled";
    },
    pending() { return queue.list(); },
    answer(id, raw) {
      let result = fileActionAnswerSchema.parse(raw); const ticket = find(id);
      if (!ticket || result.status === "read") return false;
      if (ticket.action === "write" && queue.protectedIds().includes(id) && ticket.expiresAt <= options.now() && result.status === "written") {
        result = { status: "ambiguous", bytes: ticket.proposedBytes, digest: ticket.proposedDigest, consistency: "commit-unknown" };
      }
      if (result.status === "picked" && (ticket.action !== "pick" || result.handle.mode !== ticket.mode || handles.has(result.handle.id))) return false;
      if (result.status === "previewed" && ticket.action !== "preview-write") return false;
      if (result.status === "written" && (ticket.action !== "write" || result.digest !== ticket.proposedDigest || result.bytes !== ticket.proposedBytes || result.consistency !== "checked-before-write")) return false;
      if (result.status === "ambiguous" && (ticket.action !== "write" || result.digest !== ticket.proposedDigest || result.bytes !== ticket.proposedBytes || result.consistency !== "commit-unknown")) return false;
      return queue.answer(id, { answer: result });
    },
    async completeReadChunk(id, offset, totalBytes, rawChunk, final) {
      const ticket = find(id);
      if (!ticket || ticket.action !== "read" || !(rawChunk instanceof Uint8Array) || rawChunk.byteLength > MAX_EXTENSION_FILE_CHUNK_BYTES || rawChunk.byteLength === 0 && totalBytes !== 0 || !Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes > ticket.maxBytes || totalBytes > MAX_EXTENSION_FILE_TRANSFER_BYTES) return false;
      const transfer = readTransfers.get(id) ?? { nextOffset: 0, totalBytes: null, chunks: [] };
      if (transfer.totalBytes !== null && transfer.totalBytes !== totalBytes || offset !== transfer.nextOffset || offset + rawChunk.byteLength > totalBytes || (final !== (offset + rawChunk.byteLength === totalBytes))) return false;
      transfer.totalBytes = totalBytes; transfer.chunks.push(new Uint8Array(rawChunk)); transfer.nextOffset += rawChunk.byteLength; readTransfers.set(id, transfer);
      if (!final) return true;
      const bytes = new Uint8Array(totalBytes); let cursor = 0;
      for (const part of transfer.chunks) { bytes.set(part, cursor); cursor += part.byteLength; }
      const accepted = queue.answer(id, { answer: { status: "read", bytes: bytes.byteLength, digest: await digest(bytes) }, bytes });
      if (!accepted) readTransfers.delete(id);
      return accepted;
    },
    writeChunk(id, offset) {
      const ticket = find(id); const bytes = writeBodies.get(id);
      if (!ticket || ticket.action !== "write" || !bytes || !Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.byteLength && bytes.byteLength > 0) return null;
      const part = bytes.slice(offset, Math.min(offset + MAX_EXTENSION_FILE_CHUNK_BYTES, bytes.byteLength));
      return { offset, totalBytes: bytes.byteLength, bytes: part, final: offset + part.byteLength === bytes.byteLength, digest: ticket.proposedDigest };
    },
    invalidatePackage(packageId) {
      let removed = 0;
      for (const [id, entry] of handles) if (entry.principal.packageId === packageId) { handles.delete(id); removed++; }
      for (const [id, entry] of previews) if (entry.principal.packageId === packageId) previews.delete(id);
      for (const ticket of queue.list()) if (ticket.packageId === packageId && !(ticket.action === "write" && queue.protectedIds().includes(ticket.id))) queue.answer(ticket.id, { answer: { status: "cancelled" } });
      for (const [id, staged] of stagedWrites) if (staged.ticket.packageId === packageId && !queue.protectedIds().includes(staged.ticket.id)) { clearTimeout(staged.timer); stagedWrites.delete(id); }
      return removed;
    },
    close() { queue.close(); writeBodies.clear(); readTransfers.clear(); handles.clear(); previews.clear(); for (const staged of stagedWrites.values()) clearTimeout(staged.timer); stagedWrites.clear(); },
  };
}

async function digest(bytes: Uint8Array): Promise<string> {
  return sha256HexBytes(bytes);
}
