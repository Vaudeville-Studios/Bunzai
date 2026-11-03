/** Shared staged-media picker callback and bounded per-editor grant owner. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { StagedAssetUpload } from "../app-contract-editor";
import { apiFetch, LIBRARY_LOCKED_EVENT } from "./api-fetch";
import { artCache } from "./art-cache";
import { ASSET_ADOPT_COUNT } from "./asset-content";
import { parseUploadedRef } from "../../entities/piece-parts-blob";
import { ASSET_BATCH_BYTES, ASSET_BATCH_COUNT, ASSET_MAX_BYTES } from "../../core/media/limits";

export type UploadedAsset = { ref: string; mime: string; receipt: string };
export type AssetUpload = (file: File, signal?: AbortSignal) => Promise<UploadedAsset>;
export type AssetBatchUpload = (files: readonly File[], signal?: AbortSignal) => Promise<UploadedAsset[]>;
export type AssetTransfer = (refs: readonly string[], signal?: AbortSignal) => Promise<{ assets: Record<string, string>; receipts: string[]; grants: StagedAssetUpload[] }>;

const CANCELED = "media staging was canceled";

type Reservation = { controller: AbortController; files: number; bytes: number };

export function referencedAssetUploads(value: unknown, uploads: readonly StagedAssetUpload[]): StagedAssetUpload[] {
  const refs = new Set<string>();
  const visit = (part: unknown): void => {
    if (typeof part === "string") refs.add(part);
    else if (Array.isArray(part)) part.forEach(visit);
    else if (part !== null && typeof part === "object") Object.values(part).forEach(visit);
  };
  visit(value);
  return uploads.filter((upload) => refs.has(upload.asset));
}

export function historyContainsAssetRef(value: unknown, asset: string): boolean {
  const seen = new Set<object>();
  const visit = (part: unknown): boolean => {
    if (part === asset) return true;
    if (part === null || typeof part !== "object" || seen.has(part)) return false;
    seen.add(part);
    return Object.values(part).some(visit);
  };
  return visit(value);
}

export function useAssetUploads(
  stage: (file: File, signal?: AbortSignal) => Promise<StagedAssetUpload>,
  discardRemote: (refs: readonly string[]) => Promise<void>,
  onError: (error: unknown) => void,
): {
  uploads: StagedAssetUpload[];
  uploadAsset: AssetUpload;
  uploadBatch: AssetBatchUpload;
  transferAssets: AssetTransfer;
  stageAsset(file: File, signal?: AbortSignal): Promise<StagedAssetUpload>;
  accept(refs: readonly string[]): void;
  discard(refs: readonly string[]): Promise<void>;
  pin(refs: readonly string[]): void;
  unpin(refs: readonly string[]): void;
  discardUnused(refs: readonly string[], currentDraft: unknown, retained?: (grant: StagedAssetUpload) => boolean): Promise<string[]>;
} {
  const [uploads, setUploads] = useState<StagedAssetUpload[]>([]);
  const current = useRef<StagedAssetUpload[]>([]);
  const reservations = useRef(new Map<number, Reservation>());
  const pinned = useRef(new Set<string>());
  const tail = useRef(Promise.resolve());
  const sequence = useRef(0);
  const generation = useRef(0);
  const disposed = useRef(false);
  const stageRef = useRef(stage);
  const discardRef = useRef(discardRemote);
  const errorRef = useRef(onError);
  stageRef.current = stage;
  discardRef.current = discardRemote;
  errorRef.current = onError;

  const update = useCallback((next: StagedAssetUpload[]) => {
    current.current = next;
    if (!disposed.current) setUploads(next);
  }, []);
  const discard = useCallback(async (refs: readonly string[]): Promise<void> => {
    const unique = [...new Set(refs)];
    if (!unique.length) return;
    try {
      await discardRef.current(unique);
    } catch (error) {
      errorRef.current(error);
    } finally {
      const removed = new Set(unique);
      unique.forEach((ref) => pinned.current.delete(ref));
      update(current.current.filter((upload) => !removed.has(upload.ref)));
    }
  }, [update]);
  const pin = useCallback((refs: readonly string[]) => { refs.forEach((ref) => pinned.current.add(ref)); }, []);
  const unpin = useCallback((refs: readonly string[]) => { refs.forEach((ref) => pinned.current.delete(ref)); }, []);
  const discardUnused = useCallback(async (refs: readonly string[], value: unknown, retained?: (grant: StagedAssetUpload) => boolean): Promise<string[]> => {
    const live = new Set<string>();
    const visit = (part: unknown): void => {
      if (typeof part === "string") live.add(part);
      else if (Array.isArray(part)) part.forEach(visit);
      else if (part !== null && typeof part === "object") Object.values(part).forEach(visit);
    };
    visit(value);
    const candidates = new Set(refs);
    const revoke = current.current.filter((upload) => candidates.has(upload.ref) && !pinned.current.has(upload.ref) && !live.has(upload.asset) && !retained?.(upload)).map((upload) => upload.ref);
    await discard(revoke);
    return revoke;
  }, [discard]);

  const cancelPending = useCallback(() => {
    generation.current++;
    pinned.current.clear();
    for (const reservation of reservations.current.values()) reservation.controller.abort();
    void discard(current.current.map((upload) => upload.ref));
  }, [discard]);

  useEffect(() => {
    disposed.current = false;
    window.addEventListener(LIBRARY_LOCKED_EVENT, cancelPending);
    return () => {
      disposed.current = true;
      window.removeEventListener(LIBRARY_LOCKED_EVENT, cancelPending);
      cancelPending();
    };
  }, [cancelPending]);

  const stageFiles = useCallback((input: readonly File[], externalSignal?: AbortSignal): Promise<StagedAssetUpload[]> => {
    if (!input.length) return Promise.resolve([]);
    const bytes = input.reduce((sum, file) => sum + file.size, 0);
    const pendingCount = [...reservations.current.values()].reduce((sum, row) => sum + row.files, 0);
    const pendingBytes = [...reservations.current.values()].reduce((sum, row) => sum + row.bytes, 0);
    const usedBytes = current.current.filter((row) => !row.adopted).reduce((sum, row) => sum + row.bytes, 0);
    if (disposed.current || externalSignal?.aborted) return Promise.reject(new Error(CANCELED));
    if (input.some((file) => file.size > ASSET_MAX_BYTES) || current.current.filter((row) => !row.adopted).length + pendingCount + input.length > ASSET_BATCH_COUNT || usedBytes + pendingBytes + bytes > ASSET_BATCH_BYTES) {
      const error = new Error("Save or discard current media edits before staging this batch.");
      errorRef.current(error);
      return Promise.reject(error);
    }
    const files = [...input];
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    const id = ++sequence.current;
    const admittedGeneration = generation.current;
    reservations.current.set(id, { controller, files: files.length, bytes });
    const task = tail.current.then(async () => {
      const grants: StagedAssetUpload[] = [];
      try {
        for (const file of files) {
          if (controller.signal.aborted || disposed.current || generation.current !== admittedGeneration) throw new Error(CANCELED);
          const grant = await stageRef.current(file, controller.signal);
          if (controller.signal.aborted || disposed.current || generation.current !== admittedGeneration) {
            await discardRef.current([grant.ref]).catch(errorRef.current);
            throw new Error(CANCELED);
          }
          const reservation = reservations.current.get(id);
          if (reservation) { reservation.files--; reservation.bytes -= file.size; }
          grants.push(grant);
          // The server serves a staged blob only after save; the editor previews it from the bytes it just sent.
          artCache.prime(`sha:${grant.sha}:full`, file);
          update([...current.current, grant]);
        }
        return grants;
      } catch (error) {
        if (grants.length) await discard(grants.map((grant) => grant.ref));
        if (!(error instanceof Error && error.message === CANCELED)) errorRef.current(error);
        throw error;
      } finally {
        reservations.current.delete(id);
        externalSignal?.removeEventListener("abort", abort);
      }
    });
    tail.current = task.then(() => undefined, () => undefined);
    return task;
  }, [discard, update]);

  const stageAsset = useCallback(async (file: File, signal?: AbortSignal): Promise<StagedAssetUpload> => {
    const [grant] = await stageFiles([file], signal);
    if (!grant) throw new Error(CANCELED);
    return grant;
  }, [stageFiles]);
  const uploadAsset = useCallback<AssetUpload>(async (file, signal) => {
    const grant = await stageAsset(file, signal);
    return { ref: grant.asset, mime: grant.mime, receipt: grant.ref };
  }, [stageAsset]);
  const uploadBatch = useCallback<AssetBatchUpload>(async (files, signal) =>
    (await stageFiles(files, signal)).map((grant) => ({ ref: grant.asset, mime: grant.mime, receipt: grant.ref })),
  [stageFiles]);
  const transferAssets = useCallback<AssetTransfer>(async (refs, signal) => {
    const all = [...new Set(refs)];
    // A small picture lives inline in the pack (a data URI): it travels as itself and needs no grant.
    const unique = all.filter((ref) => !/^data:image\/[a-z0-9.+-]+;base64,/i.test(ref));
    const inline = all.filter((ref) => !unique.includes(ref));
    if (!unique.length) return { assets: Object.fromEntries(inline.map((ref) => [ref, ref])), receipts: [], grants: [] };
    if (unique.length > ASSET_ADOPT_COUNT) throw new Error(`Copy at most ${ASSET_ADOPT_COUNT} pictures at a time.`);
    if (unique.some((ref) => !parseUploadedRef(ref))) throw new Error("This pack contains an asset reference that cannot be transferred safely.");
    if (disposed.current || signal?.aborted) throw new Error(CANCELED);
    // The library already holds these pictures: the server mints grants over them and no bytes cross the wire.
    const admittedGeneration = generation.current;
    const response = await apiFetch("/api/asset/adopt", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assets: unique }), ...(signal ? { signal } : {}),
    });
    const body = (await response.json().catch(() => null)) as { grants?: StagedAssetUpload[]; error?: unknown } | null;
    if (!response.ok || !body?.grants || body.grants.length !== unique.length) {
      throw new Error(typeof body?.error === "string" ? body.error : `Copying the pictures failed (${response.status}).`);
    }
    if (disposed.current || signal?.aborted || generation.current !== admittedGeneration) {
      await discard(body.grants.map((grant) => grant.ref));
      throw new Error(CANCELED);
    }
    const grants = body.grants.map((grant) => ({ ...grant, adopted: true as const }));
    update([...current.current, ...grants]);
    return { assets: { ...Object.fromEntries(inline.map((ref) => [ref, ref])), ...Object.fromEntries(unique.map((ref, index) => [ref, grants[index]!.asset])) }, receipts: grants.map((grant) => grant.ref), grants };
  }, [discard, update]);
  const accept = useCallback((refs: readonly string[]) => {
    const consumed = new Set(refs);
    refs.forEach((ref) => pinned.current.delete(ref));
    update(current.current.filter((item) => !consumed.has(item.ref)));
  }, [update]);
  return { uploads, uploadAsset, uploadBatch, transferAssets, stageAsset, accept, discard, pin, unpin, discardUnused };
}
