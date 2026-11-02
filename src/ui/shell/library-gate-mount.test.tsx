/**
 * LibraryGate mounted for real (perf(idle) d2071d2's review gap #1): a pushed lock event, a stream
 * reconnect, and the tab becoming visible each have to show up as a fresh /api/library/status read
 * with nothing mocked out between the push and the render - library-gate.test.tsx's pure-function
 * proofs cannot see that wiring at all, by their own admission (see the comment there this file
 * closes). Modeled on App.boot.test.tsx's shape (a real async fetch, IS_REACT_ACT_ENVIRONMENT off,
 * polling rather than act()) and use-studio-changes.test.tsx's fake EventSource.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { createRoot, type Root } from "react-dom/client";
import { installDom, teardownAllDoms } from "../_shared/test-dom";
import { LibraryGate, type Status } from "./library-gate";

afterAll(teardownAllDoms);

let dom: JSDOM;

beforeAll(() => {
  dom = installDom('<!doctype html><div id="root"></div>', {
    url: "http://127.0.0.1:8533/",
    extraGlobals: ["Event", "sessionStorage", "localStorage"],
    // Not act()'d: check() crosses a real fetch/Response await, an honest gap act() cannot close.
    // Warnings about updates outside act() are exactly what this flag turns off (App.boot.test.tsx's
    // same choice, for the same reason).
    globals: { IS_REACT_ACT_ENVIRONMENT: false, fetch: globalThis.fetch, EventSource: globalThis.EventSource }
  }).dom;
});

type Listener = () => void;

/** The stream, without a server. Only the events useStudioChanges.ts actually listens for or calls
 *  (`addEventListener`, `close`) - the same shape use-studio-changes.test.tsx's FakeSource uses,
 *  plus a `closed` flag so a reconnect test can prove the old one was really dropped. */
class FakeSource {
  private readonly listeners = new Map<string, Listener[]>();
  closed = false;
  constructor(readonly url: string) {
    live.push(this);
  }
  addEventListener(type: string, fn: Listener): void {
    const at = this.listeners.get(type) ?? [];
    at.push(fn);
    this.listeners.set(type, at);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

/** Every source the hook has opened this test, in order, so a test can push frames at any of them
 *  and prove a reconnect really made a new one. */
let live: FakeSource[] = [];

let currentStatus: Status = { phase: "unlocked" };
let fetchLog: string[] = [];

function installFetch(): void {
  fetchLog = [];
  const impl = async (input: unknown): Promise<Response> => {
    // Recorded the instant fetch() is called, not when it resolves - the same reason
    // App.boot.test.tsx's LoggedFetch reads shellPresent synchronously.
    fetchLog.push(String(input));
    return new Response(JSON.stringify(currentStatus), { status: 200 });
  };
  (globalThis as unknown as { fetch: typeof fetch }).fetch = impl as unknown as typeof fetch;
}

async function waitUntil(check: () => boolean, timeoutMs = 2000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => dom.window.setTimeout(r, stepMs));
  }
  if (!check()) throw new Error("condition never became true within " + timeoutMs + "ms");
}

let root: Root | null = null;

function mountGate(): HTMLElement {
  const host = dom.window.document.getElementById("root")!;
  host.replaceChildren();
  root = createRoot(host);
  root.render(<LibraryGate>{<div>STUDIO-VISIBLE</div>}</LibraryGate>);
  return host;
}

const setVisibility = (state: "visible" | "hidden"): void => {
  Object.defineProperty(dom.window.document, "visibilityState", { value: state, configurable: true });
  dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
};

beforeEach(() => {
  live = [];
  currentStatus = { phase: "unlocked" };
  installFetch();
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeSource;
  setVisibility("visible");
});

afterEach(() => {
  root?.unmount();
  root = null;
});

describe("LibraryGate mounted: the pushed-event wiring", () => {
  test("a pushed lock event moves an unlocked gate to the locked screen, with no poll", async () => {
    const host = mountGate();
    await waitUntil(() => host.textContent?.includes("STUDIO-VISIBLE") ?? false);

    // Connects: watching false -> true also re-checks once, by design (the "reconnect means a gap"
    // effect does not distinguish a first connect from a reconnect). Still unlocked.
    live[0]!.emit("ready");
    await waitUntil(() => fetchLog.length >= 2);
    const beforeLock = fetchLog.length;

    currentStatus = { phase: "locked", hasPassword: true, hasWords: false };
    live[0]!.emit("lock");
    // The push causes exactly TWO reads from this one transition, both event-driven, neither a
    // poll: the lockEvent effect's own re-check, and library-gate.tsx's `entersLocked` effect (274)
    // dispatching LIBRARY_LOCKED_EVENT for the art cache - which the OTHER effect's `onLocked`
    // listener (280, there for the 423-mid-request case) also happens to catch, firing a second
    // check(). It settles there: that second check's own resulting status no longer crosses INTO
    // locked (lastStatus.current is already "locked" by then), so entersLocked is false and nothing
    // dispatches again.
    //
    // WAITING ON THE EXACT COUNT, NOT THE DOM TEXT, IS THE FIX FOR THE FLAKE. The DOM commits
    // "locked" as soon as the FIRST of those two checks resolves - before the second (synchronous
    // dispatch, but an async check()) has necessarily recorded its own fetch call. Racing a
    // wall-clock poll against that gap is exactly what made the old (wrong) `beforeLock + 1`
    // expectation pass under light load and fail under the load of the full shell suite: a fast
    // poll caught the DOM update before the second fetch landed (an accidental "pass" against a
    // wrong number), a slow one did not (a "fail" that was actually the correct, complete count).
    await waitUntil(() => fetchLog.length >= beforeLock + 2);
    await waitUntil(() => !(host.textContent?.includes("STUDIO-VISIBLE") ?? true));

    // the stage door is a modal dialog portaled to the body, so it is read from the document, not from the mount node
    expect(dom.window.document.body.textContent).toContain("Welcome");
    expect(dom.window.document.querySelector("dialog.host-protected[open]")).not.toBeNull();
    expect(fetchLog.length).toBe(beforeLock + 2);
  });

  test("after the stream drops and reconnects, watching false -> true triggers a re-check", async () => {
    const host = mountGate();
    await waitUntil(() => host.textContent?.includes("STUDIO-VISIBLE") ?? false);
    live[0]!.emit("ready");
    await waitUntil(() => fetchLog.length >= 2);
    const settled = fetchLog.length;

    // The real backoff after a first failure is 3s+ (use-studio-changes.ts's scheduleRetry). Only
    // the wait is accelerated here, not whether the retry happens - only delays >= 1000ms are
    // touched, so React's own (much shorter) scheduling delays pass straight through untouched.
    // Captured BEFORE spyOn replaces globalThis.setTimeout: jsdom's own timer plumbing calls the
    // bare global setTimeout internally, so calling back through dom.window.setTimeout (or the
    // live globalThis.setTimeout) here would re-enter this same mock and recurse forever.
    const realSetTimeout = globalThis.setTimeout;
    const spy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
      realSetTimeout(fn, typeof ms === "number" && ms >= 1000 ? 0 : ms, ...rest)) as typeof setTimeout);
    try {
      live[0]!.emit("error"); // watching -> false; the source closes; a reconnect is scheduled
      await waitUntil(() => live.length > 1 && live[0]!.closed);
      live.at(-1)!.emit("ready"); // the new connection's own ready: watching false -> true again
      await waitUntil(() => fetchLog.length > settled);
    } finally {
      spy.mockRestore();
    }
    expect(fetchLog.length).toBeGreaterThan(settled);
  });

  test("a visibilitychange to visible triggers a re-check", async () => {
    const host = mountGate();
    await waitUntil(() => host.textContent?.includes("STUDIO-VISIBLE") ?? false);
    const afterMount = fetchLog.length;

    setVisibility("hidden");
    await new Promise((r) => dom.window.setTimeout(r, 30));
    expect(fetchLog.length).toBe(afterMount); // hiding is not a reason to re-check

    setVisibility("visible");
    await waitUntil(() => fetchLog.length > afterMount);
    expect(fetchLog.length).toBe(afterMount + 1);
  });
});

/**
 * A virtual clock for setInterval/clearInterval only (setTimeout stays real, matching
 * use-visible-interval.test.tsx's own FakeClock, which owns the original - there is no shared test
 * harness module for it yet, so this is the same small shape kept local to this file). advance()
 * fires every due callback in time order without waiting on the wall clock, so simulated minutes
 * cost microseconds instead of minutes.
 */
class FakeClock {
  private now = 0;
  private seq = 0;
  private readonly timers = new Map<number, { fn: () => void; interval: number; next: number }>();

  get intervalCount(): number { return this.timers.size; }

  readonly setInterval = ((fn: () => void, ms?: number): number => {
    const id = ++this.seq;
    this.timers.set(id, { fn, interval: ms ?? 0, next: this.now + (ms ?? 0) });
    return id;
  }) as unknown as typeof globalThis.setInterval;

  readonly clearInterval = ((id?: unknown): void => {
    if (typeof id === "number") this.timers.delete(id);
  }) as unknown as typeof globalThis.clearInterval;

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.next < dueAt) {
          dueAt = t.next;
          dueId = id;
        }
      }
      if (dueId === null || dueAt > end) break;
      this.now = dueAt;
      const t = this.timers.get(dueId)!;
      t.next += t.interval;
      t.fn();
    }
    this.now = end;
  }
}

describe("LibraryGate mounted: the 15s fallback poll", () => {
  let clock: FakeClock;
  let setIntervalSpy: ReturnType<typeof spyOn>;
  let clearIntervalSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    clock = new FakeClock();
    setIntervalSpy = spyOn(globalThis, "setInterval").mockImplementation(clock.setInterval);
    clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(clock.clearInterval);
  });
  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  test("unlocked, stream not watching: the 15s fallback poll runs", async () => {
    const host = mountGate();
    await waitUntil(() => host.textContent?.includes("STUDIO-VISIBLE") ?? false);
    // The shell text can commit before passive effects arm the fallback interval. Wait for the
    // actual timer owner so advancing this clock proves a scheduled poll, not an unmounted effect.
    await waitUntil(() => clock.intervalCount === 1);
    const afterMount = fetchLog.length;
    // never emits "ready": watching stays false for the life of this test, the rare case a remote
    // or LAN window is in, or a host stream that has not come up yet.

    clock.advance(15_000);
    expect(fetchLog.length).toBe(afterMount + 1);

    clock.advance(30_000);
    expect(fetchLog.length).toBe(afterMount + 3); // two more 15s ticks
  });

  test("unlocked, stream watching: no poll runs over a simulated 10 minutes", async () => {
    const host = mountGate();
    await waitUntil(() => host.textContent?.includes("STUDIO-VISIBLE") ?? false);
    live[0]!.emit("ready");
    await waitUntil(() => fetchLog.length >= 2); // the connect's own one-time re-check settles
    const settled = fetchLog.length;

    clock.advance(10 * 60_000);
    expect(fetchLog.length).toBe(settled); // pushed lock/unlock is the only signal; no fallback armed
  });
});
