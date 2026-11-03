/**
 * Image pack codec: one supported raster image or a ZIP of pictures (and nothing else) reads into a Sprite pack,
 * one item per image, labeled by file name. A folder of pictures, such as SillyTavern's `backgrounds/`, can still be
 * zipped and imported as a pack; individual PNG/JPEG/GIF/WebP files use the same import path. A printed Mood Music
 * pack comes back too: sounds are read as media and held to the media cap. Pack refs are sealed on save, so nothing
 * is kept beside them. ZIP reading shares the Sprite pack editor's bounded rules (core/media/zip-import.ts). A ZIP
 * that holds anything else (a card, a manifest, a document) is not claimed, so a .charx or a backup never reads as a pack.
 */
import { zipSync } from "fflate";
import type { AdapterInput, AdapterOutput, PackAdapter } from "../../core/adapter";
import { ArchiveLimitError, isArchiveLimitError, PACK_ARCHIVE_BOUNDS, unzipBounded } from "../../core/archive";
import { base64ToBytes, bytesToBase64 } from "../../core/base64";
import { CANONICAL_SCHEMA_VERSION, canonicalId } from "../../core/canonical";
import { packFromZipBytes } from "../../core/media";
import { packZipLimitMessage } from "../../core/media/zip-import";
import { packEntryNames } from "../../core/media/pack-zip";
import type { CanonicalPack } from "../../entities/pack/schema";
import { isZipBytes } from "../../core/bytes";
import { isPackMediaName, isPackPictureJunk, isPackPictureName } from "../../core/media/pack-picture";
import { IMAGE_MAX_BYTES, imageLimitLabel } from "../../core/media/image-limit";
import { rasterImageMimeFromBytes } from "../../core/media/mime";
import extractPngChunks from "png-chunks-extract";

const FORMAT_ID = "image-pack";

const baseName = (path: string): string => path.replaceAll("\\", "/").split("/").pop() ?? path;

/**
 * Listing names inflates nothing, so it may look at any file a door hands an adapter (and any entry count a
 * ZIP can hold): a zip of pictures over the PACK limits is still recognised, and the read says which one it broke.
 */
const LISTING_BOUNDS = { ...PACK_ARCHIVE_BOUNDS, maxEntries: 65_535 };

/** The entry names of a ZIP, read without inflating anything; null when it is not a ZIP we can list. */
function entryNames(bytes: Uint8Array): string[] | null {
  if (!isZipBytes(bytes)) return null;
  const names: string[] = [];
  try {
    unzipBounded(bytes, { bounds: LISTING_BOUNDS, filter: (f) => { names.push(f.name); return false; } });
  } catch {
    return null;
  }
  return names;
}

/** The pictures and sounds of a ZIP that holds only those (junk aside), or null when it holds anything else or nothing. */
function onlyImages(bytes: Uint8Array | undefined): string[] | null {
  const names = bytes ? entryNames(bytes)?.filter((n) => !isPackPictureJunk(n)) : null;
  return names && names.length > 0 && names.every(isPackMediaName) ? names : null;
}

function rawPicture(input: AdapterInput): { name: string; mime: string; bytes: Uint8Array } | null {
  const bytes = input.bytes;
  const name = input.filename;
  if (!bytes || !name || !isPackPictureName(name)) return null;
  const mime = rasterImageMimeFromBytes(bytes);
  if (!mime) return null;
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if ((ext === "png" && mime !== "image/png") || ((ext === "jpg" || ext === "jpeg") && mime !== "image/jpeg")
    || (ext === "gif" && mime !== "image/gif") || (ext === "webp" && mime !== "image/webp")) return null;
  if (bytes.length <= IMAGE_MAX_BYTES && !completeRaster(bytes, mime)) return null;
  return { name, mime, bytes };
}

function completeRaster(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/png") {
    try {
      const chunks = extractPngChunks(bytes);
      const header = chunks[0];
      const size = header?.data.length === 13 ? new DataView(header.data.buffer, header.data.byteOffset, header.data.byteLength) : null;
      return header?.name === "IHDR" && !!size && size.getUint32(0) > 0 && size.getUint32(4) > 0
        && chunks.some((chunk) => chunk.name === "IDAT" && chunk.data.length > 0)
        && chunks.at(-1)?.name === "IEND";
    } catch { return false; }
  }
  if (mime === "image/jpeg") return completeJpeg(bytes);
  if (mime === "image/gif") return completeGif(bytes);
  if (mime === "image/webp") return completeWebp(bytes);
  return false;
}

function completeJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
  let offset = 2;
  let frame = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) {
      if (!frame || offset + 2 > bytes.length - 2) return false;
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
      const components = bytes[offset + 2]!;
      return components > 0 && length === 6 + 2 * components && offset + length < bytes.length - 2;
    }
    if (marker === 0xd9 || marker === 0x00 || marker === 0xd8 || marker === undefined) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length - 2) return false;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    const end = offset + length;
    if (length < 2 || end > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      const components = bytes[offset + 7]!;
      if (length !== 8 + 3 * components || components === 0 || bytes[offset + 3] === 0 && bytes[offset + 4] === 0 || bytes[offset + 5] === 0 && bytes[offset + 6] === 0) return false;
      frame = true;
    }
    offset = end;
  }
  return false;
}

function completeGif(bytes: Uint8Array): boolean {
  if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6)))) return false;
  const width = bytes[6]! | (bytes[7]! << 8);
  const height = bytes[8]! | (bytes[9]! << 8);
  if (!width || !height) return false;
  let offset = 13;
  if (bytes[10]! & 0x80) offset += 3 * (1 << ((bytes[10]! & 7) + 1));
  let image = false;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return image && offset === bytes.length;
    if (marker === 0x21) {
      if (offset >= bytes.length) return false;
      offset++;
    } else if (marker === 0x2c) {
      if (offset + 9 > bytes.length) return false;
      const packed = bytes[offset + 8]!;
      const frameWidth = bytes[offset + 4]! | (bytes[offset + 5]! << 8);
      const frameHeight = bytes[offset + 6]! | (bytes[offset + 7]! << 8);
      offset += 9;
      if (!frameWidth || !frameHeight) return false;
      if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
      const codeSize = bytes[offset++];
      if (codeSize === undefined || codeSize < 2 || codeSize > 8) return false;
      image = true;
    } else return false;
    let data = 0;
    for (;;) {
      if (offset >= bytes.length) return false;
      const size = bytes[offset++]!;
      if (size === 0) break;
      if (offset + size > bytes.length) return false;
      data += size;
      offset += size;
    }
    if (marker === 0x2c && data === 0) return false;
  }
  return false;
}

function completeWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return false;
  return webpImageChunks(bytes, 12, bytes.length, true);
}

/** Walk bounded RIFF chunks; animation frames contain one nonrecursive image chunk list. */
function webpImageChunks(bytes: Uint8Array, offset: number, limit: number, allowFrames: boolean): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let image = false;
  while (offset < limit) {
    if (offset + 8 > limit) return false;
    const name = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end + (size & 1) > limit) return false;
    if (name === "VP8 ") {
      if (size <= 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a
        || !(view.getUint16(start + 6, true) & 0x3fff) || !(view.getUint16(start + 8, true) & 0x3fff)) return false;
      image = true;
    } else if (name === "VP8L") {
      if (size <= 5 || bytes[start] !== 0x2f) return false;
      image = true;
    } else if (name === "VP8X" && size !== 10) return false;
    else if (name === "ANMF") {
      if (!allowFrames || size <= 16 || !webpImageChunks(bytes, start + 16, end, false)) return false;
      image = true;
    }
    offset = end + (size & 1);
  }
  return image && offset === limit;
}

const packName = (filename: string): string => baseName(filename).replace(/\.[^.]*$/, "").trim() || "Image pack";

const imagePack: PackAdapter = {
  id: FORMAT_ID,
  label: "Media pack (ZIP pictures/sounds or raster picture)",
  outputExtensions: ["zip"],
  kind: "pack",

  detect(input: AdapterInput): number {
    return onlyImages(input.bytes) || rawPicture(input) ? 0.6 : 0;
  },

  toCanonical(input: AdapterInput): CanonicalPack {
    const raw = rawPicture(input);
    if (raw) {
      if (raw.bytes.length > IMAGE_MAX_BYTES) throw new ArchiveLimitError(`This picture is too large. The limit is ${imageLimitLabel()}.`, "entry-size", IMAGE_MAX_BYTES, true);
      const name = packName(raw.name);
      const label = name;
      return {
        schemaVersion: CANONICAL_SCHEMA_VERSION,
        kind: "pack",
        id: canonicalId(name),
        body: { name, pack: { items: [{ id: canonicalId(name), label, ref: `data:${raw.mime};base64,${bytesToBase64(raw.bytes)}`, mime: raw.mime }] } },
        original: { [FORMAT_ID]: { raw: { files: [raw.name] } } },
      };
    }
    const names = onlyImages(input.bytes);
    if (!input.bytes || !names) throw new Error("image-pack: not a ZIP of pictures");
    const name = packName(input.filename ?? "");
    let pack;
    try { pack = packFromZipBytes(input.bytes); }
    catch (error) {
      // The reading bounds are the pack bounds; say which one this zip broke, in the user's words.
      if (isArchiveLimitError(error)) throw new ArchiveLimitError(packZipLimitMessage(error, input.bytes.length), error.kind, error.limit, true);
      throw error;
    }
    if (pack.items.length === 0) throw new Error("image-pack: the ZIP holds no readable pictures");
    return {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      kind: "pack",
      id: canonicalId(name),
      body: { name, pack },
      original: { [FORMAT_ID]: { raw: { files: names } } },
    };
  },

  fromCanonical(entity: CanonicalPack): AdapterOutput {
    const pictures = entity.body.pack.items.map((item) => {
      const match = /^data:((?:image|audio)\/[a-z0-9.+-]+);base64,(.*)$/i.exec(item.ref);
      if (!match) throw new Error(`image-pack: "${item.label}" is not an inline picture or sound, so this pack cannot be written as a ZIP`);
      return { label: item.label, mime: match[1]!, bytes: base64ToBytes(match[2]!) };
    });
    // Names are decided together, so no two pictures can take one file; level 0 because pictures are already compressed.
    const names = packEntryNames(pictures);
    const files: Record<string, Uint8Array> = {};
    pictures.forEach((picture, i) => { files[names[i]!] = picture.bytes; });
    return { bytes: zipSync(files, { level: 0 }), suggestedExtension: "zip" };
  },
};

export default imagePack;
