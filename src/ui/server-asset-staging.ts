/** Authenticated, bounded asset uploads staged only as per-process AES-GCM ciphertext. */
import { createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pumpStream, type ByteSink } from "../core/stream-bytes";
import { hashSink, sealedFileSink } from "./server-body";
import type { PartBlob } from "../stage/contracts/content-store";
import { err, json, readJsonObject } from "./server-security";
import { clearAdopted, isAdoptedRef, openAdopted, revokeAdopted } from "./server-asset-adopt";
export { adoptLibraryAssets } from "./server-asset-adopt";
import type { StudioStoreLike } from "../studio/contracts";
import { mimeFromBytes, validAssetGrantRefs, assetCapFor, ASSET_UPLOAD_TTL } from "./_shared/asset-content";
import { ASSET_BATCH_BYTES, ASSET_BATCH_COUNT } from "../core/media/limits";
import { toErrorMessage } from "../error-message";
import { extensionOf, MIME_BY_EXT } from "../core/media/mime";

const TTL_MS = ASSET_UPLOAD_TTL;
const CLEANUP_LIMIT = ASSET_BATCH_COUNT * 2;
const SEALED_OVERHEAD_BYTES = 12 + 16;
const KEY = randomBytes(32);
const staged = new Map<string, { dir: string; file: string; session: string; sha: string; mime: string; ext: string; bytes: number; expires: number; generation: number }>();
const active = new Set<{ generation: number; controller: AbortController; dir: string }>();
const failedCleanup = new Map<string, number>();
let stagedBytes = 0;
let activeBytes = 0;
let cleanupBytes = 0;
let generation = 0;

export class AssetStageError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AssetStageError";
  }
}

function textFileName(raw: string | null): string {
  if (!raw) return "";
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* invalid escapes stay opaque and fail below */ }
  return decoded.split(/[\\/]/).at(-1) ?? "";
}

async function removeDir(dir: string, bytes: number): Promise<void> {
  if (!failedCleanup.has(dir)) {
    failedCleanup.set(dir, bytes);
    cleanupBytes += bytes;
  }
  try {
    await rm(dir, { recursive: true, force: true });
    const held = failedCleanup.get(dir);
    if (held !== undefined) cleanupBytes -= held;
    failedCleanup.delete(dir);
  } catch {
    // The reserved queue entry and byte count remain until a retry succeeds.
  }
}

async function retryCleanup(): Promise<void> {
  for (const [dir, bytes] of [...failedCleanup]) await removeDir(dir, bytes);
}

function revoke(ref: string): Promise<void> {
  const entry = staged.get(ref);
  if (!entry) return Promise.resolve();
  staged.delete(ref);
  const storedBytes = entry.bytes + SEALED_OVERHEAD_BYTES;
  stagedBytes -= storedBytes;
  return removeDir(entry.dir, storedBytes);
}

function pruneExpired(now = Date.now()): void {
  for (const [ref, entry] of staged) if (entry.expires <= now) void revoke(ref);
  void retryCleanup();
}

const expiryTimer = setInterval(pruneExpired, 60_000); // interval-ok: server upload expiry must reclaim ciphertext without a visible tab
expiryTimer.unref?.();

function stillLive(uploadGeneration: number, signal: AbortSignal): void {
  if (uploadGeneration !== generation || signal.aborted) throw new AssetStageError(423, "library lock cancelled this upload");
}

/** Stream one validated NamedAsset into a live encrypted-library session's sealed staging area. */
export async function stageAssetUpload(req: Request, session: string, isUnlocked: () => Promise<boolean>): Promise<Response> {
  if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/octet-stream") return err("unsupported media type", 415);
  const filename = textFileName(req.headers.get("x-filename"));
  const length = req.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > assetCapFor(extensionOf(filename)))) return err("payload too large", 413);
  return stageAssetStream(req.body, { filename, signal: req.signal }, session, isUnlocked);
}

/** The same staging for any byte stream (an upload body, a fetched link): sealed on disk as it arrives, never held whole. */
export async function stageAssetStream(body: ReadableStream<Uint8Array> | null, source: { filename: string; signal: AbortSignal }, session: string, isUnlocked: () => Promise<boolean>): Promise<Response> {
  if (!body || !session) return err("empty upload", 400);
  const ext = extensionOf(source.filename);
  if (!Object.hasOwn(MIME_BY_EXT, ext)) return err("unsupported NamedAsset type", 415);
  pruneExpired();
  if (failedCleanup.size + staged.size + active.size >= CLEANUP_LIMIT) return err("staged upload cleanup is at capacity", 503);
  if (staged.size + active.size >= ASSET_BATCH_COUNT) return err("too many staged uploads", 413);
  const uploadGeneration = generation;
  const controller = new AbortController();
  const upload = { generation: uploadGeneration, controller, dir: "" };
  active.add(upload);
  activeBytes += SEALED_OVERHEAD_BYTES;
  const abort = (): void => controller.abort();
  if (source.signal.aborted) controller.abort();
  source.signal.addEventListener("abort", abort, { once: true });
  let reservedBytes = SEALED_OVERHEAD_BYTES;
  let bytes = 0;
  let prefix = new Uint8Array(0);
  let text = "";
  let decoder: TextDecoder | undefined;
  if (["svg", "css", "txt", "md", "csv", "json"].includes(ext)) decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    stillLive(uploadGeneration, controller.signal);
    if (!(await isUnlocked())) throw new AssetStageError(423, "the library is locked");
    stillLive(uploadGeneration, controller.signal);
    upload.dir = await mkdtemp(join(tmpdir(), "bunzai-asset-staged-"));
    const file = join(upload.dir, "sealed.bin");
    stillLive(uploadGeneration, controller.signal);
    const sealed = hashSink(await sealedFileSink(file, KEY));
    const metered: ByteSink = {
      write(chunk) {
        bytes += chunk.byteLength;
        if (stagedBytes + activeBytes + cleanupBytes + chunk.byteLength > ASSET_BATCH_BYTES) throw new AssetStageError(413, "staged upload budget exceeded");
        activeBytes += chunk.byteLength;
        reservedBytes += chunk.byteLength;
        if (prefix.length < 4096) prefix = Buffer.concat([prefix, chunk.subarray(0, 4096 - prefix.length)]);
        if (decoder) {
          try {
            text += decoder.decode(chunk, { stream: true });
          } catch {
            throw new AssetStageError(415, "text NamedAsset must be valid UTF-8");
          }
          if ((ext === "svg" && bytes > 4 * 1024 * 1024) || (["css", "txt", "md", "csv", "json"].includes(ext) && bytes > 2 * 1024 * 1024)) throw new AssetStageError(413, "text media exceeds its size limit");
        }
        return sealed.write(chunk);
      },
      finish: () => sealed.finish(),
      abort: () => sealed.abort(),
    };
    const pumped = await pumpStream(body, metered, { limit: assetCapFor(ext), signal: controller.signal });
    if (!pumped.ok) throw pumped.reason === "too-large" ? new AssetStageError(413, "payload too large") : pumped.error ?? new Error("upload stopped");
    stillLive(uploadGeneration, controller.signal);
    if (!(await isUnlocked())) throw new AssetStageError(423, "the library is locked");
    if (decoder) {
      try { text += decoder.decode(); } catch { throw new AssetStageError(415, "text NamedAsset must be valid UTF-8"); }
    }
    const mime = mimeFromBytes(prefix, ext, text);
    if (!mime || bytes === 0) throw new AssetStageError(415, "file contents do not match a supported NamedAsset type");
    stillLive(uploadGeneration, controller.signal);
    const sha = sealed.sha256();
    const ref = randomBytes(24).toString("base64url");
    staged.set(ref, { dir: upload.dir, file, session, sha, mime, ext, bytes, expires: Date.now() + TTL_MS, generation: uploadGeneration });
    stagedBytes += bytes + SEALED_OVERHEAD_BYTES;
    return new Response(JSON.stringify({ sha, mime, bytes, ref, asset: `\u0000b:u:${mime}:${sha}` }), {
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof AssetStageError) return err(error.message, error.status);
    if (uploadGeneration !== generation) return err("library lock cancelled this upload", 423);
    return err("failed to stage upload", 400);
  } finally {
    if (upload.dir && ![...staged.values()].some((entry) => entry.dir === upload.dir)) {
      const removal = removeDir(upload.dir, bytes + SEALED_OVERHEAD_BYTES);
      active.delete(upload);
      activeBytes -= reservedBytes;
      source.signal.removeEventListener("abort", abort);
      await removal;
    } else {
      active.delete(upload);
      activeBytes -= reservedBytes;
      source.signal.removeEventListener("abort", abort);
    }
  }
}

/** Resolve server-minted upload refs for the same authenticated session, then seal into blob rows on patch. */
export async function openSessionUploads(refs: readonly string[], session: string, store?: Pick<StudioStoreLike, "readAsset">): Promise<PartBlob[]> {
  const output: PartBlob[] = [];
  // Grants over pictures the library already holds are spent from the library, not from staged ciphertext.
  for (const ref of refs) {
    if (!isAdoptedRef(ref)) continue;
    if (!store) throw new AssetStageError(403, "upload ref is missing or belongs to another session");
    try { const blob = await openAdopted(ref, session, store); if (blob) output.push(blob); }
    catch (error) { throw new AssetStageError(403, toErrorMessage(error, "adopted picture unavailable")); }
  }
  refs = refs.filter((ref) => !isAdoptedRef(ref));
  if (refs.length > ASSET_BATCH_COUNT || new Set(refs).size !== refs.length || refs.some((ref) => typeof ref !== "string")) {
    throw new AssetStageError(400, "invalid upload refs");
  }
  for (const ref of refs) {
    const entry = staged.get(ref);
    if (!entry || entry.generation !== generation || entry.expires <= Date.now() || entry.session !== session) {
      if (entry?.expires !== undefined && entry.expires <= Date.now()) void revoke(ref);
      throw new AssetStageError(403, "upload ref is missing or belongs to another session");
    }
    const file = await readFile(entry.file);
    if (entry.generation !== generation || staged.get(ref) !== entry) throw new AssetStageError(403, "upload ref was revoked");
    if (file.length < 28) throw new AssetStageError(400, "staged upload is damaged");
    const decipher = createDecipheriv("aes-256-gcm", KEY, file.subarray(0, 12));
    decipher.setAuthTag(file.subarray(file.length - 16));
    let bytes: Buffer;
    try {
      bytes = Buffer.concat([decipher.update(file.subarray(12, -16)), decipher.final()]);
    } catch {
      throw new AssetStageError(400, "staged upload is damaged");
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    let text = "";
    if (entry.ext === "svg" || entry.ext === "css") {
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new AssetStageError(400, "staged upload is damaged"); }
    }
    if (sha !== entry.sha || bytes.byteLength !== entry.bytes || mimeFromBytes(bytes.subarray(0, 4096), entry.ext, text) !== entry.mime) {
      throw new AssetStageError(400, "staged upload does not match its reference");
    }
    output.push({ key: sha, payload: { kind: "bytes", bytes: new Uint8Array(bytes) } });
  }
  return output;
}

/** Revoke grants immediately; failed filesystem removals are retried by the bounded cleanup owner. */
export async function consumeSessionUploads(refs: readonly string[], session: string): Promise<void> {
  for (const ref of refs) { revokeAdopted(ref, session); if (staged.get(ref)?.session === session) void revoke(ref); }
}

/** Explicit cancellation revokes only this authenticated session's unused grants. */
export async function discardAssetUploads(request: Request, session: string): Promise<Response> {
  const parsed = await readJsonObject(request, 4096);
  if (!parsed.ok) return parsed.response;
  if (!validAssetGrantRefs(parsed.value.refs)) return err("invalid upload grants", 400);
  await consumeSessionUploads(parsed.value.refs, session);
  return json({ discarded: true });
}

/** Lock, shutdown, and generation changes revoke grants and abort active streams before they can publish. */
export async function clearStagedAssets(): Promise<void> {
  clearAdopted();
  generation++;
  for (const upload of active) upload.controller.abort();
  await Promise.all([...staged.keys()].map(revoke));
  await retryCleanup();
}
