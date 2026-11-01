/** Purpose: keep native File System Access handles in the trusted UI page and bind them to one runtime principal. */
import { sha256HexBytes } from "../../core/sha256";
import { EXTENSION_FILE_HANDLE_TTL_MS, MAX_EXTENSION_FILE_HANDLES, MAX_SELECTED_FILE_BYTES } from "../../extensions/contracts/limits";
export type ExtensionFileMode = "read" | "create" | "overwrite";
export interface ExtensionFilePrincipal { storeId: string; packageId: string; packageDigest: string; grantRevision: number; runEpoch: number }
export interface ExtensionFileInfo { id: string; name: string; size: number; mediaType: string; mode: ExtensionFileMode }
export interface ExtensionFileSnapshot { size: number; lastModified: number; digest: string }
interface NativeFile { size: number; lastModified: number; type: string; slice(start?: number, end?: number): Blob }
interface WritableFile { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
export interface NativeFileHandle { readonly name: string; getFile(): Promise<NativeFile>; createWritable(): Promise<WritableFile> }
interface Entry { native: NativeFileHandle; principal: ExtensionFilePrincipal; info: ExtensionFileInfo; createdAt: number }
export class ExtensionFileWriteUncertainError extends Error {
  constructor() { super("The file writer failed after commit began."); this.name = "ExtensionFileWriteUncertainError"; }
}
const safeName = (name: string): boolean => name.length > 0 && name.length <= 255 && !/[\\/\0]/u.test(name) && name !== "." && name !== "..";
const samePrincipal = (left: ExtensionFilePrincipal, right: ExtensionFilePrincipal): boolean => left.storeId === right.storeId && left.packageId === right.packageId
  && left.packageDigest === right.packageDigest && left.grantRevision === right.grantRevision && left.runEpoch === right.runEpoch;
const digest = async (bytes: Uint8Array): Promise<string> => sha256HexBytes(bytes);

/** The registry intentionally exposes byte operations, never FileSystem* handles, paths or host objects. */
export function createExtensionFileRegistry(options: { id(): string; now?(): number }) {
  const handles = new Map<string, Entry>();
  const now = options.now ?? Date.now;
  const prune = (): void => { const time = now(); for (const [id, entry] of handles) if (time - entry.createdAt >= EXTENSION_FILE_HANDLE_TTL_MS) handles.delete(id); };
  const get = (id: string, principal: ExtensionFilePrincipal, modes: readonly ExtensionFileMode[]): Entry => {
    prune();
    const entry = handles.get(id);
    if (!entry || !samePrincipal(entry.principal, principal) || !modes.includes(entry.info.mode)) throw new Error("File access is no longer available.");
    return entry;
  };
  const isCurrent = (id: string, entry: Entry, principal: ExtensionFilePrincipal): boolean => {
    prune();
    return handles.get(id) === entry && samePrincipal(entry.principal, principal);
  };
  const assertCurrent = (id: string, entry: Entry, principal: ExtensionFilePrincipal): void => {
    if (!isCurrent(id, entry, principal)) throw new Error("File access is no longer available.");
  };
  const snapshot = async (id: string, entry: Entry, principal: ExtensionFilePrincipal): Promise<{ file: NativeFile; bytes: Uint8Array; snapshot: ExtensionFileSnapshot }> => {
    const file = await entry.native.getFile();
    assertCurrent(id, entry, principal);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_SELECTED_FILE_BYTES) throw new Error("This file exceeds the 8 MB limit.");
    const bytes = new Uint8Array(await file.slice(0, file.size).arrayBuffer());
    assertCurrent(id, entry, principal);
    const currentDigest = await digest(bytes);
    assertCurrent(id, entry, principal);
    return { file, bytes, snapshot: { size: file.size, lastModified: file.lastModified, digest: currentDigest } };
  };
  return {
    has(id: string, principal: ExtensionFilePrincipal, modes: readonly ExtensionFileMode[] = ["read", "create", "overwrite"]): boolean {
      prune();
      const entry = handles.get(id);
      return !!entry && samePrincipal(entry.principal, principal) && modes.includes(entry.info.mode);
    },
    async register(native: NativeFileHandle, principal: ExtensionFilePrincipal, mode: ExtensionFileMode): Promise<ExtensionFileInfo> {
      prune();
      if (handles.size >= MAX_EXTENSION_FILE_HANDLES) throw new Error("The host file handle limit is full; close unused extension files first.");
      if (!safeName(native.name)) throw new Error("This file name is not supported.");
      const file = await native.getFile();
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_SELECTED_FILE_BYTES) throw new Error("This file exceeds the 8 MB limit.");
      if (mode === "create" && file.size !== 0) throw new Error("A new file must start empty.");
      const id = options.id();
      if (!id || handles.has(id)) throw new Error("Could not create a unique file handle.");
      const info = { id, name: native.name, size: file.size, mediaType: file.type.slice(0, 120), mode };
      const entry = { native, principal: { ...principal }, info, createdAt: now() };
      handles.set(id, entry);
      assertCurrent(id, entry, principal);
      return info;
    },
    async read(id: string, principal: ExtensionFilePrincipal, maxBytes: number): Promise<Uint8Array> {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_SELECTED_FILE_BYTES) throw new Error("Invalid file byte limit.");
      const entry = get(id, principal, ["read"]);
      const { file, bytes } = await snapshot(id, entry, principal);
      assertCurrent(id, entry, principal);
      if (file.size > maxBytes) throw new Error("This file exceeds the approved read limit.");
      return bytes;
    },
    async previewWrite(id: string, principal: ExtensionFilePrincipal, bytes: Uint8Array): Promise<{ current: ExtensionFileSnapshot; proposedDigest: string; proposedBytes: number }> {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SELECTED_FILE_BYTES) throw new Error("The proposed file exceeds the 8 MB limit.");
      const entry = get(id, principal, ["create", "overwrite"]);
      const current = (await snapshot(id, entry, principal)).snapshot;
      assertCurrent(id, entry, principal);
      const proposedDigest = await digest(bytes);
      assertCurrent(id, entry, principal);
      return { current, proposedDigest, proposedBytes: bytes.byteLength };
    },
    async snapshotForWrite(id: string, principal: ExtensionFilePrincipal): Promise<ExtensionFileSnapshot> {
      const entry = get(id, principal, ["create", "overwrite"]);
      const result = (await snapshot(id, entry, principal)).snapshot;
      assertCurrent(id, entry, principal);
      return result;
    },
    async commitWrite(id: string, principal: ExtensionFilePrincipal, bytes: Uint8Array, reviewed: { current: ExtensionFileSnapshot; proposedDigest: string }): Promise<void> {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SELECTED_FILE_BYTES || await digest(bytes) !== reviewed.proposedDigest) throw new Error("The file contents changed after review.");
      const entry = get(id, principal, ["create", "overwrite"]);
      const actual = (await snapshot(id, entry, principal)).snapshot;
      assertCurrent(id, entry, principal);
      if (actual.size !== reviewed.current.size || actual.lastModified !== reviewed.current.lastModified || actual.digest !== reviewed.current.digest) throw new Error("The selected file changed after review.");
      const writer = await entry.native.createWritable();
      let closing = false, aborted = false;
      const abortBeforeClose = async (): Promise<void> => {
        if (!writer.abort) throw new ExtensionFileWriteUncertainError();
        try { await writer.abort(); aborted = true; } catch { throw new ExtensionFileWriteUncertainError(); }
      };
      try {
        assertCurrent(id, entry, principal);
        await writer.write(bytes);
        if (!isCurrent(id, entry, principal)) {
          await abortBeforeClose();
          throw new Error("File access is no longer available.");
        }
        assertCurrent(id, entry, principal);
        closing = true;
        await writer.close();
        if (!isCurrent(id, entry, principal)) throw new ExtensionFileWriteUncertainError();
      } catch (error) {
        if (closing) throw new ExtensionFileWriteUncertainError();
        if (!aborted) await abortBeforeClose();
        if (error instanceof ExtensionFileWriteUncertainError) throw error;
        throw error;
      }
    },
    remove(id: string, principal: ExtensionFilePrincipal): boolean {
      const entry = handles.get(id);
      if (!entry || !samePrincipal(entry.principal, principal)) return false;
      return handles.delete(id);
    },
    invalidatePackage(packageId: string): number {
      let removed = 0;
      for (const [id, entry] of handles) if (entry.principal.packageId === packageId) { handles.delete(id); removed++; }
      return removed;
    },
    close(): void { handles.clear(); },
    get size(): number { prune(); return handles.size; },
  };
}
