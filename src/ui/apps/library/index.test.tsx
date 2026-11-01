/**
 * The Library room's loading state (P3b item 3): `entities` used to start at `[]` and the Trash
 * badge at 0, both indistinguishable from a genuinely empty studio before the first read ever
 * answered - so the empty-studio doors (first-landing.tsx's "Every pack starts with a first card.")
 * flashed open on every mount, even a full studio's. Proven here with a controllable
 * `studioInventory()` promise: the doors must not show while it is still pending, must show once it
 * answers with nothing, and must not show when it answers with something.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext, StudioEntitySummary } from "../../app-contract";
import type { MenuTarget } from "../../shell/menus";
import { PieceStore } from "../../_shared/piece-store";
import { installDom, setSurfacePicks, type InstalledDom } from "../../_shared/test-dom";
import { CORE_THEME_APPEARANCE } from "../../shell/theme";


let dom: JSDOM;
let installed: InstalledDom;

/** jsdom has no ResizeObserver; the carousel scroll-position effect (shelves.tsx) only reads box
 * sizes this test never lays out, so a no-op stub is enough to let it mount. */
class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom has no IntersectionObserver either; a card's peek-on-scroll (peek-queue.ts) only needs it
 * to exist, never to actually fire, for this mount to succeed. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  private target: Element | null = null;
  constructor(private readonly callback: IntersectionObserverCallback) { FakeIntersectionObserver.instances.push(this); }
  observe(target: Element): void { this.target = target; }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): never[] { return []; }
  observes(target: Element): boolean { return this.target === target; }
  intersect(): void {
    if (this.target) this.callback([{ target: this.target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8323/",
    pretendToBeVisual: true,
    extraGlobals: ["MutationObserver", "HTMLInputElement", "SVGElement", "Event", "CustomEvent", "DOMParser", "getComputedStyle"],
    globals: {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: FakeResizeObserver,
      IntersectionObserver: FakeIntersectionObserver,
      requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0),
    }
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", {
    configurable: true, get(this: HTMLElement) { return this.className.includes("lrow-cards") ? 1024 : 200; },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", {
    configurable: true, get(this: HTMLElement) { return this.className.includes("lrow-cards") ? 400 : 320; },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
    configurable: true, get(this: HTMLElement) { return this.className.includes("lrow-cards") ? 1024 : 200; },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollWidth", {
    configurable: true, get(this: HTMLElement) { return this.className.includes("lrow-cards") ? 10_000 : 200; },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const width = this.className.includes("lrow-cards") ? 1024 : 200;
      const height = this.className.includes("lrow-cards") ? 400 : 320;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
    },
  });
});
afterAll(() => installed.teardown());
beforeEach(() => { installed.reinstall(); FakeIntersectionObserver.instances = []; });

// -- a bare-minimum AppContext: every `api` call this mount can reach is answered, most of them by
// a harmless default so this file does not have to enumerate every hook's own reads -----------------

/** Anything not explicitly listed below resolves to an empty array - true for every list-shaped
 * route this mount can reach (formats, collections' related lists, etc.) and inert for the rest. */
function makeApi(over: Partial<Record<string, (...args: unknown[]) => unknown>>): AppContext["api"] {
  const fallback = new Map<string, (...args: unknown[]) => Promise<never[]>>();
  const extensions = { list: async () => [] };
  return new Proxy({} as AppContext["api"], {
    get: (_t, prop: string) => {
      if (prop === "extensions") return extensions;
      const listed = over[prop];
      if (listed) return listed;
      let read = fallback.get(prop);
      if (!read) { read = async () => []; fallback.set(prop, read); }
      return read;
    },
  });
}

function makeCtx(opts: {
  studioInventory: () => Promise<{ entities: StudioEntitySummary[]; damaged: never[] }>;
  pieces?: PieceStore;
  listTrash?: () => Promise<unknown[]>;
  listSceneTrash?: () => Promise<unknown[]>;
  getEntity?: () => Promise<unknown>;
  onMenuUse?: (target: MenuTarget) => void;
  prefs?: Record<string, unknown>;
}): AppContext {
  const menuRef = (_element: HTMLElement | null): void => undefined;
  return {
    api: makeApi({
      studioInventory: opts.studioInventory,
      version: async () => ({ version: "0.0.0-test", studioDir: "C:/studio" }),
      formats: async () => [],
      collections: async () => ({ collections: [] }),
      listTrash: opts.listTrash ?? (async () => []),
      listSceneTrash: opts.listSceneTrash ?? (async () => []),
      getEntity: opts.getEntity,
    }),
    pieces: opts.pieces ?? new PieceStore(),
    prefs: { get: (key: string) => opts.prefs?.[key], set: () => undefined },
    appearance: { get: () => CORE_THEME_APPEARANCE, assetUrl: () => undefined, invalidate: () => undefined, refresh: async () => undefined, onChange: () => () => undefined },
    workbench: {
      pieces: () => [],
      active: () => null,
      beside: () => null,
      send: () => undefined,
      open: () => undefined,
      openBeside: () => undefined,
      closeSplit: () => undefined,
      sendMany: () => undefined,
      remove: () => undefined,
      isOpen: () => false,
      setDirty: () => undefined,
      dirty: () => ({}),
      recents: () => ({}),
      focus: () => undefined,
      onChange: () => () => undefined,
    },
    menus: {
      attach: () => () => undefined,
      register: () => () => undefined,
      useContextMenu: (factory: () => MenuTarget) => { opts.onMenuUse?.(factory()); return menuRef; },
    },
    agent: {
      publish: () => undefined,
      current: () => null,
      onChange: () => () => undefined,
    },
    setStatus: () => undefined,
    openApp: () => undefined,
  } as unknown as AppContext;
}

const piece = (id: string): StudioEntitySummary => ({ id, kind: "character", name: id } as StudioEntitySummary);

// -- DOM plumbing, patterned on scenes-list.test.tsx ------------------------------------------------

let root: Root;
let host: HTMLElement;

const bodyText = (): string => host.textContent ?? "";

type FlushSync = typeof import("react-dom")["flushSync"];

async function settle(flushSync: FlushSync, ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
    flushSync(() => undefined);
  });
}

async function mountLibrary(ctx: AppContext): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { default: app } = await import("./index");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  const Component = app.Component;
  await act(async () => { flushSync(() => root.render(<Component ctx={ctx} />)); });
  return flushSync;
}

/** Re-render the mounted Library with a NEW ctx object, standing in for what
 * src/ui/shell/App.tsx's ctx `useMemo` actually does on every shell-store write (a status
 * message, a workbench tab...): a brand-new ctx, same shape, different identity. */
async function rerenderLibrary(ctx: AppContext, flushSync: FlushSync): Promise<void> {
  const { default: app } = await import("./index");
  const Component = app.Component;
  await act(async () => { flushSync(() => root.render(<Component ctx={ctx} />)); });
}

function unmountLibrary(flushSync: FlushSync): void {
  act(() => { flushSync(() => root.unmount()); });
  host.remove();
}

const DOORS_MARKER = "Every pack starts with a first card.";
const LOADING_MARKER = "Opening your library";

describe("Library: the empty-studio doors never show while the first load is still pending", () => {
  test("pending studioInventory: no doors, a quiet loading line instead", async () => {
    let release!: (v: { entities: StudioEntitySummary[]; damaged: never[] }) => void;
    const gate = new Promise<{ entities: StudioEntitySummary[]; damaged: never[] }>((r) => { release = r; });
    const ctx = makeCtx({ studioInventory: () => gate });
    const flushSync = await mountLibrary(ctx);
    await settle(flushSync);

    expect(bodyText()).not.toContain(DOORS_MARKER);
    expect(bodyText()).toContain(LOADING_MARKER);

    release({ entities: [], damaged: [] });
    await settle(flushSync);
    unmountLibrary(flushSync);
  });

  test("resolves to zero pieces and zero trash: the doors DO appear", async () => {
    const ctx = makeCtx({ studioInventory: async () => ({ entities: [], damaged: [] }) });
    const flushSync = await mountLibrary(ctx);
    await settle(flushSync);

    expect(bodyText()).toContain(DOORS_MARKER);
    expect(bodyText()).not.toContain(LOADING_MARKER);
    unmountLibrary(flushSync);
  });

  test("resolves with a piece already in the studio: the doors never appear", async () => {
    const ctx = makeCtx({ studioInventory: async () => ({ entities: [piece("vera")], damaged: [] }) });
    const flushSync = await mountLibrary(ctx);
    await settle(flushSync);

    expect(bodyText()).not.toContain(DOORS_MARKER);
    expect(bodyText()).not.toContain(LOADING_MARKER);
    unmountLibrary(flushSync);
  });

  test("pieces resolve empty but the Trash still holds something: the doors wait for the Trash too", async () => {
    const ctx = makeCtx({
      studioInventory: async () => ({ entities: [], damaged: [] }),
      listTrash: async () => [{ graveId: "g1" }],
    });
    const flushSync = await mountLibrary(ctx);
    await settle(flushSync);

    expect(bodyText()).not.toContain(DOORS_MARKER);
    unmountLibrary(flushSync);
  });
});

test("Library receipt replaces one card and only the latest identity can publish its peek", async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    ...piece(`receipt-${index}`), version: 1, writeId: 1, revision: "rev-1",
  }));
  const pieces = new PieceStore();
  const peekReads: ((value: unknown) => void)[] = [];
  const menuUses: string[] = [];
  const ctx = makeCtx({
    pieces,
    studioInventory: async () => ({ entities: rows, damaged: [] }),
    getEntity: async () => new Promise((resolve) => peekReads.push(resolve)),
    onMenuUse: (target) => {
      if (target.type === "entity") menuUses.push((target.data as StudioEntitySummary).id);
    },
  });
  const flushSync = await mountLibrary(ctx);
  await settle(flushSync);
  const selector = '[data-pick="character:receipt-0"]';
  const card = host.querySelector<HTMLElement>(selector)!;
  expect(card).toBeTruthy();
  expect(menuUses.length).toBeGreaterThan(0);
  expect(menuUses.length).toBeLessThan(30);

  const observerForCard = (): FakeIntersectionObserver =>
    FakeIntersectionObserver.instances.filter((observer) => observer.observes(card)).at(-1)!;
  await act(async () => { observerForCard().intersect(); await Promise.resolve(); });
  await settle(flushSync);
  expect(peekReads).toHaveLength(1);

  const beforeReceipt = menuUses.length;
  await act(async () => {
    pieces.accept({ ...rows[0]!, name: "Receipt updated", version: 2, writeId: 2, revision: "rev-2" });
  });
  await settle(flushSync);
  expect(host.textContent).toContain("Receipt updated");
  expect(menuUses.slice(beforeReceipt)).toEqual(["receipt-0"]);

  await act(async () => { observerForCard().intersect(); await Promise.resolve(); });
  await settle(flushSync);
  expect(peekReads).toHaveLength(2);
  await act(async () => { peekReads[0]!({ body: { identity: { tagline: "old peek" } } }); await Promise.resolve(); });
  await settle(flushSync);
  expect(card.textContent).not.toContain("old peek");
  await act(async () => { peekReads[1]!({ body: { identity: { tagline: "latest peek" } } }); await Promise.resolve(); });
  await settle(flushSync);
  expect(card.textContent).toContain("latest peek");

  await act(async () => {
    pieces.accept({ ...rows[0]!, name: "Locked receipt", version: 3, writeId: 3, revision: "rev-3" });
  });
  await settle(flushSync);
  const lockedCard = host.querySelector<HTMLElement>(selector)!;
  const observerForLockedCard = (): FakeIntersectionObserver =>
    FakeIntersectionObserver.instances.filter((observer) => observer.observes(lockedCard)).at(-1)!;
  await act(async () => { observerForLockedCard().intersect(); await Promise.resolve(); });
  await settle(flushSync);
  expect(peekReads).toHaveLength(3);
  await act(async () => { pieces.setLock("locked"); });
  await act(async () => { peekReads[2]!({ body: { identity: { tagline: "late after lock" } } }); await Promise.resolve(); });
  await settle(flushSync);
  expect(bodyText()).not.toContain("late after lock");

  const readsAtDetach = peekReads.length;
  observerForLockedCard().intersect();
  await Promise.resolve();
  expect(peekReads).toHaveLength(readsAtDetach);
  unmountLibrary(flushSync);
});

describe("Library: R1, the refetch storm - ctx churn alone must not reload", () => {
  test("mount plus 5 ctx rebuilds (a status message, a workbench tab...) still call studioInventory once", async () => {
    let calls = 0;
    const pieces = new PieceStore();
    const studioInventory = async (): Promise<{ entities: StudioEntitySummary[]; damaged: never[] }> => {
      calls++;
      return { entities: [], damaged: [] };
    };

    const flushSync = await mountLibrary(makeCtx({ studioInventory, pieces }));
    await settle(flushSync);
    expect(calls).toBe(1);

    // Five ctx rebuilds with no real studio mutation, exactly what App.tsx's ctx useMemo produces
    // on every shell-store write. None of these should trigger another inventory read.
    for (let i = 0; i < 5; i++) {
      await rerenderLibrary(makeCtx({ studioInventory, pieces }), flushSync);
      await settle(flushSync);
    }

    expect(calls).toBe(1);
    unmountLibrary(flushSync);
  });

  test("trash-panel.tsx's useTrashCount: mount plus 5 ctx rebuilds leave listTrash's own call count unchanged", async () => {
    let trashCalls = 0;
    const pieces = new PieceStore();
    const listTrash = async (): Promise<never[]> => {
      trashCalls++;
      return [];
    };
    const makeC = (): AppContext => makeCtx({ studioInventory: async () => ({ entities: [], damaged: [] }), listTrash, pieces });

    const flushSync = await mountLibrary(makeC());
    // Mount legitimately calls listTrash more than once (reload()'s own trashEmpty check, plus
    // useTrashCount re-asking once `entities` lands) - the point here is not that number, it is
    // that it stops changing once the room has settled. Wait for it to hold still (bounded), not a
    // fixed delay: under a loaded full-suite run the second mount call can land after 50 ms.
    // A single "unchanged since last check" reading is not enough: reload()'s setEntities gives
    // `entities` a fresh identity, which schedules useTrashCount's effect to re-fire - but React
    // defers a passive effect scheduled BY a flushSync'd render to the *next* flush, not the one
    // that committed it. One settle() can therefore sample trashCalls one flush early, declare it
    // stable, and then watch it change on the very next flush. Requiring two consecutive matching
    // readings closes that one-flush gap deterministically instead of guessing at more retries.
    let last = -1;
    let stableStreak = 0;
    for (let i = 0; i < 40 && stableStreak < 2; i++) {
      await settle(flushSync, 50);
      stableStreak = trashCalls === last ? stableStreak + 1 : 0;
      last = trashCalls;
    }
    const baseline = trashCalls;
    expect(baseline).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) {
      await rerenderLibrary(makeC(), flushSync);
      await settle(flushSync);
    }

    expect(trashCalls).toBe(baseline);
    unmountLibrary(flushSync);
  });
});

describe("Library: the shelf layout a theme's library.grid pick opens on", () => {
  const layoutOn = (): string => host.querySelector('.lrail-toggle button[aria-pressed="true"]')?.textContent ?? "";
  const open = async (pick: Parameters<typeof setSurfacePicks>[0], prefs?: Record<string, unknown>): Promise<FlushSync> => {
    setSurfacePicks(pick);
    const flushSync = await mountLibrary(makeCtx({ studioInventory: async () => ({ entities: [piece("vera")], damaged: [] }), prefs }));
    await settle(flushSync);
    return flushSync;
  };
  afterEach(() => setSurfacePicks({}));

  test("no theme and the covers shelf open on the Carousel", async () => {
    for (const pick of [{}, { "library.grid": "covers" } as const]) { const flushSync = await open(pick); expect(layoutOn()).toBe("Carousel"); unmountLibrary(flushSync); }
  });
  test("the slot, wall and catalog shelves open on the Grid", async () => {
    for (const variant of ["inventory-slots", "sticker-wall", "catalog-list"] as const) { const flushSync = await open({ "library.grid": variant }); expect(layoutOn()).toBe("Grid"); unmountLibrary(flushSync); }
  });
  test("the person's own saved layout wins over the theme", async () => {
    const flushSync = await open({ "library.grid": "catalog-list" }, { "library.layout": "carousel" });
    expect(layoutOn()).toBe("Carousel");
    unmountLibrary(flushSync);
  });
  test("a theme picked after the Library mounted re-derives the default instead of freezing the first one", async () => {
    const flushSync = await open({});
    expect(layoutOn()).toBe("Carousel");
    await act(async () => { setSurfacePicks({ "library.grid": "inventory-slots" }); });
    await settle(flushSync);
    expect(layoutOn()).toBe("Grid");
    unmountLibrary(flushSync);
  });
});
