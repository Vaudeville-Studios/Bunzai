/** Purpose: keep Terminal extension file paths in the trusted Kit process behind opaque handles. */
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createHostFileActionPort, type HostFileActionPort } from "../../extensions/runtime/file-action-port";
import { MAX_EXTENSION_FILE_CHUNK_BYTES, MAX_EXTENSION_FILE_HANDLES, MAX_EXTENSION_FILE_TRANSFER_BYTES, MAX_SELECTED_FILE_BYTES, EXTENSION_FILE_HANDLE_TTL_MS } from "../../extensions/contracts/limits";
import type { FileActionAnswer, FileHandleInfo, PendingExtensionFileAction } from "../../extensions/contracts/file-actions";
import { sha256HexBytes } from "../../core/sha256";

type Handle = { path: string; principal: PendingExtensionFileAction["principal"]; mode: FileHandleInfo["mode"]; expiresAt: number; identity: { dev: number; ino: number } };
const samePrincipal = (a: Handle["principal"], b: Handle["principal"]): boolean =>
  a.storeId === b.storeId && a.packageId === b.packageId && a.packageDigest === b.packageDigest && a.grantRevision === b.grantRevision && a.runEpoch === b.runEpoch;
const sameIdentity = (a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean => a.dev === b.dev && a.ino === b.ino;
const boundedBytes = async (file: FileHandle, size: number): Promise<Uint8Array> => {
  const buffer = new Uint8Array(size + 1); let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await file.read(buffer, offset, Math.min(MAX_EXTENSION_FILE_CHUNK_BYTES, buffer.byteLength - offset), offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== size) throw new Error("The selected file changed while it was being read.");
  return buffer.slice(0, size);
};
const snapshotOpened = async (path: string, file: FileHandle) => {
  const canonical = await realpath(path), info = await file.stat();
  if (canonical !== path || !info.isFile() || info.size > MAX_SELECTED_FILE_BYTES) throw new Error("Selected file is not the approved regular file or exceeds 8 MB.");
  const bytes = await boundedBytes(file, info.size), after = await file.stat(), pathAfter = await realpath(path);
  if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.dev !== info.dev || after.ino !== info.ino || pathAfter !== canonical) throw new Error("The selected file changed while it was being read.");
  return { info, bytes, digest: await sha256HexBytes(bytes) };
};
const snapshot = async (path: string) => {
  const canonical = await realpath(path), file = await open(canonical, "r");
  try {
    return await snapshotOpened(canonical, file);
  } finally { await file.close(); }
};

export function createTerminalFileActions(options: { now(): number; id(): string }): {
  port: HostFileActionPort;
  pending(): readonly PendingExtensionFileAction[];
  bindService(service: { answer(id: string, result: FileActionAnswer): Promise<boolean>; completeReadChunk(id: string, offset: number, total: number, bytes: Uint8Array, final: boolean): Promise<boolean>; beginWrite(id: string): Promise<boolean> }): void;
  process(id: string, selectedPath?: string): Promise<void>;
  close(): void;
} {
  const native = createHostFileActionPort(options), handles = new Map<string, Handle>(), running = new Set<string>();
  let answerThroughService: (id: string, result: FileActionAnswer) => Promise<boolean> = async (id, result) => native.answer(id, result);
  let readThroughService: (id: string, offset: number, total: number, bytes: Uint8Array, final: boolean) => Promise<boolean> = (...args) => native.completeReadChunk(...args);
  let beginWriteThroughService: (id: string) => Promise<boolean> = async (id) => native.beginWrite(id);
  const pruneHandles = () => { for (const [id, handle] of handles) if (handle.expiresAt <= options.now()) handles.delete(id); };
  const ticketIsCurrent = (ticket: PendingExtensionFileAction, handle?: Handle): boolean => {
    const live = native.pending().find((item) => item.id === ticket.id);
    if (!live || live.action !== ticket.action || live.packageId !== ticket.packageId || !samePrincipal(ticket.principal, live.principal)) return false;
    return !handle || ticket.action !== "pick" && handles.get(ticket.handleId) === handle && handle.expiresAt > options.now();
  };
  const handleFor = (id: string, ticket: PendingExtensionFileAction): Handle => {
    pruneHandles();
    const handle = handles.get(id);
    if (!handle || handle.expiresAt <= options.now() || !samePrincipal(handle.principal, ticket.principal)) throw new Error("The selected file is no longer available.");
    return handle;
  };
  const ensureCurrent = (ticket: PendingExtensionFileAction, handle?: Handle): void => {
    if (!ticketIsCurrent(ticket, handle)) throw new Error("The file action was cancelled or revoked.");
  };
  const assertApprovedPath = async (ticket: PendingExtensionFileAction, handle: Handle): Promise<void> => {
    ensureCurrent(ticket, handle);
    const target = ticket.action === "write" && ticket.mode === "create" ? dirname(handle.path) : handle.path;
    const canonical = await realpath(target);
    ensureCurrent(ticket, handle);
    if (canonical !== target) throw new Error("The approved file path changed after selection.");
    const current = await stat(canonical);
    ensureCurrent(ticket, handle);
    if (!sameIdentity(handle.identity, current)) throw new Error("The approved file target changed after selection.");
  };
  const writeFully = async (file: FileHandle, bytes: Uint8Array, check: () => void): Promise<void> => {
    let offset = 0;
    while (offset < bytes.byteLength) {
      check();
      const result = await file.write(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesWritten <= 0) throw new Error("The host file write made no progress.");
      offset += result.bytesWritten;
      check();
    }
  };
  const closeChecked = async (file: FileHandle, ticket: PendingExtensionFileAction, handle: Handle): Promise<void> => {
    let current = true;
    try { ensureCurrent(ticket, handle); } catch { current = false; }
    await file.close();
    if (!current) throw new Error("The file action was cancelled before close.");
  };
  const answer = async (id: string, result: FileActionAnswer): Promise<void> => { if (!await answerThroughService(id, result)) throw new Error("The Terminal file action expired or was cancelled."); };
  const select = async (ticket: Extract<PendingExtensionFileAction, { action: "pick" }>, selectedPath: string): Promise<void> => {
    if (typeof selectedPath !== "string" || selectedPath.length === 0 || selectedPath.length > 4_096 || selectedPath.includes("\0")) throw new Error("Enter a valid local path.");
    const absolute = resolve(selectedPath), name = basename(absolute);
    if (!name || name.length > 255 || name === "." || name === "..") throw new Error("The selected path has no supported file name.");
    let canonical: string, size = 0, identity: { dev: number; ino: number };
    if (ticket.mode === "create") {
      const parent = await realpath(dirname(absolute));
      canonical = resolve(parent, name);
      const parentInfo = await stat(parent); identity = { dev: parentInfo.dev, ino: parentInfo.ino };
      try { await stat(canonical); throw new Error("That file already exists. Choose another name."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    } else {
      canonical = await realpath(absolute);
      const current = await stat(canonical);
      if (!current.isFile() || current.size > MAX_SELECTED_FILE_BYTES) throw new Error("Choose a regular file no larger than 8 MB.");
      size = current.size;
      identity = { dev: current.dev, ino: current.ino };
    }
    pruneHandles();
    if (!ticketIsCurrent(ticket)) throw new Error("The file picker request was cancelled.");
    if (handles.size >= MAX_EXTENSION_FILE_HANDLES) throw new Error("Too many files are selected by extensions. Close or revoke an extension first.");
    const id = options.id(), info: FileHandleInfo = { id, name, size, mediaType: "application/octet-stream", mode: ticket.mode };
    handles.set(id, { path: canonical, principal: ticket.principal, mode: ticket.mode, identity, expiresAt: options.now() + EXTENSION_FILE_HANDLE_TTL_MS });
    try { await answer(ticket.id, { status: "picked", handle: info }); }
    catch (error) { handles.delete(id); throw error; }
  };
  const process = async (id: string, selectedPath?: string): Promise<void> => {
    if (running.has(id)) return;
    const ticket = native.pending().find((item) => item.id === id);
    if (!ticket) return;
    running.add(id);
    let writeEffectStarted = false;
    try {
      if (ticket.action === "pick") {
        if (selectedPath === undefined) return;
        await select(ticket, selectedPath); return;
      }
      const handle = handleFor(ticket.handleId, ticket);
      if (ticket.action === "read") {
        const current = await snapshot(handle.path);
        ensureCurrent(ticket, handle);
        if (current.bytes.byteLength > ticket.maxBytes) throw new Error("Selected file exceeds the granted read limit.");
        if (current.bytes.byteLength === 0) {
          ensureCurrent(ticket, handle);
          if (!await readThroughService(id, 0, 0, new Uint8Array(), true)) throw new Error("The selected file read was cancelled.");
          return;
        }
        for (let offset = 0; offset < current.bytes.byteLength; offset += MAX_EXTENSION_FILE_CHUNK_BYTES) {
          ensureCurrent(ticket, handle);
          const chunk = current.bytes.slice(offset, Math.min(offset + MAX_EXTENSION_FILE_CHUNK_BYTES, current.bytes.byteLength));
          const final = offset + chunk.byteLength === current.bytes.byteLength;
          if (!await readThroughService(id, offset, current.bytes.byteLength, chunk, final)) throw new Error("The selected file read was cancelled.");
        }
        return;
      }
      if (ticket.action === "preview-write") {
        const current = ticket.mode === "create" ? { info: { size: 0, mtimeMs: 0 }, bytes: new Uint8Array(), digest: await sha256HexBytes(new Uint8Array()) } : await snapshot(handle.path);
        ensureCurrent(ticket, handle);
        await answer(id, { status: "previewed", current: { size: current.info.size, lastModified: Math.trunc(current.info.mtimeMs), digest: current.digest } });
        return;
      }
      const parts: Uint8Array[] = [];
      for (let offset = 0; offset < ticket.proposedBytes; offset += MAX_EXTENSION_FILE_CHUNK_BYTES) {
        const chunk = native.writeChunk(id, offset);
        if (!chunk || chunk.offset !== offset || chunk.digest !== ticket.proposedDigest || chunk.totalBytes !== ticket.proposedBytes) throw new Error("The staged file bytes are unavailable.");
        parts.push(chunk.bytes);
      }
      const bytes = new Uint8Array(ticket.proposedBytes); let cursor = 0;
      for (const part of parts) { bytes.set(part, cursor); cursor += part.byteLength; }
      ensureCurrent(ticket, handle);
      if (await sha256HexBytes(bytes) !== ticket.proposedDigest) throw new Error("The staged file digest changed.");
      ensureCurrent(ticket, handle);
      await assertApprovedPath(ticket, handle);
      if (ticket.mode === "create") {
        if (!await beginWriteThroughService(id)) throw new Error("The file write was cancelled before it began.");
        ensureCurrent(ticket, handle);
        const file = await open(handle.path, "wx+");
        writeEffectStarted = true;
        try {
          ensureCurrent(ticket, handle);
          const opened = await file.stat(); ensureCurrent(ticket, handle);
          const named = await stat(await realpath(handle.path)); ensureCurrent(ticket, handle);
          if (!sameIdentity({ dev: opened.dev, ino: opened.ino }, named)) throw new Error("The created file path changed after creation.");
          await writeFully(file, bytes, () => ensureCurrent(ticket, handle));
          ensureCurrent(ticket, handle); await file.sync(); ensureCurrent(ticket, handle);
          const written = await boundedBytes(file, bytes.byteLength);
          ensureCurrent(ticket, handle);
          if (await sha256HexBytes(written) !== ticket.proposedDigest) throw new Error("The created file did not match the reviewed bytes.");
        } finally { await closeChecked(file, ticket, handle); }
      } else {
        const file = await open(handle.path, "r+");
        try {
          await assertApprovedPath(ticket, handle);
          const current = await snapshotOpened(handle.path, file);
          ensureCurrent(ticket, handle);
          if (!sameIdentity(handle.identity, current.info)) throw new Error("The selected file identity changed after selection.");
          if (current.info.size !== ticket.current.size || Math.trunc(current.info.mtimeMs) !== ticket.current.lastModified || current.digest !== ticket.current.digest) throw new Error("The selected file changed after preview. Preview it again.");
          ensureCurrent(ticket, handle);
          if (!await beginWriteThroughService(id)) throw new Error("The file write was cancelled before it began.");
          ensureCurrent(ticket, handle);
          writeEffectStarted = true;
          await file.truncate(0); ensureCurrent(ticket, handle);
          await writeFully(file, bytes, () => ensureCurrent(ticket, handle));
          ensureCurrent(ticket, handle); await file.truncate(bytes.byteLength); ensureCurrent(ticket, handle);
          await file.sync(); ensureCurrent(ticket, handle);
          const written = await boundedBytes(file, bytes.byteLength); ensureCurrent(ticket, handle);
          if (await sha256HexBytes(written) !== ticket.proposedDigest) throw new Error("The overwritten file did not match the reviewed bytes.");
        } finally { await closeChecked(file, ticket, handle); }
      }
      await answer(id, { status: "written", bytes: bytes.byteLength, digest: ticket.proposedDigest, consistency: "checked-before-write" });
    } catch {
      if (native.pending().some((item) => item.id === id)) {
        try {
          if (ticket.action === "write" && writeEffectStarted) await answer(id, { status: "ambiguous", bytes: ticket.proposedBytes, digest: ticket.proposedDigest, consistency: "commit-unknown" });
          else await answer(id, { status: "cancelled" });
        } catch { /* the queue may already have expired */ }
      }
    } finally { running.delete(id); }
  };
  const port: HostFileActionPort = {
    ...native,
    invalidatePackage(packageId) { for (const [id, handle] of handles) if (handle.principal.packageId === packageId) handles.delete(id); return native.invalidatePackage(packageId); },
    close() { handles.clear(); native.close(); },
  };
  return { port, pending: () => native.pending(), bindService(service) { answerThroughService = service.answer; readThroughService = service.completeReadChunk; beginWriteThroughService = service.beginWrite; }, process, close: () => port.close() };
}
