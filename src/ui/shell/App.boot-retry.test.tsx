/**
 * App's boot sequence when the piece list itself misbehaves: every retry fails, a retry succeeds
 * partway through, applying a successfully-read list throws (a bug, not a network failure), and the
 * retry loop actually stops - on unmount and on a lock - instead of spinning timers in the
 * background. Split out of App.boot.test.tsx (which covers the list resolving normally) only because
 * one file for every boot scenario crossed the 500-line cap; the harness below is that file's own,
 * copied rather than shared, because two independent jsdom instances per test file is what this
 * codebase already does everywhere else it needs one (library/index.test.tsx, App.boot.test.tsx).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { createRoot, type Root } from "react-dom/client";
import type { JSX } from "react";
import { installDom, teardownAllDoms } from "../_shared/test-dom";
import { App } from "./App";
import { useShellStore } from "./store";
import { LIBRARY_LOCKED_EVENT } from "../_shared/api-fetch";

afterAll(teardownAllDoms);

let dom: JSDOM;

beforeAll(() => {
  // See App.boot.test.tsx's own beforeAll for why the session tag and the blob: base both matter.
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
  (dom.window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
});

let root: Root | null = null;

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

const TIMEOUT = 8000;

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
  useShellStore.setState({
    manifests: [],
    activeAppId: "",
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
  // See App.boot.test.tsx's own afterEach for why this drain matters.
  await new Promise((r) => dom.window.setTimeout(r, 300));
});

describe("the piece list can fail", () => {
  // Fast, not the real 2s/5s/15s (LIST_RETRY_DELAYS_MS): these tests prove the retry-then-give-up
  // shape, not the real clock.
  const FAST_RETRIES = [5, 5, 5];

  test("every retry fails: the shell stays up with a sticky note - not the boot-error screen", async () => {
    installFetch({ settings: baseSettings(), manifests: [manifest({})] });
    const realFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/studio/inventory")) throw new Error("network down");
      return realFetch(input as never, init);
    }) as unknown as typeof fetch;
    mount(<App forceSkipTitle={true} testListRetryDelaysMs={FAST_RETRIES} />);

    // #shell alone cannot tell the ready shell from BootErrorScreen - both use that id. #status
    // (StatusBar) renders only in the ready shell, so it is the actual "not boot-error" proof.
    await waitForElement("status");
    const EXPECTED = "could not read the piece list after 4 tries · reload and try again";
    await waitUntil(() => useShellStore.getState().bootListFailed === EXPECTED);
    expect(useShellStore.getState().bootListFailed).toBe(EXPECTED);
    expect(dom.window.document.getElementById("status")).not.toBeNull(); // still the shell, not boot-error
  }, TIMEOUT);

  test("with a saved bench, exhausting the retries never arms the write-gate over it", async () => {
    const settings = {
      ...baseSettings(),
      "workbench.restoreSession": true,
      "workbench.workspace": {
        open: [{ kind: "preset", id: "alive" }],
        activeKey: "preset:alive", splitKey: "", appId: "workbench",
      },
    };
    const manifests = [manifest({ id: "workbench", order: 5, editsPieces: true, firstRunLanding: false }), manifest({})];
    const { log } = installFetch({ settings, manifests });
    const realFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/studio/inventory")) throw new Error("network down");
      return realFetch(input as never, init);
    }) as unknown as typeof fetch;
    mount(<App forceSkipTitle={true} testListRetryDelaysMs={FAST_RETRIES} />);

    const EXPECTED = "could not read the piece list after 4 tries · reload and try again";
    await waitForElement("status");
    await waitUntil(() => useShellStore.getState().bootListFailed === EXPECTED);
    // The write-gate (restoringWorkspace) must never arm on a permanent failure: arming it would let
    // use-workspace.ts's write-gate effect re-run on the (still empty, never-restored) bench and
    // PATCH that empty snapshot straight over the saved one settings.json still has, with no chance
    // left to retry the read that would have restored it.
    expect(useShellStore.getState().restoringWorkspace).toBe(true);
    await new Promise((r) => dom.window.setTimeout(r, 50));
    expect(log.some((c) => c.url.startsWith("/api/settings") && c.method === "PATCH")).toBe(false);
  }, TIMEOUT);

  test("a retry that succeeds on the second attempt arms the gate and restores the bench", async () => {
    const settings = {
      ...baseSettings(),
      "workbench.restoreSession": true,
      "workbench.workspace": {
        open: [{ kind: "preset", id: "alive" }],
        activeKey: "preset:alive", splitKey: "", appId: "workbench",
      },
    };
    const manifests = [manifest({ id: "workbench", order: 5, editsPieces: true, firstRunLanding: false }), manifest({})];
    installFetch({ settings, manifests });
    let listCalls = 0;
    const realFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/studio/inventory")) {
        listCalls++;
        if (listCalls === 1) throw new Error("network down, just this once");
        return new Response(JSON.stringify({ entities: [{ id: "alive", kind: "preset", name: "Alive" }], damaged: [] }), { status: 200 });
      }
      return realFetch(input as never, init);
    }) as unknown as typeof fetch;
    mount(<App forceSkipTitle={true} testListRetryDelaysMs={FAST_RETRIES} />);

    await waitForElement("shell");
    await waitUntil(() => useShellStore.getState().activeAppId === "workbench"); // the shell can paint a tick before the saved app is applied
    expect(useShellStore.getState().activeAppId).toBe("workbench");
    expect(useShellStore.getState().openPieces).toEqual([]); // not yet - still on attempt 1

    await waitUntil(() => useShellStore.getState().openPieces.length > 0);

    expect(listCalls).toBe(2); // attempt 1 failed, attempt 2 (the first retry) succeeded
    expect(useShellStore.getState().bootListFailed).toBeNull();
    expect(useShellStore.getState().restoringWorkspace).toBe(false); // the gate armed
    expect(useShellStore.getState().openPieces.map((p) => p.id)).toEqual(["alive"]);
  }, TIMEOUT);
});

describe("finishBoot applying a successfully-read list can itself throw", () => {
  test("a bug in resolveWorkspace/restoreBench still opens the gate and leaves a sticky note - never a stuck 'Restoring...'", async () => {
    const settings = {
      ...baseSettings(),
      "workbench.restoreSession": true,
      "workbench.workspace": {
        open: [{ kind: "preset", id: "alive" }],
        activeKey: "preset:alive", splitKey: "", appId: "workbench",
      },
    };
    const manifests = [manifest({ id: "workbench", order: 5, editsPieces: true, firstRunLanding: false }), manifest({})];
    const { resolveList } = installFetch({ settings, manifests });
    // The list resolves fine; applying it (restoreBench) is what throws - the bug this fix is for,
    // not a network failure (fetchEntitiesWithRetry already owns that branch). Restored in `finally`:
    // useShellStore is a process-wide singleton, so leaving the real action overwritten would poison
    // every OTHER test in this run, this file's own included - not merely this one.
    const realRestoreBench = useShellStore.getState().restoreBench;
    useShellStore.setState({
      restoreBench: () => {
        throw new Error("a bug, not a network failure");
      },
    });
    try {
      mount(<App forceSkipTitle={true} />);

      await waitForElement("shell");
      expect(useShellStore.getState().restoringWorkspace).toBe(true); // still provisional pre-resolve

      resolveList([{ id: "alive", kind: "preset", name: "Alive" }]);

      const EXPECTED = "the saved bench could not be restored · reload and try again";
      await waitUntil(() => useShellStore.getState().bootListFailed === EXPECTED);
      // The gate opens despite the throw: a bug here is not retryable, so leaving the Workbench stuck
      // showing "Restoring your bench..." with its CTAs hidden forever would be strictly worse.
      expect(useShellStore.getState().restoringWorkspace).toBe(false);
    } finally {
      useShellStore.setState({ restoreBench: realRestoreBench });
    }
  }, TIMEOUT);
});

describe("the piece-list retry stops instead of spinning forever in the background", () => {
  const RETRY_DELAYS = [40, 40, 40];

  /** Always fails /api/studio/inventory; counts every attempt. */
  function installAlwaysFailingList(): { listCalls: () => number } {
    installFetch({ settings: baseSettings(), manifests: [manifest({})] });
    let calls = 0;
    const realFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/studio/inventory")) {
        calls++;
        throw new Error("network down");
      }
      return realFetch(input as never, init);
    }) as unknown as typeof fetch;
    return { listCalls: () => calls };
  }

  test("unmounting mid-retry cancels the pending timer: no further attempt ever fires", async () => {
    const { listCalls } = installAlwaysFailingList();
    mount(<App forceSkipTitle={true} testListRetryDelaysMs={RETRY_DELAYS} />);

    await waitUntil(() => listCalls() === 1); // the first (immediate) attempt has failed
    root?.unmount();
    root = null;

    // Long enough for every retry's backoff (40ms each) to have fired at least once more, were the
    // timer not actually cleared.
    await new Promise((r) => dom.window.setTimeout(r, 200));
    expect(listCalls()).toBe(1);
  }, TIMEOUT);

  test("the library locking mid-retry stops further attempts", async () => {
    const { listCalls } = installAlwaysFailingList();
    mount(<App forceSkipTitle={true} testListRetryDelaysMs={RETRY_DELAYS} />);

    await waitUntil(() => listCalls() === 1); // the first (immediate) attempt has failed
    dom.window.dispatchEvent(new dom.window.Event(LIBRARY_LOCKED_EVENT));

    await new Promise((r) => dom.window.setTimeout(r, 200));
    expect(listCalls()).toBe(1);
    // Locking mid-retry is not the same failure as exhausting every retry: it never gets far enough
    // to write the "after N tries" note.
    expect(useShellStore.getState().bootListFailed).toBeNull();
  }, TIMEOUT);
});

describe("a bench the user already built by hand is never stomped, even after a retry", () => {
  test("pieces opened before the list lands survive the restore that arrives after", async () => {
    const settings = {
      ...baseSettings(),
      "workbench.restoreSession": true,
      "workbench.workspace": {
        open: [{ kind: "preset", id: "alive" }],
        activeKey: "preset:alive",
        splitKey: "",
        appId: "workbench",
      },
    };
    const manifests = [manifest({ id: "workbench", order: 5, editsPieces: true, firstRunLanding: false }), manifest({})];
    const { resolveList } = installFetch({ settings, manifests });
    mount(<App forceSkipTitle={true} />);

    await waitForElement("shell");
    const manual = { id: "manual", kind: "preset", name: "Manual" };
    useShellStore.setState({ openPieces: [manual as never], activeKey: "preset:manual" });

    resolveList([{ id: "alive", kind: "preset", name: "Alive" }]);
    // studioCount is set before the "bench untouched?" guard is checked - an exact "finishBoot got
    // this far" signal, not a fixed sleep that could fire before it does.
    await waitUntil(() => useShellStore.getState().studioCount === 1);
    expect(useShellStore.getState().openPieces).toEqual([manual]);
    expect(useShellStore.getState().activeKey).toBe("preset:manual");
  }, TIMEOUT);
});
