/** Canonical bounded base64 transport for value-only file operations. */
import { sha256HexBytes } from "../../../core/sha256";
import { MAX_EXTENSION_FILE_TRANSFER_BYTES } from "../../contracts/limits";

export const MAX_FILE_BYTES = MAX_EXTENSION_FILE_TRANSFER_BYTES;
export function encodeFileBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
}
export function decodeFileBytes(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new Error("File data must be canonical base64 and at most 180 KB.");
  const binary = atob(value);
  if (binary.length > MAX_FILE_BYTES) throw new Error("The file exceeds the 180 KB operation limit.");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (encodeFileBytes(bytes) !== value) throw new Error("File data must use canonical base64 encoding.");
  return bytes;
}
export const digestFileBytes = (bytes: Uint8Array): string => sha256HexBytes(bytes);
