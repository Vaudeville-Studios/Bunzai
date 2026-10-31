/** Trusted UI file picker and bounded binary relay; native handles never leave this module. */
import type { FileActionAnswer, PendingExtensionFileAction } from "../../extensions/contracts/file-actions";
import { sha256HexBytes } from "../../core/sha256";
import { MAX_EXTENSION_FILE_CHUNK_BYTES, MAX_EXTENSION_FILE_TRANSFER_BYTES } from "../../extensions/contracts/limits";
import { createExtensionFileRegistry, ExtensionFileWriteUncertainError, type ExtensionFilePrincipal, type NativeFileHandle } from "./file-handles";

type Registry = ReturnType<typeof createExtensionFileRegistry>;
interface HostFilePicker {
  isSecureContext?: boolean;
  showOpenFilePicker?: (options: { multiple: false }) => Promise<NativeFileHandle[]>;
  showDirectoryPicker?: () => Promise<{ getFileHandle(name: string, options: { create: boolean }): Promise<NativeFileHandle> }>;
}
export interface ExtensionFileActionApi {
  beginFileWrite(id: string): Promise<boolean>;
  answerFileAction(id: string, answer: FileActionAnswer): Promise<boolean>;
  completeFileReadChunk(id: string, offset: number, totalBytes: number, bytes: Uint8Array, final: boolean): Promise<boolean>;
  fileWriteChunk(id: string, offset: number): Promise<{ offset: number; totalBytes: number; bytes: Uint8Array; final: boolean; digest: string } | null>;
}
const principal = (ticket: PendingExtensionFileAction): ExtensionFilePrincipal => ({ storeId: ticket.principal.storeId, packageId: ticket.principal.packageId, packageDigest: ticket.principal.packageDigest, grantRevision: ticket.principal.grantRevision, runEpoch: ticket.principal.runEpoch });

function newFileName(suggested?: string): string {
  const base = (suggested || "new-file.txt").replace(/[^a-zA-Z0-9._ -]/gu, "_").slice(0, 180);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : "";
  return stem + " (Bunzai " + crypto.randomUUID() + ")" + extension;
}

function missingFile(error: unknown): boolean { return error instanceof DOMException && error.name === "NotFoundError"; }

/** Must be called directly from a host button so the browser receives the user's gesture. */
export async function pickExtensionFile(ticket: Extract<PendingExtensionFileAction, { action: "pick" }>, files: Registry): Promise<FileActionAnswer> {
  const host = globalThis as unknown as HostFilePicker;
  if (!host.isSecureContext) throw new Error("File selection requires a secure desktop window.");
  let native: NativeFileHandle;
  if (ticket.mode === "create") {
    if (!host.showDirectoryPicker) throw new Error("Creating extension files is unavailable in this desktop window.");
    const directory = await host.showDirectoryPicker();
    const name = newFileName(ticket.suggestedName);
    native = {
      name,
      async getFile() {
        try { await directory.getFileHandle(name, { create: false }); throw new Error("The new-file name is already in use."); }
        catch (error) {
          if (!missingFile(error)) throw error;
          const empty = new Blob([]);
          return { size: 0, lastModified: 0, type: "", slice: () => empty };
        }
      },
      async createWritable() {
        try { await directory.getFileHandle(name, { create: false }); throw new Error("A file appeared at the new-file name after review."); }
        catch (error) { if (!missingFile(error)) throw error; }
        const created = await directory.getFileHandle(name, { create: true });
        const file = await created.getFile();
        if (file.size !== 0) throw new Error("The new file is no longer empty.");
        return created.createWritable();
      },
    };
  } else {
    if (!host.showOpenFilePicker) throw new Error("Opening extension files is unavailable in this desktop window.");
    const [selected] = await host.showOpenFilePicker({ multiple: false });
    if (!selected) return { status: "cancelled" };
    native = selected;
  }
  const handle = await files.register(native as never, principal(ticket), ticket.mode);
  return { status: "picked", handle };
}

export async function answerExtensionFileAction(ticket: PendingExtensionFileAction, files: Registry, api: ExtensionFileActionApi): Promise<boolean> {
  const owner = principal(ticket);
  if (ticket.action === "pick") {
    const answer = await pickExtensionFile(ticket, files);
    const accepted = await api.answerFileAction(ticket.id, answer);
    if (!accepted && answer.status === "picked") files.remove(answer.handle.id, owner);
    return accepted;
  }
  if (ticket.action === "read") {
    try {
      const bytes = await files.read(ticket.handleId, owner, ticket.maxBytes);
      for (let offset = 0; offset < bytes.byteLength || offset === 0; offset += MAX_EXTENSION_FILE_CHUNK_BYTES) {
        const chunk = bytes.slice(offset, Math.min(offset + MAX_EXTENSION_FILE_CHUNK_BYTES, bytes.byteLength));
        if (!await api.completeFileReadChunk(ticket.id, offset, bytes.byteLength, chunk, offset + chunk.byteLength === bytes.byteLength)) return false;
        if (bytes.byteLength === 0) break;
      }
      return true;
    } catch (error) { await api.answerFileAction(ticket.id, { status: "cancelled" }); throw error; }
  }
  if (ticket.action === "preview-write") {
    try { const current = await files.snapshotForWrite(ticket.handleId, owner); return api.answerFileAction(ticket.id, { status: "previewed", current }); }
    catch (error) { await api.answerFileAction(ticket.id, { status: "cancelled" }); throw error; }
  }
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let expectedTotal: number | null = null;
  let bytes: Uint8Array;
  try {
    while (expectedTotal === null || offset < expectedTotal || expectedTotal === 0 && offset === 0) {
      const chunk = await api.fileWriteChunk(ticket.id, offset);
      if (!chunk || chunk.offset !== offset || chunk.totalBytes > MAX_EXTENSION_FILE_TRANSFER_BYTES || chunk.digest !== ticket.proposedDigest || expectedTotal !== null && chunk.totalBytes !== expectedTotal || chunk.bytes.byteLength > MAX_EXTENSION_FILE_CHUNK_BYTES || chunk.bytes.byteLength === 0 && chunk.totalBytes !== 0) throw new Error("The reviewed file bytes are unavailable or inconsistent.");
      expectedTotal = chunk.totalBytes;
      chunks.push(chunk.bytes);
      offset += chunk.bytes.byteLength;
      if (chunk.final !== (offset === expectedTotal)) throw new Error("The reviewed file transfer ended at an unexpected size.");
      if (chunk.final) break;
    }
    bytes = new Uint8Array(expectedTotal ?? 0);
    let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
    if (bytes.byteLength !== ticket.proposedBytes || sha256HexBytes(bytes) !== ticket.proposedDigest) throw new Error("The reviewed file bytes failed their digest check.");
  } catch (error) {
    await api.answerFileAction(ticket.id, { status: "cancelled" });
    throw error;
  }
  try {
    if (!await api.beginFileWrite(ticket.id)) throw new Error("The file write is no longer approved. Review it again before retrying.");
    await files.commitWrite(ticket.handleId, owner, bytes, { current: ticket.current, proposedDigest: ticket.proposedDigest });
  }
  catch (error) {
    if (error instanceof ExtensionFileWriteUncertainError) {
      await api.answerFileAction(ticket.id, { status: "ambiguous", bytes: bytes.byteLength, digest: ticket.proposedDigest, consistency: "commit-unknown" });
      throw new Error("The file write outcome is uncertain. Check the selected file before retrying.");
    }
    await api.answerFileAction(ticket.id, { status: "cancelled" }); throw error;
  }
  try {
    const accepted = await api.answerFileAction(ticket.id, { status: "written", bytes: bytes.byteLength, digest: ticket.proposedDigest, consistency: "checked-before-write" });
    if (accepted) return true;
  } catch { /* Try to record uncertainty if the successful receipt was not delivered. */ }
  await api.answerFileAction(ticket.id, { status: "ambiguous", bytes: bytes.byteLength, digest: ticket.proposedDigest, consistency: "commit-unknown" }).catch(() => false);
  throw new Error("The file was written but its completion receipt could not be confirmed. Check the selected file before retrying.");
}
