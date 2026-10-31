/**
 * Browser-only Studio runtime for static hosting. All mutable state lives in Maps owned by this
 * page load; reload or close the tab and the studio disappears.
 */
import { toErrorMessage } from "../error-message";
import { readStreamCapped } from "../core/stream-bytes";
import * as registry from "../core/registry";
import { EXTENSION_PLATFORMS } from "../formats/_shared/extension-platforms";
import { registerPackagedFormats } from "../generated/packaged-formats";
import { StudioStore } from "../studio/store";
import { createContentStore } from "../stage/store/content-store";
import { memoryChatStore } from "../stage/store/chat-store";
import { createPieceChangeReplay } from "../stage/store/piece-change-replay";
import { memoryDocumentBackend } from "../stage/store/memory/document-backend";
import { memoryStateStore } from "../stage/store/memory/state-store";
import { SettingsStore } from "../studio/settings";
import { CollectionsStore } from "../studio/collections";
import { applyCollectionEdit } from "../studio/collections-shape";
import { saveBundle } from "../studio/bundle";
import { mimeFromBytes, validAssetGrantRefs, assetCapFor, ASSET_UPLOAD_TTL, ASSET_ADOPT_COUNT } from "../ui/_shared/asset-content";
import { ASSET_BATCH_BYTES, ASSET_BATCH_COUNT, ASSET_MAX_BYTES, JSON_BODY_MAX_BYTES } from "../core/media/limits";
import { MIME_BY_EXT } from "../core/media/mime";
import { mediaBlobReference } from "../entities/piece-parts-blob";
import type { PartBlob } from "../stage/contracts/content-store";
import { APP_VERSION } from "../version";
import { EngineActionError, exportCanonical, formatMeta, inspectBytes } from "../ui/engine-actions";
import { parseCollectionEdit } from "../ui/collection-edit";
import type { DocsIndex, DocFigure } from "../ui/docs-types";
import { disableVolatileWebStorage, enableVolatileWebStorage } from "../ui/_shared/web-storage";
import { announceBrowserStudioChange, announceBrowserStudioResync } from "../browser-mode";
import { parseStudioPatchRequest } from "../ui/_shared/studio-patch-request";
import { handleStudioRead } from "../ui/_shared/studio-read-route";
import { LIBRARY_LOCKED_EVENT } from "../ui/_shared/api-fetch";
import { parseSearchRequest } from "../core/search/contracts";
import { createSearchService } from "../stage/search/search-service";
import { SearchWorkerClient } from "../stage/search/search-worker-client";
import { applyMembershipDiff, collectionMemberships } from "../ui/library-search";
import { handlePocketAsset } from "./asset-routes";
import { listScenes, openScene } from "../studio/scenes";
import { handleThemeReadRoutes } from "../extensions/theme-read-routes";
import type { ThemePackageInput } from "../extensions/theme-contract";
import { createPocketExtensionOwner } from "./extension-owner";
import { memoryExtensionStore } from "../stage/store/memory/extension-store";
import { handleExtensionRoutes } from "../ui/server-extension-runtime";

interface PocketData {
  manifests: unknown[];
  setupSteps: string[];
  docsIndex: DocsIndex;
  docFigures: DocFigure[];
  themePackages?: Record<string, ThemePackageInput>;
  exampleThemePackages?: Record<string, ThemePackageInput>;
  browserSandbox?: { workerSource: string; wasmBase64: string; regexWorkerSource?: string };
}

declare global {
  var __BUNZAI_POCKET_DATA__: PocketData | undefined;
  var __BUNZAI_POCKET_PORTRAIT__: ((kind: string, id: string) => string | null) | undefined;
}

const STUDIO_DIR = "/bunzai-tab";
const unavailable = "This control needs the installed Bunzai app and is unavailable in the temporary browser studio.";
const json = (value: unknown, status = 200): Response => Response.json(value, {
  status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const error = (message: string, status = 400): Response => json({ error: message }, status);
async function readBytes(request: Request, maxBytes: number, signal?: AbortSignal, admit?: (bytes: number) => void): Promise<Uint8Array> {
  const read = await readStreamCapped(request.body, maxBytes, { signal: signal ? AbortSignal.any([request.signal, signal]) : request.signal, onProgress: admit });
  if (read.ok) return read.bytes;
  if (read.reason === "too-large") throw new EngineActionError("payload too large", 413);
  if (read.reason === "aborted") throw new EngineActionError("request cancelled", 499);
  throw read.error;
}
async function readJson(request: Request, maxBytes = JSON_BODY_MAX_BYTES): Promise<unknown> {
  const bytes = await readBytes(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new EngineActionError("invalid JSON");
  }
}
const contentTypeIs = (request: Request, expected: string): boolean =>
  (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase() === expected;
function formatCoverage(): unknown[] {
  const adapters = registry.all()
    .filter((adapter) => adapter.kind === "character" && adapter.coverage && !adapter.native)
    .map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      carries: adapter.coverage!.carries,
      notes: adapter.coverage!.notes,
      lens: adapter.lens !== false,
    }));
  const ids = new Set(adapters.map((adapter) => adapter.id));
  return [
    ...adapters,
    ...EXTENSION_PLATFORMS.filter((platform) => !ids.has(platform.id)).map((platform) => ({
      id: platform.id,
      label: platform.label,
      carries: platform.carries,
      notes: platform.notes,
      lens: true,
    })),
  ];
}

export function installPocketRuntime(): () => void {
  registerPackagedFormats();
  enableVolatileWebStorage();

  // The temporary browser Studio keeps its pieces and its own documents in memory stores, the same
  // stores the app uses over SQLite, so it behaves exactly as the library does and forgets everything
  // on reload.
  const extensionStore = memoryExtensionStore();
  const backend = memoryDocumentBackend({ authorizeExtensionCommit: (context) => extensionStore.assertCommitContext(context) });
  const content = createContentStore(backend);
  const chats = memoryChatStore(Date.now, undefined, { authorizeExtensionCommit: (context) => extensionStore.assertCommitContext(context) });
  const state = memoryStateStore({ authorizeExtensionCommit: (context) => extensionStore.assertCommitContext(context) });
  const store = new StudioStore(STUDIO_DIR, () => content);
  const settings = new SettingsStore(STUDIO_DIR, () => state);
  const collections = new CollectionsStore(STUDIO_DIR, () => state);
  let memberships = new Map<string, string[]>();
  const search = createSearchService({
    store,
    readCollections: () => collections.read(),
    sourceLabels: async () => new Map(registry.all().map((adapter) => [adapter.id, adapter.label])),
    createWorker: () => new SearchWorkerClient(() => new Worker(new URL("./search-worker.js", document.baseURI), { type: "module" })),
  });
  let closed = false;
  const refreshMemberships = async (): Promise<void> => {
    if (closed) return;
    const next = collectionMemberships(await collections.read());
    if (closed) return;
    try { await applyMembershipDiff(search, memberships, next); memberships = next; }
    catch { if (!closed) search.invalidate(); memberships = next; }
  };
  const replay = createPieceChangeReplay(backend, async (event) => {
    if (closed) return;
    try {
      if (event.action === "delete") await search.remove(event.kind, event.id);
      else {
        const summary = await store.summary(event.kind, event.id);
        if (closed) return;
        if (!summary) await search.remove(event.kind, event.id);
        else if ((summary.writeId ?? 0) < event.writeId) throw new Error("search summary predates its committed receipt");
        else if (summary.writeId === event.writeId) {
          if (summary.revision !== event.revision) throw new Error("search summary does not match its committed receipt");
          await search.upsert(summary);
        }
      }
    } catch { if (!closed) search.invalidate(); }
    if (!closed) announceBrowserStudioChange([event]);
  }, (latest) => {
    if (!closed) { search.invalidate(); announceBrowserStudioResync(latest); }
  });
  const beforeMutation = async (): Promise<Response | null> => {
    if (closed) return error("browser studio is closed", 423);
    try { await replay.replay(); return closed ? error("browser studio is closed", 423) : null; }
    catch { return error("committed changes are unavailable", 503); }
  };
  const afterMutation = async (): Promise<void> => {
    if (closed) return;
    try { await replay.replay(); } catch { if (!closed) search.invalidate(); }
  };
  const originalFetch = globalThis.fetch.bind(globalThis);
  const lifetime = new AbortController();
  const staged = new Map<string, { bytes: Uint8Array; sha: string; charge: number; expires: number }>();
  let reserved = 0;
  let activeUploads = 0;
  let uploadExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleUploadExpiry = (): void => {
    if (uploadExpiryTimer) clearTimeout(uploadExpiryTimer);
    uploadExpiryTimer = null;
    if (closed || staged.size === 0) return;
    const earliest = Math.min(...[...staged.values()].map((item) => item.expires));
    uploadExpiryTimer = setTimeout(() => { uploadExpiryTimer = null; pruneUploads(); }, Math.max(0, earliest - Date.now()));
  };
  const removeUpload = (ref: string): void => {
    const item = staged.get(ref);
    if (!item) return;
    item.bytes.fill(0);
    reserved -= item.charge;
    staged.delete(ref);
    scheduleUploadExpiry();
  };
  const pruneUploads = (): void => {
    for (const [ref, item] of staged) if (item.expires <= Date.now()) removeUpload(ref);
    scheduleUploadExpiry();
  };
  const data = globalThis.__BUNZAI_POCKET_DATA__;
  if (!data) throw new Error("browser studio data is missing");
  const extensionOwner = createPocketExtensionOwner({ content, chats, state, store: extensionStore, themes: Object.values(data.themePackages ?? {}), ...(data.browserSandbox ? { browserSandbox: data.browserSandbox } : {}) })
    .catch((reason: unknown) => { console.error("Browser extension runtime failed to start", reason instanceof Error ? reason.name : "unknown failure"); return null; });
  const route = async (request: Request): Promise<Response> => {
      if (closed) return error("browser studio is closed", 423);
      const url = new URL(request.url);
      const path = url.pathname;
      try {
      if (path.startsWith("/api/extensions/")) return (await handleExtensionRoutes(request, url, await extensionOwner)) ?? error("not found");
        if (path === "/api/chats/list" && request.method === "GET") return json(await listScenes(chats, store));
      if (path === "/api/chats/open" && request.method === "GET") {
        const opened = await openScene(chats, store, url.searchParams.get("id") ?? "");
        return opened ? json(opened) : error("that scene is gone", 404);
      }
      if (path.startsWith("/api/themes/")) {
        const owner = await extensionOwner;
        if (!owner) return error("unified theme runtime is unavailable", 503);
        const themeResponse = await handleThemeReadRoutes(request, url, {
          effective: owner.themeEffective, asset: owner.themeAsset, revisionStamp: owner.themeRevision,
          markBroken: owner.themeMarkBroken, confirmHealthy: owner.themeConfirmHealthy,
        }, settings, { json, error });
        return themeResponse ?? error("theme route not found", 404);
      }
      const assetResponse = await handlePocketAsset(request, url, store, chats, () => !closed);
      if (assetResponse) return assetResponse;
      if (path === "/api/asset/discard" && request.method === "POST") {
        const value = await readJson(request, 4096) as { refs?: unknown } | null;
        if (!value || !validAssetGrantRefs(value.refs)) return error("invalid upload grants");
        for (const ref of value.refs) removeUpload(ref);
        return json({ discarded: true });
      }
      if (path === "/api/asset/adopt" && request.method === "POST") {
        // Pictures the tab's library already holds: grants over them, the bytes copied in memory, never uploaded.
        const value = await readJson(request, 256 * 1024) as { assets?: unknown } | null;
        const assets = value?.assets;
        if (!Array.isArray(assets) || assets.length === 0 || assets.length > ASSET_ADOPT_COUNT || assets.some((item) => typeof item !== "string")) return error("expected a bounded list of picture references");
        pruneUploads();
        const grants: { ref: string; asset: string; sha: string; mime: string; bytes: number }[] = [];
        for (const asset of new Set(assets as string[])) {
          const picture = mediaBlobReference(asset);
          if (!picture?.mime) return error("a picture reference is not a supported picture");
          const read = await store.readAsset(picture.sha, ASSET_MAX_BYTES);
          if (read.status !== "ok") return error("a picture is not in the library", 404);
          const charge = read.bytes.byteLength * 4;
          if (reserved + charge > ASSET_BATCH_BYTES * 4) return error("these pictures are too heavy to copy at once", 413);
          const ref = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
          reserved += charge;
          staged.set(ref, { bytes: read.bytes.slice(), sha: picture.sha, charge, expires: Date.now() + ASSET_UPLOAD_TTL });
          grants.push({ ref, asset, sha: picture.sha, mime: picture.mime, bytes: read.bytes.byteLength });
        }
        scheduleUploadExpiry();
        return json({ grants });
      }
      if (path === "/api/asset/upload" && request.method === "POST") {
        if (!contentTypeIs(request, "application/octet-stream")) return error("unsupported media type", 415);
        let filename: string;
        try { filename = decodeURIComponent(request.headers.get("x-filename") ?? ""); } catch { return error("invalid filename"); }
        const ext = filename.split(".").at(-1)?.toLowerCase() ?? "";
        if (filename.length > 1024 || !Object.hasOwn(MIME_BY_EXT, ext)) return error("unsupported asset type", 415);
        const length = request.headers.get("content-length");
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > assetCapFor(ext))) return error("payload too large", 413);
        pruneUploads();
        let charge = (length === null ? 0 : Number(length)) * 4;
        if (staged.size + activeUploads >= ASSET_BATCH_COUNT || reserved + charge > ASSET_BATCH_BYTES) return error("staged upload budget exceeded", 413);
        reserved += charge; activeUploads++;
        let bytes: Uint8Array | undefined;
        let retained = false;
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        lifetime.signal.addEventListener("abort", abort, { once: true });
        const deadline = setTimeout(abort, 30_000);
        try {
          bytes = await readBytes(request, length === null ? assetCapFor(ext) : Number(length), controller.signal, (count) => {
            const required = count * 4;
            if (required <= charge) return;
            if (reserved + required - charge > ASSET_BATCH_BYTES) throw new EngineActionError("staged upload budget exceeded", 413);
            reserved += required - charge;
            charge = required;
          });
          if (!bytes.byteLength || ((ext === "svg" && bytes.byteLength > 4 * 1024 * 1024) || (ext === "css" && bytes.byteLength > 2 * 1024 * 1024))) return error("invalid asset size", 413);
          let text = "";
          try { if (ext === "svg" || ext === "css") text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
          catch { return error("text asset must be valid UTF-8", 415); }
          const mime = mimeFromBytes(bytes, ext, text);
          if (!mime) return error("asset contents do not match its type", 415);
          const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
          if (closed || controller.signal.aborted || request.signal.aborted) return error("upload cancelled", 499);
          const hex = (value: Uint8Array): string => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
          const sha = hex(new Uint8Array(digest));
          const ref = hex(crypto.getRandomValues(new Uint8Array(24)));
          const retainedCharge = bytes.byteLength * 4;
          reserved -= charge - retainedCharge;
          staged.set(ref, { bytes, sha, charge: retainedCharge, expires: Date.now() + ASSET_UPLOAD_TTL });
          scheduleUploadExpiry();
          retained = true;
          return json({ sha, mime, bytes: bytes.byteLength, ref, asset: `\u0000b:u:${mime}:${sha}` });
        } finally {
          clearTimeout(deadline);
          lifetime.signal.removeEventListener("abort", abort);
          activeUploads--;
          if (!retained) { reserved -= charge; bytes?.fill(0); }
        }
      }
      if (path === "/api/apps") return json(data.manifests);
      if (path === "/api/setup/steps") return json(data.setupSteps);
      if (path === "/api/docs/index") return json(data.docsIndex);
      if (path === "/api/docs/figures") return json(data.docFigures);
      if (path === "/api/docs/get") {
        const record = data.docsIndex.docs.find((doc) => doc.id === url.searchParams.get("id"));
        return record ? originalFetch(new URL(record.path, document.baseURI)) : error("doc not found", 404);
      }
      if (path === "/api/settings") {
        if (request.method === "POST") return json(await settings.save(await readJson(request)));
        if (request.method === "PATCH") return json(await settings.update(await readJson(request)));
        return json(await settings.read());
      }
      // The tab's library lives in memory with no password, so it is always open: the gate goes straight in.
      if (path === "/api/library/status") return json({ phase: "unlocked" });
      if (path === "/api/version") return json({ version: APP_VERSION, mode: "browser" });
      if (path === "/api/formats") return json(registry.all().map(formatMeta));
      if (path === "/api/coverage") return json(formatCoverage());
      if (path === "/api/studio/list") return json(await store.list(url.searchParams.get("kind") ?? undefined));
      if (path === "/api/search" && request.method === "POST") {
        const parsed = parseSearchRequest(await readJson(request, 64 * 1024));
        if (!parsed) return error("invalid search request");
        try {
          await replay.replay();
          if (closed) return error("browser studio is closed", 423);
          const results = await search.search(parsed, request.signal);
          return closed ? error("browser studio is closed", 423) : json(results);
        }
        catch { return error("search is unavailable", 503); }
      }
      if (path === "/api/studio/inventory") {
        const inventory = await store.inventory(url.searchParams.get("kind") ?? undefined);
        return json(inventory);
      }
      if (path === "/api/studio/get" || path === "/api/studio/summary" || path === "/api/studio/original" || path === "/api/studio/risu-assets" || path === "/api/studio/export-pack" || path === "/api/studio/export-compendium") {
        const response = await handleStudioRead(path, url, store, json, (reason) => error(toErrorMessage(reason, "browser studio read failed"), 422));
        if (response) return response;
      }
      if (path === "/api/studio/patch" && request.method === "POST") {
        const parsed = parseStudioPatchRequest(await readJson(request));
        if (!parsed.ok) return error(parsed.error);
        const unavailable = await beforeMutation();
        if (unavailable) return unavailable;
        const { kind, id, expectedRevision, patch, uploads, intent } = parsed.value;
        pruneUploads();
        const blobs: PartBlob[] = uploads.map((ref) => {
          const entry = staged.get(ref);
          if (!entry) throw new EngineActionError("upload grant is missing or expired", 422);
          return { key: entry.sha, payload: { kind: "bytes", bytes: entry.bytes.slice() } };
        });
        const result = await store.comparePatch(kind, id, expectedRevision, patch, blobs, intent);
        if (result.status !== "saved") return result.status === "stale"
          ? error("piece changed since it was opened", 409) : error("piece no longer exists", 404);
        await afterMutation();
        for (const ref of uploads) removeUpload(ref);
        return json({ summary: result.summary, revision: result.revision });
      }
      if (path === "/api/studio/save" && request.method === "POST") {
        const raw = await readJson(request) as Record<string, unknown>;
        const wrapped = raw && typeof raw === "object" && raw.entity && typeof raw.entity === "object";
        const entity = wrapped ? raw.entity : raw;
        const unavailable = await beforeMutation();
        if (unavailable) return unavailable;
        if (wrapped && typeof raw.expectedRevision === "string") {
          const result = await store.compareAndSave(entity, raw.expectedRevision);
          if (result.status !== "saved") {
            return result.status === "stale"
              ? error("piece changed since it was opened", 409)
              : error("piece no longer exists", 404);
          }
          await afterMutation();
          return json({ summary: result.summary, revision: result.revision });
        }
        const summary = await store.save(entity, { overwrite: Boolean(wrapped && raw.overwrite === true) });
        await afterMutation();
        return json(summary);
      }
      if (path === "/api/studio/delete" && request.method === "POST") {
        const raw = await readJson(request) as { kind?: unknown; id?: unknown };
        if (typeof raw.kind !== "string" || typeof raw.id !== "string") return error("expected { kind, id }");
        const unavailable = await beforeMutation();
        if (unavailable) return unavailable;
        const receipt = await store.deleteWithReceipt(raw.kind, raw.id);
        if (receipt) await afterMutation();
        return json({ deleted: Boolean(receipt), receipt });
      }
      if (path === "/api/studio/duplicate" && request.method === "POST") {
        const raw = await readJson(request) as { kind?: unknown; id?: unknown };
        if (typeof raw.kind !== "string" || typeof raw.id !== "string") return error("expected { kind, id }");
        const unavailable = await beforeMutation();
        if (unavailable) return unavailable;
        const copy = await store.duplicate(raw.kind, raw.id);
        if (!copy) return error("piece no longer exists", 404);
        await afterMutation();
        return json(copy);
      }
      if (path === "/api/studio/trash") return json(await store.graveyard());
      if (path === "/api/studio/restore" && request.method === "POST") {
        const raw = await readJson(request) as { graveId?: unknown };
        if (typeof raw.graveId !== "string") return error("expected { graveId }");
        const unavailable = await beforeMutation();
        if (unavailable) return unavailable;
        const back = await store.restore(raw.graveId);
        if (!back) return error("that piece is no longer in the Trash", 404);
        await afterMutation();
        return json(back);
      }
      if (path === "/api/studio/save-bundle" && request.method === "POST") {
        const raw = await readJson(request) as {
          entity?: unknown;
          related?: unknown[];
          overwrite?: boolean;
        };
        if (!raw.entity || typeof raw.entity !== "object") return error("expected { entity, related? }");
        const unavailable = await beforeMutation();
        if (unavailable) return unavailable;
        const result = await saveBundle(store, {
          entity: raw.entity as never,
          ...(raw.related ? { related: raw.related } : {}),
          overwrite: raw.overwrite === true,
        });
        if (result.related.length || result.primary) await afterMutation();
        return json(result, result.ok ? 200 : result.partial ? 207 : 422);
      }
      if (path === "/api/inspect" && request.method === "POST") {
        if (!contentTypeIs(request, "application/octet-stream")) return error("unsupported media type", 415);
        const filename = decodeURIComponent(request.headers.get("x-filename") ?? "upload");
        return json(inspectBytes(await readBytes(request, JSON_BODY_MAX_BYTES, lifetime.signal), filename));
      }
      if (path === "/api/export" && request.method === "POST") return json(await exportCanonical(store, await readJson(request)));
      if (path === "/api/collections") {
        if (request.method === "GET" || request.method === "HEAD") return json(await collections.read());
        const parsed = parseCollectionEdit(await readJson(request));
        if (!parsed.ok) return error(parsed.why);
        const saved = await collections.edit((current) => applyCollectionEdit(current, parsed.edit));
        await refreshMemberships();
        return json(saved);
      }
      if (path === "/api/open" && request.method === "POST") {
        const raw = await readJson(request) as { url?: unknown };
        if (typeof raw.url !== "string" || !/^https?:\/\//i.test(raw.url)) return error("refused link");
        window.open(raw.url, "_blank", "noopener,noreferrer");
        return new Response(null, { status: 204 });
      }
      if (path === "/api/macro-lab/engines") return json({ engines: [] });
      if (path.startsWith("/api/")) return error(unavailable, 501);
      return originalFetch(request);
    } catch (reason) {
      if (reason instanceof EngineActionError) return error(reason.message, reason.status);
      return error(toErrorMessage(reason, "browser studio request failed"), 422);
    }
  };

  const pocketFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const resolved = typeof input === "string" ? new URL(input, document.baseURI) : input;
    const request = resolved instanceof Request && init === undefined ? resolved : new Request(resolved, init);
    return new URL(request.url).pathname.startsWith("/api/") ? route(request).then((response) => closed ? error("browser studio is closed", 423) : response) : originalFetch(request);
  };
  globalThis.fetch = pocketFetch as typeof fetch;
  return () => {
    if (closed) return;
    closed = true;
    if (uploadExpiryTimer) clearTimeout(uploadExpiryTimer);
    uploadExpiryTimer = null;
    lifetime.abort();
    void extensionOwner.then((owner) => owner?.close()).catch(() => undefined);
    replay.close();
    search.dispose();
    for (const ref of staged.keys()) removeUpload(ref);
    window.dispatchEvent(new window.Event(LIBRARY_LOCKED_EVENT));
    globalThis.fetch = originalFetch;
    disableVolatileWebStorage();
    delete globalThis.__BUNZAI_POCKET_PORTRAIT__;
  };
}
