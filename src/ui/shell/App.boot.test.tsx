/**
 * App's boot sequence, mounted for real (perf plan Phase 2 / R4): the landing app - and the title
 * screen, when it shows - must paint without waiting for /api/studio/inventory, and a restored bench
 * must drop a piece deleted since rather than show it as a tab that cannot open. A pure description
 * of use-boot.ts cannot prove either: both are about what the DOM shows relative to an in-flight
 * request, which only a real render and a real (held-open) fetch can settle.
 *
 * `/api/studio/inventory` is held open with a deferred promise in every case below, exactly so a test
 * that only proves "the app eventually boots" cannot pass by accident - it has to prove boot does
 * not need that request to resolve at all.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { JSDOM } from "jsdom";
import { createRoot, type Root } from "react-dom/client";
import type { JSX } from "react";
import { installDom, teardownAllDoms } from "../_shared/test-dom";
import { App } from "./App";
import { useShellStore } from "./store";

afterAll(teardownAllDoms);

let dom: JSDOM;

beforeAll(() => {
  // The session meta tag matters: without it, apiFetch throws "missing session" on any PATCH
  // BEFORE it ever reaches the mock fetch below, so a PATCH assertion would pass vacuously.
  //
  // The <base> tag matters just as much: App.tsx's app-module loader resolves through assetUrl(),
  // which resolves against document.baseURI, not the document's origin (set below by `url` and
  // left alone, so sessionStorage/localStorage still work). Left at the http://localhost origin, a
  // dynamic import() of a bundle no dev server here ever serves is resolved by Bun as a WINDOWS
  // FILE PATH (there is no protocol handler for it), and that lookup's latency is wildly
  // inconsistent - under a millisecond most of the time, but observed over 25 s for a specifier
  // already attempted by an earlier test in the same run. A blob: base makes the same failed
  // import a clean, instant "Cannot find module" every time (measured: 0 ms, repeatedly, including
  // re-imports of the identical specifier) - the point is only "some component never resolves",
  // and this gets that without the flakiness.
  // StatusBar's useStudioChanges opens one; this boot window never needs it to do anything.
  class FakeEventSource {
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  dom = installDom(
    '<!doctype html><base href="blob://test-assets/"><meta name="vaude-session" content="test-token"><div id="root"></div>',
    {
      url: "http://localhost/",
      pretendToBeVisual: true,
      observers: true,
      extraGlobals: ["DOMParser", "SVGElement", "localStorage", "sessionStorage", "MutationObserver", "URLSearchParams"],
      globals: { IS_REACT_ACT_ENVIRONMENT: false, EventSource: FakeEventSource, fetch: globalThis.fetch }
    },
  ).dom;
  // TitleScreen reads this; jsdom has no real implementation.
  (dom.window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
});

let root: Root | null = null;

/** One fetch call, in the order it was made. `shellPresent` is read synchronously the instant
 * fetch() is called - deterministic, unlike comparing it against a separately-awaited DOM wait. */
interface LoggedFetch {
  method: string;
  url: string;
  shellPresent: boolean;
}

/** A settings/apps/inventory responder whose summary snapshot is held until resolved. */
function installFetch(opts: {
  settings: Record<string, unknown>;
  manifests: unknown[];
}): { log: LoggedFetch[]; resolveList: (entities: unknown[]) => void } {
  const log: LoggedFetch[] = [];
  let resolveList!: (entities: unknown[]) => void;
  const listPromise = new Promise<unknown[]>((resolve) => {
    resolveList = resolve;
  });
  const fetchImpl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    log.push({ method, url, shellPresent: dom.window.document.getElementById("shell") !== null });
    if (url.startsWith("/api/settings") && method === "GET") {
      return new Response(JSON.stringify(opts.settings), { status: 200 });
    }
    if (url.startsWith("/api/settings")) {
      const patch = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      Object.assign(opts.settings, patch);
      return new Response(JSON.stringify(opts.settings), { status: 200 });
    }
    if (url.startsWith("/api/apps")) {
      return new Response(JSON.stringify(opts.manifests), { status: 200 });
    }
    if (url.startsWith("/api/studio/inventory")) {
      const entities = await listPromise;
      return new Response(JSON.stringify({ entities, damaged: [] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchImpl as unknown as typeof fetch;
  return { log, resolveList: (entities) => resolveList(entities) };
}

// Generous, but not the 25 s+ this needed before the blob: base fix above made the failed app
// import instant: passed as each test's own bun:test timeout so this file is honest under a bare
// `bun test`, with no external --timeout flag required.
const TIMEOUT = 8000;

/** Resolves the instant #id lands in the DOM - a microtask after React's commit, strictly before
 * any macrotask (a setTimeout(0), included) queued from an effect that ran after that same commit. */
function waitForElement(id: string, timeoutMs = 5000): Promise<Element> {
  const existing = dom.window.document.getElementById(id);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const obs = new dom.window.MutationObserver(() => {
      const el = dom.window.document.getElementById(id);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(dom.window.document.body, { childList: true, subtree: true });
    dom.window.setTimeout(() => {
      obs.disconnect();
      reject(new Error(`#${id} never appeared within ${timeoutMs} ms`));
    }, timeoutMs);
  });
}

async function waitUntil(check: () => boolean, timeoutMs = 5000, stepMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => dom.window.setTimeout(r, stepMs));
  }
  if (!check()) throw new Error("condition never became true");
}

const manifest = (patch: Record<string, unknown>): Record<string, unknown> => ({
  id: "scenes",
  title: "Scenes",
  markSvg: "<svg/>",
  accent: "#89a",
  order: 10,
  firstRunLanding: true,
  ...patch,
});

const baseSettings = (): Record<string, unknown> => ({ setupComplete: true, theme: "stage" });

function mount(el: JSX.Element): void {
  const host = dom.window.document.getElementById("root")!;
  host.replaceChildren();
  root = createRoot(host);
  root.render(el);
}

beforeEach(() => {
  dom.window.sessionStorage.clear();
  dom.window.localStorage.clear();
  dom.window.location.hash = ""; // the hash-link test sets this; never leak it into later tests
  useShellStore.setState({
    manifests: [],
    activeAppId: "",
    overlayOpen: false, overlayAppId: "", overlayPanes: null,
    openPieces: [],
    activeKey: "",
    splitKey: "",
    studioCount: null,
    statusNote: "",
    bootListFailed: null,
    restoringWorkspace: true,
  });
});

afterEach(async () => {
  root?.unmount();
  root = null;
  // Drain any straggler `setTimeout(fn, 0)` scheduled by use-boot.ts's armBackgroundList before
  // unmount (an untracked, un-cancellable timer by design - the real App never unmounts), and any
  // pending module-load attempt still settling. Without this, a fetch or a state change a torn-down
  // test's leftover async work makes lands during the NEXT test's window instead.
  await new Promise((r) => dom.window.setTimeout(r, 300));
});

describe("boot paints before the piece list resolves", () => {
  test("the landing app mounts while /api/studio/inventory is still in flight", async () => {
    installFetch({ settings: baseSettings(), manifests: [manifest({})] });
    mount(<App forceSkipTitle={true} />);

    // FAILS ON TODAY'S CODE: App.tsx awaits the piece inventory before it ever paints, so with the
    // list held open #shell never appears and this rejects.
    await waitForElement("shell");
    expect(useShellStore.getState().activeAppId).toBe("scenes");
  }, TIMEOUT);

  test("the perf gate: no /api/studio/inventory request before the landing app is in the DOM", async () => {
    const { log } = installFetch({ settings: baseSettings(), manifests: [manifest({})] });
    mount(<App forceSkipTitle={true} />);

    // FAILS ON TODAY'S CODE: the request fires immediately (boot waits for it before painting
    // anything), so `shellPresent` is recorded false - #shell does not exist yet at that instant,
    // and never will until the held-open list resolves.
    await waitUntil(() => log.some((c) => c.url.startsWith("/api/studio/inventory")));
    const listCall = log.find((c) => c.url.startsWith("/api/studio/inventory"))!;
    expect(listCall.shellPresent).toBe(true);
  }, TIMEOUT);

  test("the title screen shows while the list is still in flight, exactly when it should", async () => {
    installFetch({ settings: baseSettings(), manifests: [manifest({})] });
    mount(<App />); // no forceSkipTitle, no reload/requested/restore: title-core.ts says show it

    const shell = await waitForElement("shell");
    expect(shell.querySelector('[aria-label="Bunzai title screen"]')?.textContent).toContain("Enter the theater");
  }, TIMEOUT);

  test("the status bar never claims the shelves are empty before the list has even been asked", async () => {
    installFetch({ settings: baseSettings(), manifests: [manifest({})] });
    mount(<App forceSkipTitle={true} />);

    await waitForElement("shell");
    // FAILS ON TODAY'S CODE: studioCount starts at 0 (a real, confirmed number), and StatusBar
    // reads that as "your shelves are empty" - a false claim for a library nobody has asked about
    // yet, not merely an empty one.
    expect(useShellStore.getState().studioCount).toBeNull();
    dom.window.document.querySelector<HTMLButtonElement>('[data-part="shell.nav.overlay"]')!.click();
    await waitUntil(() => dom.window.document.querySelector('[aria-label="Studio summary"]') !== null);
    const piecesText = dom.window.document.querySelector('[aria-label="Studio summary"]')!.textContent!;
    expect(piecesText).toContain("Pieces loading");
    expect(piecesText).not.toContain("your shelves are empty");
  }, TIMEOUT);
});

describe("a restored bench drops a piece deleted since, once the list confirms it", () => {
  test("the surviving piece stays, the deleted one is never restored as a dead tab", async () => {
    const settings = {
      ...baseSettings(),
      "workbench.restoreSession": true,
      "workbench.workspace": {
        open: [
          { kind: "preset", id: "alive" },
          { kind: "preset", id: "gone" },
        ],
        activeKey: "preset:alive",
        splitKey: "",
        appId: "workbench",
      },
    };
    const manifests = [
      manifest({ id: "workbench", title: "The Workbench", order: 5, editsPieces: true, firstRunLanding: false }),
      manifest({}),
    ];
    const { log, resolveList } = installFetch({ settings, manifests });
    mount(<App forceSkipTitle={true} />);

    // FAILS ON TODAY'S CODE for the same reason as the first describe block: nothing paints while
    // the inventory is held open, so this never resolves.
    await waitForElement("shell");
    expect(useShellStore.getState().activeAppId).toBe("workbench");
    // Nothing was restored yet - a piece not yet confirmed live is never shown as a tab.
    expect(useShellStore.getState().openPieces).toEqual([]);
    // The pre-existing race use-workspace.ts's write-gate closes: with the bench still empty and
    // provisional, nothing has PATCHed settings.json's saved workspace over yet.
    expect(log.some((c) => c.url.startsWith("/api/settings") && c.method === "PATCH")).toBe(false);

    resolveList([{ id: "alive", kind: "preset", name: "Alive" }]);
    await waitUntil(() => useShellStore.getState().openPieces.length > 0);

    expect(useShellStore.getState().openPieces.map((p) => p.id)).toEqual(["alive"]);
    expect(useShellStore.getState().activeKey).toBe("preset:alive");
  }, TIMEOUT);
});

const gonePieceSettings = (): Record<string, unknown> => ({
  ...baseSettings(),
  "workbench.restoreSession": true,
  "workbench.workspace": {
    open: [{ kind: "preset", id: "gone" }],
    activeKey: "preset:gone",
    splitKey: "",
    appId: "workbench",
  },
});

const gonePieceManifests = (): Record<string, unknown>[] => [
  manifest({ id: "workbench", title: "The Workbench", order: 5, editsPieces: true, firstRunLanding: false }),
  manifest({}), // "scenes", SCENES_APP - the title-screen fallback below the app dock
];

describe("the late correction (every named piece is gone)", () => {
  test("still on the provisional app: the mount and the suppressed title both correct", async () => {
    const { resolveList } = installFetch({ settings: gonePieceSettings(), manifests: gonePieceManifests() });
    mount(<App />); // no forceSkipTitle: the correction must be free to show the title late

    await waitForElement("shell");
    expect(useShellStore.getState().activeAppId).toBe("workbench"); // provisional, from settings alone
    expect(dom.window.document.querySelector('[aria-label="Bunzai title screen"]')).toBeNull(); // suppressed for now

    resolveList([]); // the one piece the bench named no longer exists
    await waitUntil(() => useShellStore.getState().activeAppId === "scenes");
    await waitUntil(() => dom.window.document.querySelector('[aria-label="Bunzai title screen"]') !== null);
  }, TIMEOUT);

  test("the user already moved on: left alone, never yanked back or interrupted", async () => {
    const { resolveList } = installFetch({ settings: gonePieceSettings(), manifests: gonePieceManifests() });
    mount(<App />);

    await waitForElement("shell");
    expect(useShellStore.getState().activeAppId).toBe("workbench");
    // The user clicks over to Scenes on their own, well before the list confirms anything.
    useShellStore.getState().mountApp("scenes");

    // A non-matching survivor: resolveWorkspace still finds 0 survivors of "gone", so the
    // correction path still runs (and must still decline) - not a differently-shaped no-op.
    // studioCount is set synchronously, before the correction's own guard is even checked, so
    // waiting for it is an exact "finishBoot got this far" signal - a fixed sleep would be a
    // vacuous pass if it fired before finishBoot ever reached the guard.
    resolveList([{ id: "other", kind: "preset", name: "Other" }]);
    await waitUntil(() => useShellStore.getState().studioCount === 1);
    // studioCount is a zustand value, readable the instant finishBoot sets it; a title change
    // (React state) reaching the DOM needs a render after that. Without this tick, "no dialog"
    // could pass vacuously an instant before a wrongly-called setShowTitle(true) ever commits.
    await new Promise((r) => dom.window.setTimeout(r, 0));
    expect(useShellStore.getState().activeAppId).toBe("scenes"); // not yanked back to workbench
    expect(dom.window.document.querySelector('[aria-label="Bunzai title screen"]')).toBeNull(); // no title over live work
  }, TIMEOUT);
});

for (const close of [false, true]) test(`late boot correction cannot navigate after an overlay visit (${close ? "closed" : "open"})`, async () => {
  const { resolveList } = installFetch({ settings: gonePieceSettings(), manifests: gonePieceManifests() });
  mount(<App />); await waitForElement("shell");
  const store = useShellStore.getState(); store.openOverlay(); store.mountApp("scenes");
  if (close) store.closeOverlay();
  resolveList([{ id: "other", kind: "preset", name: "Other" }]);
  await waitUntil(() => useShellStore.getState().studioCount === 1);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  expect(useShellStore.getState().activeAppId).toBe("workbench");
  expect(useShellStore.getState().overlayAppId).toBe("scenes");
  expect(dom.window.document.querySelector('[aria-label="Bunzai title screen"]') === null).toBe(true);
}, TIMEOUT);

describe("a link target always wins, and never restores", () => {
  test("#hash plus a saved bench: the linked app mounts, the bench never populates", async () => {
    dom.window.location.hash = "#library";
    const manifests = [...gonePieceManifests(), manifest({ id: "library", order: 20 })];
    const settings = {
      ...gonePieceSettings(),
      "workbench.workspace": {
        open: [{ kind: "preset", id: "alive" }],
        activeKey: "preset:alive",
        splitKey: "",
        appId: "workbench",
      },
    };
    const { resolveList } = installFetch({ settings, manifests });
    mount(<App forceSkipTitle={true} />);

    await waitForElement("shell");
    expect(useShellStore.getState().activeAppId).toBe("library");

    resolveList([{ id: "alive", kind: "preset", name: "Alive" }]); // survives, but must never be restored
    // studioCount is set before the "requested wins, never restore" guard is checked - an exact
    // "finishBoot got this far" signal, not a fixed sleep that could fire before it does.
    await waitUntil(() => useShellStore.getState().studioCount === 1);
    expect(useShellStore.getState().activeAppId).toBe("library");
    expect(useShellStore.getState().openPieces).toEqual([]);
    dom.window.location.hash = "";
  }, TIMEOUT);
});

// Switching to an app whose module is already loaded (the idle prefetch loads every app) goes straight from one room to the other.
// Two real app modules are served from a temporary folder through the document's base URL, so App.tsx's own import() and cache run.
describe("a loaded app opens in one step", () => {
  test("no loading canvas paints between two loaded apps", async () => {
    const assets = mkdtempSync(join(tmpdir(), "bunzai-apps-"));
    const base = dom.window.document.querySelector("base")!;
    const blob = base.getAttribute("href")!;
    try {
      mkdirSync(join(assets, "apps"));
      for (const id of ["alpha", "beta"]) writeFileSync(join(assets, "apps", `${id}.js`), `export default { manifest: { id: "${id}", title: "${id}" }, Component: () => "room ${id}" };
`);
      base.setAttribute("href", pathToFileURL(assets + "/").href);
      installFetch({ settings: baseSettings(), manifests: [manifest({ id: "alpha" }), manifest({ id: "beta", order: 20, firstRunLanding: false })] });
      mount(<App forceSkipTitle={true} />);
      const text = (): string => dom.window.document.body.textContent ?? "";
      const settled = (id: string) => (): boolean => text().includes(`room ${id}`) && !dom.window.document.getElementById("canvasLoading");
      await waitUntil(settled("alpha"));
      useShellStore.getState().mountApp("beta");
      await waitUntil(settled("beta"));
      useShellStore.getState().mountApp("alpha");
      await waitUntil(settled("alpha"));
      let flashed = false;
      const watch = new dom.window.MutationObserver(() => { if (dom.window.document.getElementById("canvasLoading")) flashed = true; });
      watch.observe(dom.window.document.body, { childList: true, subtree: true });
      useShellStore.getState().mountApp("beta");
      await waitUntil(settled("beta"));
      watch.disconnect();
      expect(flashed).toBe(false);
    } finally {
      base.setAttribute("href", blob);
      rmSync(assets, { recursive: true, force: true });
    }
  }, TIMEOUT);
});

// The piece list failing, retrying, or throwing while applying a successful read: App.boot-retry.test.tsx.
