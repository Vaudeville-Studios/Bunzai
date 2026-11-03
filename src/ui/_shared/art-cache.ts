/**
 * One visibility-gated cache for decrypted assets; pending and resolved bytes share its 64 MiB budget.
 * A displayed URL is leased: eviction never revokes a leased entry, so a visible image cannot go broken.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefCallback } from "react";
import { apiFetch, LIBRARY_LOCKED_EVENT } from "./api-fetch";
import { isBrowserStudio } from "../../browser-mode";
import type { PieceStore } from "./piece-store";
import { parseUploadedRef } from "../../entities/piece-parts-blob";
import { assetRouteSha } from "../../core/media/asset-route";
import { isSha256Hex } from "../../core/sha256";
import { ASSET_MAX_BYTES } from "../../core/media/limits";

const ASSET_CACHE_BYTES = 64 * 1024 * 1024;

interface CacheEntry {
  key: string;
  ready: Promise<Blob>;
  bytes: number;
  live: boolean;
  deliveries: number;
  holds: number;
  joined?: CacheEntry;
  controller: AbortController;
  blob?: Blob;
  objectUrl?: string;
}

interface QueuedRequest {
  url: string;
  identity: string;
  key: string;
  queued: boolean;
  waiters: { resolve(entry: CacheEntry): void; reject(error: unknown): void }[];
}

export interface ArtCacheDeps {
  fetchBlob: (url: string) => Promise<Blob>;
  /** `admit(bytes)` is called once the response size is known and before the body is read; it reserves that many bytes. */
  fetchAsset?: (url: string, signal: AbortSignal, admit?: (bytes: number) => Promise<void>) => Promise<{ blob: Blob; sha?: string }>;
  /** True when `fetchAsset` calls `admit`, so a request needs no worst-case reservation while it only waits for headers. */
  reportsSize?: boolean;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}

export interface ArtLease { url: string; release(): void }

export interface ArtCache {
  get(url: string, identity?: string): Promise<string>;
  /** Like `get`, but the entry stays unevictable until `release()`; hold it for as long as the URL is displayed. */
  lease(url: string, identity?: string): Promise<ArtLease>;
  getBlob(url: string, identity?: string): Promise<Blob>;
  /** Seeds bytes the caller already holds (a file just staged for upload) under `identity`; skipped when it does not fit. */
  prime(identity: string, blob: Blob): void;
  clear(): void;
  onClear(listener: () => void): () => void;
  onDrop(listener: (identity: string) => void): () => void;
  bytes(): number;
  trim(toBytes: number): void;
}

const statusError = (message: string, status: number): Error => Object.assign(new Error(message), { status });
const definitive = (error: unknown): boolean => [404, 410].includes((error as { status?: unknown } | null)?.status as number);

/** Read validated size metadata for one local uploaded asset without loading its body. */
export async function readAssetSize(url: string, signal: AbortSignal): Promise<number> {
  if (assetRouteSha(url.split("?")[0]!) === null) throw new Error("asset size lookup requires a local asset path");
  const head = await apiFetch(url, { method: "HEAD", requireToken: false, signal });
  if (!head.ok) throw statusError(`asset size lookup failed (${String(head.status)})`, head.status);
  const size = head.headers.get("content-length");
  if (size === null || !/^\d+$/.test(size) || !Number.isSafeInteger(Number(size))) throw new Error("asset size header is invalid");
  return Number(size);
}

const defaultDeps = {
  fetchBlob: async (url) => {
    const res = await apiFetch(url, { requireToken: false });
    if (!res.ok) throw statusError(`asset fetch failed (${String(res.status)})`, res.status);
    return res.blob();
  },
  reportsSize: true,
  fetchAsset: async (url, signal, admit) => {
    const hashAsset = assetRouteSha(url.split("?")[0]!) !== null;
    if (hashAsset) {
      if (await readAssetSize(url, signal) > ASSET_MAX_BYTES) throw new DirectAssetError(url);
    }
    const res = await apiFetch(url, { requireToken: false, signal });
    if (!res.ok) throw statusError(`asset fetch failed (${String(res.status)})`, res.status);
    const length = res.headers.get("content-length");
    const directAllowed = url.startsWith("/api/asset/") || url.startsWith("/api/studio/portrait?") || url.startsWith("/api/chats/portrait?");
    if (length !== null && !/^\d+$/.test(length)) throw new Error("asset size header is invalid");
    if (length !== null && Number(length) > ASSET_MAX_BYTES) {
      await res.body?.cancel();
      if (directAllowed) throw new DirectAssetError(url);
      throw new Error("asset exceeds the shared cache admission budget");
    }
    if (length === null) {
      await res.body?.cancel();
      if (directAllowed) throw new DirectAssetError(url);
      throw new Error("asset response has no bounded size");
    }
    await admit?.(Number(length));
    return { blob: await res.blob(), sha: res.headers.get("x-asset-sha256") ?? undefined };
  },
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
} satisfies ArtCacheDeps;

class DirectAssetError extends Error {
  constructor(readonly url: string) { super("asset exceeds the shared cache admission budget"); }
}

/** In-flight requests reserve the route's full 32 MiB maximum until the actual Blob size is known.
 *
 * Exception: a fetcher that reports sizes (`reportsSize`, the default one) reserves exactly the response length once
 * headers arrive, so pending requests never starve each other. Leased entries are never evicted.
 */
export function createArtCache(
  limits: { maxEntries?: number; maxBytes?: number } = {},
  deps: Partial<ArtCacheDeps> = {},
): ArtCache {
  const maxEntries = limits.maxEntries ?? 200;
  const maxBytes = limits.maxBytes ?? ASSET_CACHE_BYTES;
  const maxAliases = Math.min(4096, Math.max(1, Math.floor(maxEntries) * 4));
  const maxAliasBytes = 1024 * 1024;
  const fetchBlob = deps.fetchBlob ?? defaultDeps.fetchBlob;
  const fetchAsset = deps.fetchAsset ?? defaultDeps.fetchAsset;
  const { createUrl, revokeUrl } = { ...defaultDeps, ...deps };
  const sizeAware = (deps.fetchAsset === undefined && deps.fetchBlob === undefined) || deps.reportsSize === true;
  const maxPending = 8;
  const cache = new Map<string, CacheEntry>();
  const aliases = new Map<string, string>();
  const queued = new Map<string, QueuedRequest>();
  /** Only a definitive answer (HTTP 404 or 410) is remembered per identity; any other failure is retried on the next ask. */
  const failures = new Map<string, unknown>();
  const clearListeners = new Set<() => void>();
  const dropListeners = new Set<(identity: string) => void>();
  let totalBytes = 0;
  let pending = 0;
  const admissionWaiters: (() => void)[] = [];
  let queuedWaiters = 0;
  let aliasBytes = 0;
  const aliasKey = (url: string, identity: string): string => `${url}\0${identity}`;

  const removeAlias = (key: string): void => {
    const target = aliases.get(key);
    if (target === undefined) return;
    aliases.delete(key);
    aliasBytes -= (key.length + target.length) * 2;
  };
  const aliasFor = (url: string, identity: string): string | undefined => {
    const key = aliasKey(url, identity), target = aliases.get(key);
    if (target !== undefined) { aliases.delete(key); aliases.set(key, target); }
    return target;
  };
  const rememberAlias = (url: string, identity: string, target: string): void => {
    const key = aliasKey(url, identity), size = (key.length + target.length) * 2;
    removeAlias(key);
    if (size > maxAliasBytes) return;
    while (aliases.size >= maxAliases || aliasBytes + size > maxAliasBytes) {
      const oldest = aliases.keys().next().value;
      if (oldest === undefined) return;
      removeAlias(oldest);
    }
    aliases.set(key, target);
    aliasBytes += size;
  };
  const removeAliases = (entry: CacheEntry): void => {
    for (const [key, target] of aliases) if (target === entry.key) removeAlias(key);
  };
  const drop = (entry: CacheEntry): void => {
    if (!entry.live) return;
    entry.live = false;
    entry.controller.abort();
    if (cache.get(entry.key) === entry) cache.delete(entry.key);
    removeAliases(entry);
    totalBytes = Math.max(0, totalBytes - entry.bytes);
    entry.bytes = 0;
    entry.blob = undefined;
    if (entry.objectUrl) revokeUrl(entry.objectUrl);
    entry.holds = 0;
    for (const listener of dropListeners) listener(entry.key);
  };
  const evictTo = (entries: number, bytes: number, protect?: CacheEntry): void => {
    for (const entry of cache.values()) {
      if (cache.size <= entries && totalBytes <= bytes) return;
      if (entry === protect || !entry.blob || entry.deliveries > 0 || entry.holds > 0) continue;
      drop(entry);
    }
  };
  const touch = (entry: CacheEntry): void => { cache.delete(entry.key); cache.set(entry.key, entry); };
  let draining = false;
  const settle = (request: QueuedRequest, entry: CacheEntry | null, error?: unknown, reserved = false): void => {
    if (request.queued) queuedWaiters -= request.waiters.length;
    request.queued = false;
    for (const waiter of request.waiters) {
      if (entry) { if (!reserved) entry.deliveries++; waiter.resolve(entry); }
      else waiter.reject(error);
    }
    request.waiters.length = 0;
  };
  const releaseDelivery = (entry: CacheEntry): void => {
    while (entry.joined) entry = entry.joined;
    // Let consumers' promise reactions receive the Blob/URL before queued admission can evict it.
    setTimeout(() => {
      entry.deliveries = Math.max(0, entry.deliveries - 1);
      drain();
    }, 0);
  };
  const start = (url: string, identity: string, key: string, deliveries: number): Promise<CacheEntry> => {
    const entry: CacheEntry = { key, ready: Promise.resolve(new Blob()), bytes: sizeAware ? 0 : Math.min(ASSET_MAX_BYTES, maxBytes), live: true, deliveries, holds: 0, controller: new AbortController() };
    let resolvedEntry = entry;
    totalBytes += entry.bytes;
    pending++;
    const admit = async (size: number): Promise<void> => {
      for (;;) {
        if (!entry.live) throw new Error("asset request was evicted");
        if (size > maxBytes) throw new Error("asset exceeds the shared cache budget");
        evictTo(Infinity, maxBytes - (size - entry.bytes), entry);
        if (totalBytes + size - entry.bytes <= maxBytes) { totalBytes += size - entry.bytes; entry.bytes = size; return; }
        // Only leased (displayed) bytes and other admitted downloads stand in the way; wait for one to release.
        if (![...cache.values()].some((other) => other !== entry && (other.holds > 0 || (!other.blob && other.bytes > 0)))) throw new Error("asset cache is full of displayed art");
        await new Promise<void>((resolve) => admissionWaiters.push(resolve));
      }
    };
    const fetching = deps.fetchAsset
      ? fetchAsset(url, entry.controller.signal, admit)
      : deps.fetchBlob
        ? fetchBlob(url).then((blob) => ({ blob, sha: undefined }))
        : fetchAsset(url, entry.controller.signal, admit);
    entry.ready = fetching
      .then(({ blob, sha }) => {
        if (blob.size > ASSET_MAX_BYTES) throw new Error("asset exceeds the full-response byte limit");
        if (blob.size > maxBytes) throw new Error("asset exceeds the shared cache budget");
        if (!entry.live) throw new Error("asset request was evicted");
        const canonical = isSha256Hex(sha) ? `sha:${sha}:full` : identity;
        const existing = cache.get(canonical);
        if (existing && existing !== entry && existing.live) {
          totalBytes -= entry.bytes;
          entry.bytes = 0;
          entry.live = false;
          cache.delete(entry.key);
          rememberAlias(url, identity, canonical);
          existing.deliveries += entry.deliveries;
          entry.deliveries = 0;
          entry.joined = existing;
          resolvedEntry = existing;
          return existing.ready;
        }
        if (canonical !== entry.key) {
          cache.delete(entry.key);
          entry.key = canonical;
          cache.set(canonical, entry);
        }
        rememberAlias(url, identity, canonical);
        totalBytes += blob.size - entry.bytes;
        entry.bytes = blob.size;
        entry.blob = blob;
        return blob;
      })
      .catch((error: unknown) => {
        if (entry.live) {
          drop(entry);
          if (definitive(error)) {
            if (failures.size >= maxEntries) failures.delete(failures.keys().next().value!);
            failures.set(key, error);
          }
        }
        throw error;
      })
      .finally(() => { pending--; drain(); });
    cache.set(key, entry);
    return entry.ready.then(() => resolvedEntry);
  };
  const canStart = (): boolean => {
    if (sizeAware) { evictTo(maxEntries - 1, Infinity); return pending < maxPending && cache.size < maxEntries; }
    const reservation = Math.min(ASSET_MAX_BYTES, maxBytes);
    evictTo(maxEntries - 1, maxBytes - reservation);
    return cache.size < maxEntries && totalBytes + reservation <= maxBytes;
  };
  function drain(): void {
    for (const wake of admissionWaiters.splice(0)) wake();
    if (draining) return;
    draining = true;
    try {
      for (const [key, request] of queued) {
        const canonical = aliasFor(request.url, request.identity) ?? request.key;
        const hit = cache.get(canonical);
        if (hit?.live) {
          queued.delete(key); touch(hit); settle(request, hit); continue;
        }
        if (!canStart()) break;
        queued.delete(key);
        queuedWaiters -= request.waiters.length;
        request.queued = false;
        void start(request.url, request.identity, canonical, request.waiters.length).then((entry) => { settle(request, entry, undefined, true); drain(); }, (error: unknown) => settle(request, null, error));
      }
    } finally { draining = false; }
  }
  const load = (url: string, identity: string): Promise<CacheEntry> => {
    const key = aliasFor(url, identity) ?? identity;
    const hit = cache.get(key);
    if (hit?.live) {
      touch(hit);
      hit.deliveries++;
      return hit.ready.then(() => {
        let entry = hit;
        while (entry.joined) entry = entry.joined;
        return entry;
      }, (error: unknown) => { releaseDelivery(hit); throw error; });
    }
    if (failures.has(key)) return Promise.reject(failures.get(key));
    const waiting = queued.get(key);
    if (waiting) return new Promise((resolve, reject) => {
      if (queuedWaiters >= maxEntries) { reject(new Error("asset request queue is full")); return; }
      queuedWaiters++;
      waiting.waiters.push({ resolve, reject });
    });
    if (queued.size >= maxEntries || queuedWaiters >= maxEntries) return Promise.reject(new Error("asset request queue is full"));
    return new Promise((resolve, reject) => {
      queuedWaiters++;
      queued.set(key, { url, identity, key, queued: true, waiters: [{ resolve, reject }] });
      drain();
    });
  };

  return {
    get(url, identity = `url:${url}`) {
      return this.lease(url, identity).then((lease) => { lease.release(); return lease.url; });
    },
    lease(url, identity = `url:${url}`) {
      return load(url, identity).then((entry): ArtLease => {
        try {
          if (!entry.live || !entry.blob) throw new Error("asset was cleared");
          if (!entry.objectUrl) entry.objectUrl = createUrl(entry.blob);
          entry.holds++;
          let released = false;
          return { url: entry.objectUrl, release: () => {
            if (released) return;
            released = true;
            entry.holds = Math.max(0, entry.holds - 1);
            drain();
          } };
        } finally { releaseDelivery(entry); }
      }, (error: unknown): ArtLease => {
        if (error instanceof DirectAssetError && !isBrowserStudio()) return { url: error.url, release: () => undefined };
        throw error;
      });
    },
    getBlob(url, identity = `url:${url}`) { return load(url, identity).then((entry) => {
      try { return entry.blob ?? Promise.reject(new Error("asset was cleared")); }
      finally { releaseDelivery(entry); }
    }); },
    prime(identity, blob) {
      if (cache.get(identity)?.live || blob.size < 1 || blob.size > Math.min(ASSET_MAX_BYTES, maxBytes)) return;
      evictTo(maxEntries - 1, maxBytes - blob.size);
      if (cache.size >= maxEntries || totalBytes + blob.size > maxBytes) return;
      cache.set(identity, { key: identity, ready: Promise.resolve(blob), bytes: blob.size, live: true, deliveries: 0, holds: 0, controller: new AbortController(), blob });
      totalBytes += blob.size;
    },
    clear() {
      for (const entry of [...cache.values()]) drop(entry);
      for (const request of queued.values()) settle(request, null, new Error("asset cache was cleared"));
      queued.clear();
      queuedWaiters = 0;
      aliases.clear(); aliasBytes = 0; totalBytes = 0; failures.clear();
      for (const listener of clearListeners) listener();
    },
    onClear(listener) { clearListeners.add(listener); return () => clearListeners.delete(listener); },
    onDrop(listener) { dropListeners.add(listener); return () => dropListeners.delete(listener); },
    bytes: () => totalBytes,
    trim: (targetBytes) => { evictTo(maxEntries, Math.max(0, targetBytes)); drain(); },
  };
}

export const artCache = createArtCache();

export function attachArtCacheLockListener(
  target: Pick<typeof window, "addEventListener" | "removeEventListener">,
  cache: ArtCache = artCache,
): () => void {
  const onLocked = (): void => cache.clear();
  target.addEventListener(LIBRARY_LOCKED_EVENT, onLocked);
  return () => target.removeEventListener(LIBRARY_LOCKED_EVENT, onLocked);
}

/** The sizes the asset route serves: the full bytes, or a small thumbnail (src/ui/server-assets.ts). */
export type AssetSize = "full" | "96" | "256" | "512";

export type AssetSource =
  | { sha: string; size?: AssetSize }
  | { url: string; identity?: string }
  | { portrait: { kind: string; id: string; version?: number; identity?: string; fallbackUrl?: string } };

export const isAssetImageRef = (value: string): boolean =>
  value.startsWith("http") || value.startsWith("data:image") || parseUploadedRef(value)?.mime.startsWith("image/") === true;

function sourceKey(source: AssetSource | null): string {
  if (!source) return "";
  if ("sha" in source) return `sha:${source.sha}:${source.size ?? "full"}`;
  if ("url" in source) return `url:${source.url}:${source.identity ?? ""}`;
  return `portrait:${source.portrait.kind}:${source.portrait.id}:${source.portrait.version ?? 0}:${source.portrait.identity ?? ""}:${source.portrait.fallbackUrl ?? ""}`;
}

async function portraitAssetUrl(source: Extract<AssetSource, { portrait: unknown }>, signal: AbortSignal): Promise<{ url: string; identity: string; direct?: boolean }> {
  if (isBrowserStudio() && source.portrait.fallbackUrl) return { url: source.portrait.fallbackUrl, identity: `url:${source.portrait.fallbackUrl}:${source.portrait.identity ?? ""}` };
  const query = new URLSearchParams({ kind: source.portrait.kind, id: source.portrait.id });
  const response = await apiFetch(`/api/studio/portrait-ref?${query}`, { requireToken: false, signal });
  if (!response.ok) throw new Error(`portrait reference failed (${String(response.status)})`);
  const result = await response.json() as { asset?: { sha?: string; url?: string; bytes?: number }; version?: number; writeId?: number; revision?: string } | null;
  if (!result?.asset) throw new Error("portrait reference is unavailable");
  if (isSha256Hex(result.asset.sha)) {
    const sha = result.asset.sha;
    return { url: `/api/asset/${sha}?size=full`, identity: `sha:${sha}:full` };
  }
  if (result.asset.url?.startsWith("/api/studio/portrait?")) {
    const direct = Number.isSafeInteger(result.asset.bytes) && result.asset.bytes! > ASSET_MAX_BYTES;
    if (direct && isBrowserStudio()) throw new Error("portrait exceeds the bounded browser asset cache");
    const identity = source.portrait.identity ?? `${result.writeId ?? 0}:${result.revision ?? ""}`;
    return { url: `${result.asset.url}&v=${result.version ?? source.portrait.version ?? 0}`, identity: `url:${result.asset.url}:${identity}`, direct };
  }
  throw new Error("portrait reference is invalid");
}

/** Shares the same visibility-cache bytes with callers that compute local color without another fetch. */
export async function getPortraitBlob(kind: string, id: string, version?: number, fallbackUrl?: string | null, identity?: string): Promise<Blob> {
  const controller = new AbortController();
  const asset = await portraitAssetUrl({ portrait: { kind, id, version, fallbackUrl: fallbackUrl ?? undefined, identity } }, controller.signal);
  if (asset.direct) throw new Error("portrait is too large for the shared byte cache");
  return artCache.getBlob(asset.url, asset.identity);
}

/** Starts metadata and byte requests only once the observed element is within one viewport. */
export function useAsset(source: AssetSource | null): { ref: RefCallback<Element>; src: string | undefined; failed: boolean } {
  const [element, setElement] = useState<Element | null>(null);
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [clearEpoch, setClearEpoch] = useState(0);
  const key = sourceKey(source);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    setSrc(undefined); setFailed(false);
    const currentSource = sourceRef.current;
    if (!currentSource || !element) return;
    let live = true;
    let request: AbortController | undefined;
    let lease: ArtLease | undefined;
    // The lease lasts while this effect shows the URL; an effect already torn down releases it at once.
    const hold = (next: ArtLease): string => {
      if (!live) next.release(); else lease = next;
      return next.url;
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      request = new AbortController();
      const load = async (): Promise<string> => {
        if ("portrait" in currentSource) {
          const asset = await portraitAssetUrl(currentSource, request!.signal);
          if (asset.direct) return asset.url;
          return hold(await artCache.lease(asset.url, asset.identity));
        }
        if ("sha" in currentSource) return hold(await artCache.lease(`/api/asset/${currentSource.sha}?size=${currentSource.size ?? "full"}`, `sha:${currentSource.sha}:${currentSource.size ?? "full"}`));
        if (currentSource.url.startsWith("data:") || currentSource.url.startsWith("blob:") || /^https?:\/\//.test(currentSource.url)) return currentSource.url;
        return hold(await artCache.lease(currentSource.url, `url:${currentSource.url}:${currentSource.identity ?? ""}`));
      };
      void load().then((objectUrl) => { if (live) setSrc(objectUrl); }, () => { if (live) setFailed(true); });
    }, { rootMargin: "100% 100%" });
    observer.observe(element);
    return () => { live = false; request?.abort(); observer.disconnect(); lease?.release(); };
    // `key` captures all fields of this discriminated source and avoids object identity churn.
  }, [key, element, clearEpoch]);

  useEffect(() => artCache.onClear(() => { setSrc(undefined); setFailed(false); setClearEpoch((epoch) => epoch + 1); }), []);

  return { ref: setElement, src, failed };
}

export function useArtSrc(url: string | null, identity?: string, size?: AssetSize): { ref: RefCallback<Element>; src: string | undefined; failed: boolean } {
  const uploaded = url ? parseUploadedRef(url) : undefined;
  return useAsset(uploaded ? { sha: uploaded.sha, ...(size ? { size } : {}) } : url ? { url, identity } : null);
}

export function usePortraitAsset(kind: string, id: string, version?: number, fallbackUrl?: string | null, identity?: string): ReturnType<typeof useAsset> {
  return useAsset(fallbackUrl ? { portrait: { kind, id, version, fallbackUrl, identity } } : null);
}

/** Subscribes art identity to the accepted receipt so coalesced saves refence cached bytes. */
export function usePieceArtIdentity(pieces: PieceStore | undefined, kind: string, id: string, writeId = 0, revision = ""): string {
  const subscribe = useCallback((notify: () => void) => pieces?.subscribe(kind, id, notify) ?? (() => undefined), [pieces, kind, id]);
  const current = useCallback(() => {
    const receipt = pieces?.snapshot(kind, id);
    return `${receipt?.writeId ?? writeId}:${receipt?.revision ?? revision}:${pieces?.getGeneration() ?? 0}`;
  }, [pieces, kind, id, writeId, revision]);
  return useSyncExternalStore(subscribe, current, () => `${writeId}:${revision}:0`);
}
