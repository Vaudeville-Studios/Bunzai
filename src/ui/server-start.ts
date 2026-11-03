/** Binds the visual app, sandbox, and remote listeners around the canonical route handler. */
import { openStudio } from "../foreign-reader";
import { toErrorMessage } from "../error-message";
import { SettingsStore } from "../studio/settings";
import type { PackagedAssets } from "./assets";
import type { LibraryHandle } from "./library-root";
import { createSecurityContext } from "./server-security";
import { startDevWatch } from "./server-static";
import { createExtensionRouteOwner } from "./server-extension-owner";
import { libraryReadCapability } from "./server-library-read-capability";
import type { MakeHandler } from "./server-remote";
import { setupRemoteAccess } from "./server-remote";
import { makeSwitchManager } from "./switch/setup";
import { APP_VERSION } from "../version";
import { startSandboxHost } from "./sandbox-host";
import { handleRestart, handleShutdown, realSpawnSelf, type LifecycleDeps } from "./server-lifecycle";
import { clearAllStagings } from "./server-staging";
import { clearStagedAssets } from "./server-asset-staging";
import { LVBAK_ARCHIVE_BOUNDS } from "../formats/lumiverse-archive";
import { createExtensionPromptPreviewer, createPromptScenesReader } from "./server-chats-forecast";
import type { createHandler as RouteHandler } from "./server-handler";
type CreateHandler = typeof RouteHandler;
/** Boot the visual app. Loopback only: a local forge, never an exposed service. */
export function startUiWithRoutes(
  createRouteHandler: CreateHandler,
  port: number,
  studioDir: string,
  packaged?: PackagedAssets,
  library?: LibraryHandle,
  bundledSidecar?: string,
): { instanceId: string; url: string; sandboxUrl: string | null; stop: () => void; close: () => Promise<void> } {
  // openStudio, not `new StudioStore`: the bare constructor cannot read a file it did not write, and
  // this window spent its life reporting a folder of SillyTavern presets as 145 damaged files.
  const store = openStudio(studioDir);
  const settings = new SettingsStore(studioDir);
  const sec = createSecurityContext();
  if (!packaged) startDevWatch(); // dev: edits to src/ui reload every open page

  // Filled after the sandbox listener binds; HTML injection reads this live.
  const sandboxOriginRef = { current: "" };
  const lifecycle: LifecycleDeps = { stop: () => {}, exit: (c) => process.exit(c), spawnSelf: realSpawnSelf };
  const sharedExtensionOwner = createExtensionRouteOwner(library, () => sandboxOriginRef.current, packaged,
    createExtensionPromptPreviewer(store, settings, library), createPromptScenesReader(library));
  const readCapability = libraryReadCapability(library, packaged, sharedExtensionOwner);

  // Remote access (Tailscale + LAN). The handler factory is injected so server-remote.ts never imports
  // back here; setupRemoteAccess creates the managers, binds the untrusted listener, and resumes on boot.
  const makeHandler: MakeHandler = (o) =>
    createRouteHandler(store, settings, packaged, sec, sandboxOriginRef, lifecycle, o.remote, o.remoteSecret, o.lanApproved, o.lan, undefined, undefined, readCapability, undefined, sharedExtensionOwner);
  const remoteAccess = setupRemoteAccess({ settings, studioDir, makeHandler, bundledSidecar, packaged: packaged !== undefined, ...(library ? { ready: library.unlocked() } : {}) });
  let closeHandler: (() => Promise<void>) | null = null;
  try {

    // Version switching (update/rollback). Host-only: only the trusted handler below gets the manager.
    const switchManager = makeSwitchManager(!!packaged, process.cwd(), APP_VERSION, settings);

    const handler = createRouteHandler(
      store,
      settings,
      packaged,
      sec,
      sandboxOriginRef,
      lifecycle,
      remoteAccess.remote,
      undefined,
      undefined,
      remoteAccess.lan,
      switchManager,
      library,
      undefined,
      undefined,
      sharedExtensionOwner,
    );
    closeHandler = () => handler.close();
    // idleTimeout: Bun's default 10s killed bulk imports mid-inspect; 120s covers the slowest real
    // inspect observed (23MB charx) with room to spare. maxRequestBodySize: Bun's 128MB default sits
    // under a Lumiverse backup's real ceiling (LVBAK_ARCHIVE_BOUNDS.maxArchiveBytes) - below it, Bun
    // itself would refuse the request before handleInspectArchive's own error messages ever run.
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      idleTimeout: 120,
      maxRequestBodySize: LVBAK_ARCHIVE_BOUNDS.maxArchiveBytes,
      fetch: handler,
    });
    const host = `127.0.0.1:${server.port}`;
    sec.expectedHost = host;
    sec.expectedOrigin = `http://${host}`;

    let sandboxUrl: string | null = null;
    let stopSandbox: (() => void) | null = null;
    try {
      const sandbox = startSandboxHost({
        allowOrigin: sec.expectedOrigin,
        packaged,
      });
      sandboxUrl = sandbox.origin;
      sandboxOriginRef.current = sandbox.origin;
      stopSandbox = sandbox.stop;
    } catch (e) {
      console.warn(
        "server: sandbox host failed to start; falling back to same-origin worker:",
        toErrorMessage(e),
      );
    }

    const stopAssetLockWatch = library?.onLockChange((state) => {
      if (state === "locked") { void clearAllStagings(); void clearStagedAssets(); }
    });

    const stop = (): void => {
      server.stop(true);
      stopAssetLockWatch?.();
      stopSandbox?.();
      remoteAccess.stop();
      // Best-effort: staged archive entities are temp files the size of a backup's payload; leaving
      // them across sessions is the disk-fill this route's loopback-only rationale worries about.
      void clearAllStagings();
      void clearStagedAssets();
    };
    const close = async (): Promise<void> => { stop(); await handler.close(); };
    lifecycle.stop = close;

    return { instanceId: sec.instanceId, url: `http://${host}`, sandboxUrl, stop, close };
  } catch (error) {
    remoteAccess.stop();
    void closeHandler?.().catch((cause) => console.warn("server: failed startup cleanup:", toErrorMessage(cause)));
    throw error;
  }
}
