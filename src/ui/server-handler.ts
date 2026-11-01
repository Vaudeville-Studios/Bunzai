/**
 * Local HTTP shell over the CLI engine: app discovery, plumbing and the studio store.
 * Loopback only; state lives in the user's studio folder. Format logic stays in adapters.
 *
 * Security posture: per-launch session token + Host/Origin checks; capped request bodies; uploads
 * parse through the same fail-closed adapters as the CLI (zip-bomb caps included); scripts in
 * entities are data; nothing is ever evaluated server-side; app bundles are built from the local
 * src tree only.
 *
 * Security helpers: server-security.ts. Discover/bundle/dev-watch: server-static.ts.
 */
import { fileURLToPath } from "node:url";
import { toErrorMessage } from "../error-message";
import { registry } from "../core";
import { saveBundle } from "../studio/bundle";
import { isImportedScene } from "../core/scene-import";
import { saveSceneCarrier } from "./server-scene-save";
import type { CanonicalEntity } from "../core/canonical";
import { openStudio } from "../foreign-reader";
import { handleAgentRoutes } from "./agent/routes";
import { handleCollectionsRoutes } from "./server-collections";
import { handleMacroLabRoutes } from "./server-macro-lab";
import { handleMcpRoutes } from "./server-mcp";
import { CALLBACK_PATH, handleSpotifyCallback, handleSpotifyRoutes } from "./spotify/routes";
import type { StudioStoreLike, SettingsStoreLike } from "../studio/contracts";
import { SettingsStore } from "../studio/settings";
import { handleOpenRoute } from "./server-open";
import { handleExportFolderRoute } from "./server-export-folder";
import { EXTENSION_PLATFORMS } from "../formats/_shared/extension-platforms";
import { LVBAK_ARCHIVE_BOUNDS } from "../formats/lumiverse-archive";
import type { PackagedAssets } from "./assets";
import { handleDocsRequest } from "./server-docs";
import { handleDropInRoutes } from "./server-dropins";
import { createThemeRouteOwner } from "./server-theme-extensions";
import type { ThemeReadService } from "./server-theme-extensions";
import { handleExtensionRoutes } from "./server-extension-runtime";
import { createExtensionRouteOwner } from "./server-extension-owner";
import type { ExtensionManagerApi } from "../extensions/runtime/service";
import { libraryReadCapability, type LibraryReadCapability } from "./server-library-read-capability";
import { startSandboxHost } from "./sandbox-host";
import type { SidecarManager } from "./remote/sidecar-manager";
import type { LanManager } from "./remote/lan-manager";
import { admit, handleLibraryRoutes, libraryFrontDoor } from "./server-library";
import type { LibraryHandle } from "./library-root";
import {
  handleRemoteRoutes,
  isHostOnlyRoute,
  isLoopbackOnlyRoute,
  setupRemoteAccess,
  type MakeHandler,
} from "./server-remote";
import { APP_VERSION } from "../version";
import { handleUpdateCheck } from "./server-update";
import { makeSwitchManager } from "./switch/setup";
import type { SwitchManager } from "./switch/manager";
import { handleUpdatesRoutes } from "./switch/routes";
import { STUDIO_WRITES } from "./server-studio-write";
import { handleChatRoute } from "./server-chats";
import { createExtensionPromptPreviewer, createPromptScenesReader } from "./server-chats-forecast";
import { handleAssetRoute, handleFrozenPortraitRoute, handleLegacyPortraitRoute, handlePortraitReferenceRoute, withLibraryReadLease } from "./server-assets";
import { handleSearch } from "./server-search";
import { handleStudioRead } from "./server-studio-read";
import { handleRestart, handleShutdown, realSpawnSelf, type LifecycleDeps } from "./server-lifecycle";
import {
  type UiSecurityContext,
  createSecurityContext,
  json,
  err,
  htmlSecurityHeaders,
  inlineScriptHashes,
  injectSessionMeta,
  injectSandboxOriginMeta,
  readBodyCapped,
  readJsonObject,
  checkApiRequest,
  checkRemoteApiRequest,
  checkLanApiRequest,
  studioErr,
} from "./server-security";
import { startDevWatch, createDevReloadResponse, handleAssetRoutes } from "./server-static";
import { formatMeta, handleInspect, handleInspectArchive, handleExport } from "./server-engine";
import { clearAllStagings } from "./server-staging";
import { stageAssetUpload, discardAssetUploads, adoptLibraryAssets, clearStagedAssets } from "./server-asset-staging";
import { stageAssetFromUrl } from "./server-asset-fetch";

// Re-export security surface for tests and sandbox-host.
export {
  INSPECT_BODY_MAX,
  type UiSecurityContext,
  createSecurityContext,
  htmlSecurityHeaders,
  inlineScriptHashes,
  injectSessionMeta,
  injectSandboxOriginMeta,
  readBodyCapped,
  checkApiRequest,
} from "./server-security";

type AnyEntity = CanonicalEntity<string, unknown>;
export interface UiHandler {
  (req: Request): Promise<Response>;
  close(): Promise<void>;
}
// -- the route table --------------------------------------------------------------------------------

export function createHandler(
  store: StudioStoreLike,
  settings: SettingsStoreLike,
  packaged?: PackagedAssets,
  sec?: UiSecurityContext,
  /**
   * Live sandbox origin for HTML meta injection (ADR-009). Mutable so startUi can fill it after
   * both listeners bind. String form also accepted for tests.
   */
  sandboxOrigin?: string | { current: string },
  /** filled by startUi after the listener binds; quit/restart need the real stop */
  lifecycle?: LifecycleDeps,
  /** remote-access sidecar manager; absent in tests and when the binary is missing */
  remote?: SidecarManager,
  /** when set, this handler serves the UNTRUSTED remote listener: the /api gate requires this shared
   *  secret (stamped by the sidecar) instead of the loopback Host/Origin check. */
  remoteSecret?: string,
  /** when true, this handler serves an already-approved LAN session (the connect code + host approval
   *  gated it upstream); /api uses the CSRF token only, no Host/Origin or secret. */
  lanApproved?: boolean,
  /** the LAN manager, present only on the trusted handler (LAN management is host-only). */
  lan?: LanManager,
  /** the version-switch manager, present only on the trusted handler (switching is host-only). */
  switchManager?: SwitchManager,
  /** the encrypted library's controls, present only on the trusted handler (server-library.ts). */
  library?: LibraryHandle,
  /** Narrow asset/search reads shared with authenticated remote and approved LAN handlers. */
  readCapability?: LibraryReadCapability,
  /** One fenced extension runtime, present only on the trusted local handler. */
  extensionService?: ExtensionManagerApi,
  sharedExtensionOwner?: ReturnType<typeof createExtensionRouteOwner>,
): UiHandler {
  const security = sec ?? createSecurityContext();
  const themeRoute = createThemeRouteOwner(packaged, settings);

  const resolveSandboxOrigin = (): string => {
    if (!sandboxOrigin) return "";
    if (typeof sandboxOrigin === "string") return sandboxOrigin;
    return sandboxOrigin.current;
  };
  const extensionOwner = sharedExtensionOwner ?? createExtensionRouteOwner(library, resolveSandboxOrigin, packaged,
    createExtensionPromptPreviewer(store, settings, library), createPromptScenesReader(library));
  const reads = readCapability ?? libraryReadCapability(library, packaged, extensionOwner);

  const htmlResponse = (rawHtml: string): Response => {
    let html = injectSessionMeta(rawHtml, security.token);
    if (!packaged) html = html.replace("</head>", '<meta name="vaude-dev" content="1">\n</head>');
    const sb = resolveSandboxOrigin();
    if (sb) html = injectSandboxOriginMeta(html, sb);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // hashes computed from the html actually served, so an import-map edit can never rot the CSP
        ...htmlSecurityHeaders(sb, inlineScriptHashes(html)),
      },
    });
  };

  // A remote handler is the untrusted Tailscale listener (remoteSecret) or an approved LAN session.
  const isRemote = remoteSecret != null || lanApproved === true;

  const route = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;

    // Trusted loopback listener must never accept sidecar-proxied (remote) traffic; refuse the secret
    // header on ANY path, before routing (not just /api).
    if (!isRemote && req.headers.get("x-bunzai-sidecar-secret")) return err("refused", 403);

    // Untrusted remote listener: NOTHING is served without the sidecar secret (only the sidecar, which
    // has already gated the caller down to the studio owner, carries it). This replaces the loopback
    // Host check and stops a DNS-rebinding page from pulling the token-bearing HTML. Every path, first.
    if (remoteSecret) {
      const denied = checkRemoteApiRequest(req, security, remoteSecret);
      if (denied) return denied;
    }

    // HOST-ONLY surface: a tailed-in or LAN-served device may USE the studio, but must never reach
    // remote-access management OR host/app control (turn access off, kick devices, open a browser on
    // the host, write settings, shut down or restart). Those belong to the local host alone.
    if (isRemote && isHostOnlyRoute(p, req.method)) {
      return err("forbidden: managed on the host device", 403);
    }
    // Disk-fill vector on an untrusted surface, refused before a body byte is read (isLoopbackOnlyRoute's own doc).
    if (isRemote && isLoopbackOnlyRoute(p)) {
      return err("This import operation is available on the local desktop app only.", 403);
    }

    if (p === "/" || p === "/index.html") {
      if (packaged) return htmlResponse(packaged.indexHtml);
      const file = Bun.file(fileURLToPath(new URL("./index.html", import.meta.url)));
      return htmlResponse(await file.text());
    }
    // Static + bundled assets (CSS, icons, boot bundle, vendor, sealed sandbox workers). The HTML shell
    // above stays here because it needs per-launch session-meta injection.
    const assetResp = await handleAssetRoutes(p, packaged);
    if (assetResp) return assetResp;

    // Spotify's loopback redirect: a cross-site navigation /api would refuse, gated by its own single-use state.
    if (p === CALLBACK_PATH) return isRemote ? err("not found", 404) : handleSpotifyCallback(req, security);

    // /api auth gate. The untrusted Tailscale listener was already gated by its secret at the top; an
    // approved LAN session uses the CSRF token only (its Host is the LAN IP); the trusted loopback
    // listener uses Host/Origin/token. Host-only routes were already refused above.
    if (p.startsWith("/api/")) {
      if (lanApproved) {
        const denied = checkLanApiRequest(req, security);
        if (denied) return denied;
      } else if (!remoteSecret) {
        const denied = checkApiRequest(req, security);
        if (denied) return denied;
      }
      admit(req);
    }

    const spotifyRoute = await handleSpotifyRoutes(p, req, security);
    if (spotifyRoute) return spotifyRoute;

    if (p.startsWith("/api/extensions/")) {
      if (isRemote) return err("forbidden: extension management is available on the host device", 403);
      return await handleExtensionRoutes(req, url, extensionService ?? await extensionOwner.get()) ?? err("not found", 404);
    }

    if (p.startsWith("/api/themes/")) {
      if (isRemote && req.method !== "GET") return err("forbidden: managed on the host device", 403);
      const opened = isRemote ? undefined : library?.opened();
      const reader = isRemote ? await reads?.themeReader() ?? undefined : undefined;
      const runtime = isRemote ? null : await extensionOwner.get();
      const localReader: ThemeReadService = runtime && "themeEffective" in runtime ? {
        effective: runtime.themeEffective, asset: runtime.themeAsset, revisionStamp: runtime.themeRevision,
        markBroken: runtime.themeMarkBroken, confirmHealthy: runtime.themeConfirmHealthy,
      } : {
        effective: async () => ({ themeId: null, packageId: null, digest: null, grantedScopes: [], appearance: null, assets: [], fonts: [], styles: null, slots: {}, fallbackReason: "disabled" as const }),
        asset: async () => null,
        revisionStamp: () => ({ epoch: "0".repeat(48), revision: 0 }),
        markBroken: async () => false,
        confirmHealthy: async () => {},
      };
      return themeRoute(req, url, undefined, isRemote ? reader : localReader);
    }

    if (p === "/api/search" && req.method === "POST") {
      const opened = reads?.opened();
      return opened ? withLibraryReadLease(opened.keyring, opened.isCurrent, () => handleSearch(req, opened.search)) : err("library is unavailable", 503);
    }

    const docsResponse = await handleDocsRequest(req, url, packaged);
    if (docsResponse) return docsResponse;

    if ((p === "/api/asset/upload" || p === "/api/asset/from-url") && req.method === "POST") {
      if (isRemote) return err("asset uploads are available from the local studio only", 403);
      return (p === "/api/asset/upload" ? stageAssetUpload : stageAssetFromUrl)(req, security.token, async () => {
        const opened = library?.opened();
        return !!opened && (await opened.keyring.status()).state === "unlocked";
      });
    }
    if ((p === "/api/asset/discard" || p === "/api/asset/adopt") && req.method === "POST") {
      if (isRemote) return err("asset grants belong to the local studio session", 403);
      return p === "/api/asset/adopt" ? adoptLibraryAssets(req, security.token, store) : discardAssetUploads(req, security.token);
    }

    // apps, setup steps, tours: one shared drop-in mechanism (DECISIONS #10 build law), split out
    // at this file's own size cap - server-dropins.ts, pure code motion.
    const dropInResp = await handleDropInRoutes(p, packaged);
    if (dropInResp) return dropInResp;

    // dev live-reload stream (404 in the packaged exe; the client goes quiet on error)
    if (p === "/dev/reload") {
      if (packaged) return err("not found", 404);
      return createDevReloadResponse();
    }

    if (p === "/api/settings") {
      try {
        if (req.method === "POST") {
          const parsed = await readJsonObject(req);
          if (!parsed.ok) return parsed.response;
          return json(await settings.save(parsed.value));
        }
        if (req.method === "PATCH") {
          const parsed = await readJsonObject(req);
          if (!parsed.ok) return parsed.response;
          return json(await settings.update(parsed.value));
        }
        return json(await settings.read());
      } catch (e) {
        return studioErr(e);
      }
    }

    // mode tells the About row which UPDATE PATH applies: a packaged exe downloads the next
    // release, a source checkout runs git pull - same version math, different prescription
    if (p === "/api/version") {
      return json({
        version: APP_VERSION,
        // Never leak the host filesystem path to a remote/LAN device.
        studioDir: isRemote ? undefined : store.studioPath(),
        mode: packaged ? "packaged" : "source",
      });
    }
    // Remote access control plane (Tailscale + LAN). The /api gate above already enforced trusted-origin
    // auth, and host-only routes were refused for remote/LAN devices, so only the local owner reaches it.
    const remoteResp = await handleRemoteRoutes(req, p, { remote, lan, settings });
    if (remoteResp) return remoteResp;

    if (p === "/api/update-check") return handleUpdateCheck();
    if (switchManager) {
      const upd = await handleUpdatesRoutes(req, p, { manager: switchManager, settings, installed: APP_VERSION });
      if (upd) return upd;
    }
    const libraryRoute = await handleLibraryRoutes(p, req, library);
    if (libraryRoute) return libraryRoute;
    if (p === "/api/formats") return json(registry.all().map(formatMeta));
    // the editor lens's ground truth: every character adapter that declared coverage (deny by
    // absence - an undeclared platform simply is not lensable yet, and the UI says so honestly)
    if (p === "/api/coverage") {
      // Full list (export honesty needs every format's carries). Strip filters lens === false.
      const adapters = registry
        .all()
        .filter((a) => a.kind === "character" && a.coverage && !a.native)
        .map((a) => ({
          id: a.id,
          label: a.label,
          carries: a.coverage!.carries,
          notes: a.coverage!.notes,
          lens: a.lens !== false,
        }));
      // Extension-map only when no character adapter already owns that id (no dual Lumiverse tabs).
      const adapterIds = new Set(adapters.map((a) => a.id));
      const extras = EXTENSION_PLATFORMS.filter((e) => !adapterIds.has(e.id)).map((e) => ({
        id: e.id,
        label: e.label,
        carries: e.carries,
        notes: e.notes,
        lens: true,
      }));
      return json([...adapters, ...extras]);
    }
    // The agent window: provider status, one turn, the studio-change stream. See agent/routes.ts,
    // where they sit together because they are the only routes here that reach a model.
    const agentRoute = await handleAgentRoutes(p, req, () => store.studioPath(), library);
    if (agentRoute) return agentRoute;

    // The person's own groupings of pieces. See server-collections.ts.
    const collectionsRoute = await handleCollectionsRoutes(p, req, () => store.studioPath(), async () => {
      try { await library?.opened()?.search.refreshMemberships(); }
      catch { library?.opened()?.search.service.invalidate(); }
    });
    if (collectionsRoute) return collectionsRoute;

    // The Macro Lab's engines: what can run here, and run this text through it. Host-only above,
    // because it is the one route that starts somebody else's application. See server-macro-lab.ts.
    const macroLabRoute = await handleMacroLabRoutes(p, req, store.studioPath());
    if (macroLabRoute) return macroLabRoute;

    // MCP connections: which servers this machine talks to. Host-only above - an entry is a
    // command this machine executes. See server-mcp.ts.
    const mcpRoute = await handleMcpRoutes(p, req);
    if (mcpRoute) return mcpRoute;

    if (p === "/api/inspect" && req.method === "POST") return handleInspect(req, security.token, !isRemote);
    if (p === "/api/inspect-archive" && req.method === "POST") return handleInspectArchive(req, security.token);
    if (p === "/api/export" && req.method === "POST") {
      const parsed = await readJsonObject(req);
      if (!parsed.ok) return parsed.response;
      return handleExport(store, parsed.value);
    }

    const studioRead = await handleStudioRead(p, url, store);
    if (studioRead) return studioRead;
    if (p.startsWith("/api/asset/") || p === "/api/studio/portrait" || p === "/api/studio/portrait-ref" || p === "/api/chats/portrait" || p === "/api/chats/portrait-ref") {
      const opened = reads?.opened();
      if (!opened) return err("library is unavailable", 423);
      return withLibraryReadLease(opened.keyring, opened.isCurrent, async () =>
        await handleAssetRoute(p, url, store, req.method, req.headers.get("range"))
          ?? await handlePortraitReferenceRoute(p, url, store, req.method)
          ?? await handleLegacyPortraitRoute(p, url, store, req.method)
          ?? await handleFrozenPortraitRoute(req, url, opened.chats, store)
          ?? err("not found", 404));
    }
    const openRoute = await handleOpenRoute(p, req) ?? await handleExportFolderRoute(p, url, req, store.studioPath());
    if (openRoute) return openRoute;

    if (p === "/api/studio/save-bundle" && req.method === "POST") {
      try {
        const parsed = await readJsonObject(req);
        if (!parsed.ok) return parsed.response;
        const raw = parsed.value as {
          entity?: AnyEntity;
          related?: unknown[];
          overwrite?: boolean;
        };
        if (!raw.entity || typeof raw.entity !== "object") {
          return err("expected { entity, related? }");
        }
        if (isImportedScene(raw.entity)) {
          const saved = await saveSceneCarrier(store, raw.entity);
          return json(saved, saved.ok ? 200 : 422);
        }
        const result = await saveBundle(store, {
          entity: raw.entity,
          ...(raw.related ? { related: raw.related } : {}),
          overwrite: raw.overwrite === true,
        });
        return json(result, result.ok ? 200 : result.partial ? 207 : 422);
      } catch (e) {
        return studioErr(e);
      }
    }
    if (p.startsWith("/api/chats/")) return handleChatRoute(req, url, store, settings, isRemote ? "" : security.token,
      isRemote ? undefined : (payload) => extensionOwner.dispatchSceneEvent(payload),
      isRemote ? undefined : (sceneId, messages, signal) => extensionOwner.applyPromptContributions(sceneId, messages, signal),
      isRemote ? undefined : (sceneId) => extensionOwner.hasPromptContributors(sceneId));
    const write = STUDIO_WRITES[p];
    if (write && req.method === "POST") return write(req, store, isRemote ? "" : security.token);
    if (lifecycle && p === "/api/shutdown" && req.method === "POST") return handleShutdown(lifecycle);
    if (lifecycle && p === "/api/restart" && req.method === "POST") return handleRestart(lifecycle);

    return err("not found", 404);
  };
  // A locked library answers 423 from any route, and activity feeds the idle lock (server-library.ts).
  return Object.assign(libraryFrontDoor(route, library), { close: () => extensionOwner.close() });
}
