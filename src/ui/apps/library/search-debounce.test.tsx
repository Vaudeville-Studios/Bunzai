/**
 * F3: the Library search derivation debounces 150 ms behind typing, latest keystroke wins, and
 * clearing applies at once (no stale "no match" notice after Clear/Escape).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { JSDOM } from "jsdom";
import { installDom, type InstalledDom } from "../../_shared/test-dom";
import { useDebouncedQuery } from "./search-debounce";

let dom: JSDOM;
let installed: InstalledDom;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8332/",
    globals: { IS_REACT_ACT_ENVIRONMENT: true },
  });
  dom = installed.dom;
});
afterAll(() => installed.teardown());

async function mountProbe(initial: string): Promise<{ current(): string; set(next: string): Promise<void>; unmount(): Promise<void> }> {
  const host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  let seen = initial;
  function Probe({ query }: { query: string }): null {
    seen = useDebouncedQuery(query);
    return null;
  }
  await act(async () => { root.render(<Probe query={initial} />); });
  return {
    current: () => seen,
    set: async (next) => { await act(async () => { root.render(<Probe query={next} />); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); host.remove(); },
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("useDebouncedQuery", () => {
  test("holds the old value until 150 ms after the last keystroke", async () => {
    const probe = await mountProbe("a");
    await probe.set("ab");
    expect(probe.current()).toBe("a"); // not yet - still inside the 150 ms window
    await act(async () => { await wait(180); });
    expect(probe.current()).toBe("ab");
    await probe.unmount();
  });

  test("latest keystroke wins: three fast edits settle on the last one, never an intermediate value", async () => {
    // The window's own timers run on a clock this test moves, so a slow machine cannot let one fire early.
    const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
    const held = new Map<unknown, { at: number; run: () => void }>();
    let now = 0;
    globalThis.setTimeout = ((run: () => void, ms?: number) => {
      if (ms !== 150) return real.set(run, ms);
      const id = {};
      held.set(id, { at: now + ms, run });
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id: unknown) => { if (!held.delete(id)) real.clear(id as Parameters<typeof clearTimeout>[0]); }) as typeof clearTimeout;
    const pass = (ms: number) => act(async () => {
      now += ms;
      for (const [id, timer] of [...held]) if (timer.at <= now) { held.delete(id); timer.run(); }
    });
    try {
      const probe = await mountProbe("");
      await probe.set("a");
      await pass(40);
      await probe.set("ab");
      await pass(40);
      await probe.set("abc");
      // Only 80 ms of the 150 ms window has elapsed for "abc"; the "a" and "ab" timers were each
      // superseded before they could fire.
      await pass(140);
      expect(probe.current()).toBe("");
      await pass(10);
      expect(probe.current()).toBe("abc");
      await probe.unmount();
    } finally {
      globalThis.setTimeout = real.set;
      globalThis.clearTimeout = real.clear;
    }
  });

  test("clearing to empty applies immediately, not after 150 ms", async () => {
    const probe = await mountProbe("abc");
    await act(async () => { await wait(170); });
    expect(probe.current()).toBe("abc");
    await probe.set("");
    expect(probe.current()).toBe("");
    await probe.unmount();
  });

  test("clearing then typing again does not revive the previous filter", async () => {
    const probe = await mountProbe("Alice");
    await act(async () => { await wait(170); });
    await probe.set("");
    expect(probe.current()).toBe("");
    await probe.set("B");
    expect(probe.current()).toBe("");
    await act(async () => { await wait(170); });
    expect(probe.current()).toBe("B");
    await probe.unmount();
  });
});
