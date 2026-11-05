/**
 * The Scenes list (scenes-list.tsx) as it actually mounts, with a fake api and a fake context-menu
 * registry (captures providers instead of simulating a real right-click, the way scene-lore-wing's
 * tests capture entity calls). Covers the P3 gamified layout: the rail and folder filters, Fan
 * Favorites, folder deletion's confirm, the hero not repeating in the grid, a failed preview never
 * breaking the page, the cut list with Restore, and Select mode's bulk delete.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import type { MenuItem, MenuTarget } from "../../shell/menus";
import type { SceneFolder } from "../../../stage/contracts/chat-store";
import type { SceneGrave, SceneSummary } from "../../../studio/scenes";
import { installDom, setSurfacePicks, waitFor, type InstalledDom } from "../../_shared/test-dom";
import { PieceStore } from "../../_shared/piece-store";


let dom: JSDOM;
let installed: InstalledDom;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8322/",
    pretendToBeVisual: true, observers: true,
    extraGlobals: ["MutationObserver", "HTMLInputElement", "SVGElement", "Event", "CustomEvent"],
    boundGlobals: ["getComputedStyle"],
    globals: {
      requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id),
    }
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { configurable: true, value: 1024 });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", { configurable: true, value: 720 });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, value: 1024 });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains("recent-window") ? 720 : this.classList.contains("recent-row") ? 56 : 320; },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: HTMLElement): DOMRect {
      const height = this.classList.contains("grid") ? 270 : this.classList.contains("recent-window") ? 720 : 320;
      return { x: 0, y: 0, top: 0, left: 0, right: 1024, bottom: height, width: 1024, height, toJSON: () => ({}) } as DOMRect;
    },
  });
});
afterAll(() => installed.teardown());

// -- fixtures ------------------------------------------------------------------------------------

const NOW = Date.now();
const scene = (over: Partial<SceneSummary> & { id: string }): SceneSummary => ({
  title: "Untitled", characterName: "Vera", messageCount: 1, takeCount: 1, activeTake: { name: "main", original: true },
  hasPortrait: false, updatedAt: NOW, createdAt: 0, activeBranchId: "b", snapshotVersion: 1, cast: { character: { id: "vera", version: 1 } },
  ...over,
});

let scenesFixture: SceneSummary[];
let cutFixture: SceneGrave[];
let foldersFixture: (SceneFolder & { count: number })[];

const resetFixtures = (): void => {
  scenesFixture = [
    scene({ id: "s1", title: "The long storm", characterName: "Vera", cast: { character: { id: "vera", version: 1 } }, messageCount: 42, updatedAt: NOW }),
    scene({ id: "s2", title: "Cut the deck", characterName: "Nuit", cast: { character: { id: "nuit", version: 1 } }, messageCount: 18, updatedAt: NOW - 1000, folderId: "f1" }),
    scene({ id: "s3", title: "Older Vera scene", characterName: "Vera", cast: { character: { id: "vera", version: 1 } }, messageCount: 5, updatedAt: NOW - 2000 }),
  ];
  cutFixture = [{ kind: "scene", id: "g1", name: "Ghost story", of: "Vera", messageCount: 3, deletedAt: NOW - 500 }];
  foldersFixture = [{ id: "f1", name: "Main Plot", createdAt: 0, count: 1 }];
};

// -- recording stubs -------------------------------------------------------------------------------

let deleteSceneCalls: string[] = [];
let restoreCalls: { kind: string; id: string }[] = [];
let renameCalls: { id: string; title: string }[] = [];
let favoriteCalls: { id: string; on: boolean }[] = [];
let setFolderCalls: { id: string; folderId: string | null }[] = [];
let createFolderCalls: string[] = [];
let renameFolderCalls: { id: string; name: string }[] = [];
let deleteFolderCalls: string[] = [];
let summaryQueries: string[] = [];
let summaryImpl: (q: string) => Promise<{ ids: string[] }> = async () => ({ ids: [] });
let getSceneTailImpl: (id: string) => Promise<{ id: string; role: "user" | "assistant"; speaker: string; text: string }[]>;
/** Set by a test to stall the NEXT listScenes() call (the background reload a mutation fires):
 * proves a change lands in the grid before that reload answers, not because of it. */
let listScenesGate: Promise<void> | null;

const resetRecorders = (): void => {
  deleteSceneCalls = []; restoreCalls = []; renameCalls = []; favoriteCalls = []; setFolderCalls = [];
  createFolderCalls = []; renameFolderCalls = []; deleteFolderCalls = [];
  getSceneTailImpl = async () => [];
  summaryQueries = []; summaryImpl = async () => ({ ids: [] });
  listScenesGate = null;
};

beforeEach(() => { installed.reinstall(); resetFixtures(); resetRecorders(); });

// -- fake context-menu registry: captures providers instead of a real right-click -------------------

type Provider = (t: MenuTarget) => MenuItem[] | null;
let providers: Map<string, Provider>;

function itemsFor(type: string, data: unknown, label = ""): MenuItem[] {
  const items = providers.get(type)?.({ type, label, data });
  if (!items) throw new Error(`no menu items for ${type}`);
  return items;
}
function pick(type: string, data: unknown, label: string): void {
  itemsFor(type, data, label).find((i) => i.label === label)!.onPick();
}

function makeCtx(statusCalls: string[] = []): AppContext {
  providers = new Map();
  return {
    pieces: new PieceStore(),
    api: {
      listScenes: async () => {
        if (listScenesGate) await listScenesGate;
        return [...scenesFixture].sort((a, b) => b.updatedAt - a.updatedAt);
      },
      listSceneTrash: async () => cutFixture,
      listSceneFolders: async () => foldersFixture,
      deleteScene: async (id: string) => { deleteSceneCalls.push(id); scenesFixture = scenesFixture.filter((s) => s.id !== id); return { deleted: true }; },
      restoreSceneGrave: async (kind: string, id: string) => { restoreCalls.push({ kind, id }); cutFixture = cutFixture.filter((g) => g.id !== id); return {}; },
      renameScene: async (id: string, title: string) => { renameCalls.push({ id, title }); const s = scenesFixture.find((x) => x.id === id); if (s) s.title = title; return s as unknown as { id: string }; },
      setSceneFavorite: async (id: string, on: boolean) => { favoriteCalls.push({ id, on }); const s = scenesFixture.find((x) => x.id === id); if (s) s.favoredAt = on ? Date.now() : undefined; return s as unknown as { id: string }; },
      setSceneFolder: async (id: string, folderId: string | null) => { setFolderCalls.push({ id, folderId: folderId ?? null }); const s = scenesFixture.find((x) => x.id === id); if (s) s.folderId = folderId ?? undefined; return s as unknown as { id: string }; },
      createSceneFolder: async (name: string) => { createFolderCalls.push(name); const f = { id: `f${foldersFixture.length + 1}`, name, createdAt: 0, count: 0 }; foldersFixture = [...foldersFixture, f]; return f; },
      renameSceneFolder: async (id: string, name: string) => { renameFolderCalls.push({ id, name }); const f = foldersFixture.find((x) => x.id === id); if (f) f.name = name; return f; },
      deleteSceneFolder: async (id: string) => { deleteFolderCalls.push(id); foldersFixture = foldersFixture.filter((f) => f.id !== id); return { deleted: true }; },
      getSceneTail: async (id: string) => getSceneTailImpl(id),
      searchSceneSummaries: async (q: string) => { summaryQueries.push(q); return summaryImpl(q); },
      startScene: async (characterId: string) => ({ id: `new-${characterId}` }),
    },
    menus: {
      attach: () => () => undefined,
      register: (type: string, provider: Provider) => { providers.set(type, provider); return () => providers.delete(type); },
      useContextMenu: () => () => undefined,
    },
    prefs: { get: () => undefined, set: () => undefined },
    openApp: () => undefined,
    setStatus: (s: string) => { statusCalls.push(s); },
  } as unknown as AppContext;
}

// -- DOM plumbing ----------------------------------------------------------------------------------

let root: Root;
let host: HTMLElement;

const buttons = (scope: ParentNode = host): HTMLButtonElement[] => [...scope.querySelectorAll("button")];
const byText = (text: string, scope: ParentNode = host): HTMLButtonElement | undefined => buttons(scope).find((b) => (b.textContent ?? "").includes(text));
const bodyText = (scope: ParentNode = host): string => (scope as HTMLElement).textContent ?? "";
const docBody = (): HTMLElement => dom.window.document.body;
/** The Cutting Room skin's confirm button - found by class, never by text, since a "Delete N"
 * selbar button elsewhere on the page also contains the word "Delete". */
const dialogYes = (): HTMLButtonElement => [...docBody().querySelectorAll<HTMLButtonElement>(".scn-cut .row button")].find((b) => b.textContent === "Delete")!;

type FlushSync = typeof import("react-dom")["flushSync"];

async function settle(flushSync: FlushSync, ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  flushSync(() => undefined);
}

async function mountList(ctx: AppContext, onOpen: (id: string) => void = () => undefined): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { ScenesList } = await import("./scenes-list");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<ScenesList ctx={ctx} onOpen={onOpen} />));
  await settle(flushSync);
  return flushSync;
}

function unmountList(flushSync: FlushSync): void {
  flushSync(() => root.unmount());
  host.remove();
}

async function press(flushSync: FlushSync, btn: HTMLButtonElement, ms = 20): Promise<void> {
  flushSync(() => btn.click());
  await settle(flushSync, ms);
}

// -- tests -------------------------------------------------------------------------------------

describe("ScenesList: rail and folder filters", () => {
  test("the rail filters the grid to one character", async () => {
    const flushSync = await mountList(makeCtx());
    const veraTile = buttons().find((b) => b.dataset["part"] === "scenes.cast.tile" && b.getAttribute("aria-label") === "Vera")!;
    await press(flushSync, veraTile);
    // the sidebar's own recent rows never filter by rail - only the main content does.
    const main = bodyText(host.querySelector(".main")!);
    expect(main).toContain("The long storm");
    expect(main).toContain("Older Vera scene");
    expect(main).not.toContain("Cut the deck");
    unmountList(flushSync);
  });

  test("a folder filters the grid", async () => {
    const flushSync = await mountList(makeCtx());
    const folderRow = host.querySelector<HTMLButtonElement>("[data-part='scenes.folder.row']")!;
    await press(flushSync, folderRow);
    const main = bodyText(host.querySelector(".main")!);
    expect(main).toContain("Cut the deck");
    expect(main).not.toContain("The long storm");
    expect(main).not.toContain("Older Vera scene");
    unmountList(flushSync);
  });
});

describe("ScenesList: a search with no match", () => {
  const search = (): HTMLInputElement => host.querySelector<HTMLInputElement>('input[aria-label="Search scenes"]')!;
  const type = (flushSync: FlushSync, value: string): void => {
    const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    flushSync(() => { set.call(search(), value); search().dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };

  test("says nothing matched and Clear search brings every scene back", async () => {
    const flushSync = await mountList(makeCtx());
    type(flushSync, "zzzz");
    await settle(flushSync);
    const empty = host.querySelector('[data-part="scenes.nomatch"]')!;
    expect(empty.textContent).toContain('Nothing matches "zzzz"');
    expect(empty.hasAttribute("data-empty")).toBe(true);
    expect(host.querySelector("[data-part='scenes.hero.open']")).toBeNull();
    await press(flushSync, byText("Clear search")!);
    expect(host.querySelector('[data-part="scenes.nomatch"]')).toBeNull();
    expect(search().value).toBe("");
    expect(bodyText(host.querySelector(".main")!)).toContain("The long storm");
    unmountList(flushSync);
  });

  test("a search that matches shows no empty message", async () => {
    const flushSync = await mountList(makeCtx());
    type(flushSync, "storm");
    await settle(flushSync);
    expect(host.querySelector('[data-part="scenes.nomatch"]')).toBeNull();
    expect(bodyText(host.querySelector(".main")!)).toContain("The long storm");
    unmountList(flushSync);
  });
});

describe("ScenesList: the chat summary on the list", () => {
  const typeIn = (flushSync: FlushSync, value: string): void => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search scenes"]')!;
    flushSync(() => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };
  test("a card previews its scene's summary (a scene without one shows none), and a search also finds scenes by it, asked once the typing pauses and never for a one-letter word", async () => {
    scenesFixture[2] = { ...scenesFixture[2]!, summaryPreview: "They met at the pier." };
    summaryImpl = async () => ({ ids: ["s3"] });
    const flushSync = await mountList(makeCtx());
    expect([...host.querySelectorAll(".sumline")].map((l) => l.textContent)).toEqual(["They met at the pier."]);
    typeIn(flushSync, "a");
    for (const v of ["pier", "pier!", "pier"]) typeIn(flushSync, v);
    await waitFor(flushSync, () => bodyText(host.querySelector(".main")!).includes("Older Vera scene"), "the summary match to show");
    expect(summaryQueries).toEqual(["pier"]);
    const main = bodyText(host.querySelector(".main")!);
    expect(main).toContain("Older Vera scene");
    expect(main).not.toContain("Cut the deck");
    expect(host.querySelector('[data-part="scenes.nomatch"]')).toBeNull();
    unmountList(flushSync);
  });
  test("when the summary search fails the title matches still show and the list says the summaries could not be searched", async () => {
    summaryImpl = async () => { throw new Error("library busy"); };
    const flushSync = await mountList(makeCtx());
    typeIn(flushSync, "storm");
    // the ask goes out 250ms after typing stops; a loaded machine can be late, so wait for the answer rather than for a fixed time
    for (let i = 0; i < 100 && !host.querySelector(".sumfail"); i++) await settle(flushSync, 20);
    expect(bodyText(host.querySelector(".main")!)).toContain("The long storm");
    expect(host.querySelector(".sumfail")?.textContent).toContain("Summaries could not be searched");
    unmountList(flushSync);
  });
});

describe("ScenesList: Fan Favorites", () => {
  test("Add to Fan Favorites calls setSceneFavorite(id, true) and the carousel shows it", async () => {
    const flushSync = await mountList(makeCtx());
    expect(bodyText()).toContain("Star a scene to keep it here.");
    const target = scenesFixture.find((s) => s.id === "s3")!;
    pick("scene", target, "Add to Fan Favorites");
    await settle(flushSync);
    expect(favoriteCalls).toEqual([{ id: "s3", on: true }]);
    expect(bodyText()).not.toContain("Star a scene to keep it here.");
    expect(bodyText()).toContain("Older Vera scene");
    unmountList(flushSync);
  });
});

describe("ScenesList: folders", () => {
  test("deleting a folder confirms first, then calls deleteSceneFolder", async () => {
    const flushSync = await mountList(makeCtx());
    const folder = foldersFixture[0]!;
    pick("scene-folder", folder, "Delete Folder");
    await settle(flushSync);
    expect(deleteFolderCalls).toHaveLength(0);
    expect(bodyText(docBody())).toContain('Delete "Main Plot"?');
    await press(flushSync, dialogYes());
    expect(deleteFolderCalls).toEqual(["f1"]);
    unmountList(flushSync);
  });
});

describe("ScenesList: hero", () => {
  test("the hero scene is not repeated in the grid", async () => {
    const flushSync = await mountList(makeCtx());
    expect(host.querySelector("[data-part='scenes.hero.open']")?.textContent).toContain("The long storm");
    const gridCards = [...host.querySelectorAll(".grid [data-part='scenes.card.open']")];
    expect(gridCards.some((c) => (c.textContent ?? "").includes("The long storm"))).toBe(false);
    unmountList(flushSync);
  });

  test("a sceneTail failure leaves the page usable", async () => {
    getSceneTailImpl = async () => { throw new Error("network down"); };
    const flushSync = await mountList(makeCtx());
    await settle(flushSync, 40);
    expect(host.querySelector("[data-part='scenes.hero.open']")?.textContent).toContain("The long storm");
    expect(bodyText()).toContain("Your Stage");
    unmountList(flushSync);
  });

  // VVS: imported SillyTavern chats leaked <think>/reasoning text into the hero preview panel.
  test("an inline <think> block from an imported ST message never reaches the preview panel", async () => {
    getSceneTailImpl = async () => [
      { id: "m1", role: "assistant", speaker: "Vera", text: "<think>\nplanning the scene\n</think>\n\nShe opened the door." },
    ];
    const flushSync = await mountList(makeCtx());
    await settle(flushSync, 40);
    const preview = host.querySelector("[data-part='scenes.hero.preview']");
    expect(preview?.textContent).toContain("She opened the door.");
    expect(preview?.textContent).not.toContain("planning the scene");
    expect(preview?.textContent).not.toContain("think");
    unmountList(flushSync);
  });
});

describe("ScenesList: the cut list", () => {
  test("still renders with Restore, unchanged from the plain list", async () => {
    const flushSync = await mountList(makeCtx());
    expect(bodyText()).toContain("Cut, back for 3 days");
    expect(bodyText()).toContain("Ghost story");
    const restore = byText("Restore")!;
    await press(flushSync, restore);
    expect(restoreCalls).toEqual([{ kind: "scene", id: "g1" }]);
    unmountList(flushSync);
  });
});

describe("ScenesList: Select mode", () => {
  test("still bulk-deletes through the Cutting Room dialog", async () => {
    const flushSync = await mountList(makeCtx());
    await press(flushSync, byText("Select")!);
    const card = [...host.querySelectorAll(".grid [data-part='scenes.card.open']")].find((c) => (c.textContent ?? "").includes("Cut the deck")) as HTMLButtonElement;
    await press(flushSync, card);
    await press(flushSync, byText("Delete 1")!);
    expect(bodyText(docBody())).toContain("Cut this story?");
    await press(flushSync, dialogYes());
    expect(deleteSceneCalls).toEqual(["s2"]);
    unmountList(flushSync);
  });
});

describe("ScenesList: optimistic updates (P3b item 2)", () => {
  /** After mount, every next listScenes() call (the background reload a mutation fires) hangs
   * until the test releases it - so a change visible before that proves it came from the server's
   * own confirmed answer, applied at once, never from the reload landing. */
  function stallReload(): () => void {
    let release: () => void = () => undefined;
    listScenesGate = new Promise<void>((r) => { release = r; });
    return release;
  }

  test("Delete Story removes the card at once, before the background reload lands", async () => {
    const flushSync = await mountList(makeCtx());
    const target = scenesFixture.find((s) => s.id === "s2")!;
    const release = stallReload();
    pick("scene", target, "Delete Story");
    await settle(flushSync);
    await press(flushSync, dialogYes());
    expect(deleteSceneCalls).toEqual(["s2"]);
    expect(bodyText()).not.toContain("Cut the deck"); // gone before the stalled reload answers
    release();
    await settle(flushSync);
    unmountList(flushSync);
  });

  test("Add to Fan Favorites shows the star at once, before the background reload lands", async () => {
    const flushSync = await mountList(makeCtx());
    const target = scenesFixture.find((s) => s.id === "s3")!;
    const release = stallReload();
    pick("scene", target, "Add to Fan Favorites");
    await settle(flushSync);
    expect(favoriteCalls).toEqual([{ id: "s3", on: true }]);
    expect(bodyText()).not.toContain("Star a scene to keep it here.");
    expect(bodyText()).toContain("Older Vera scene");
    release();
    await settle(flushSync);
    unmountList(flushSync);
  });

  test("Rename Scene retitles the card at once, before the background reload lands", async () => {
    const flushSync = await mountList(makeCtx());
    const target = scenesFixture.find((s) => s.id === "s1")!;
    const release = stallReload();
    pick("scene", target, "Rename Scene");
    await settle(flushSync);
    const input = docBody().querySelector('input[aria-label="Scene title"]') as HTMLInputElement;
    // React tracks an input's previous value on the node itself; a raw `input.value = x` bypasses
    // that tracker, so its onChange never fires unless the native setter is used instead (a known
    // React + jsdom gotcha, not specific to this dialog).
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    flushSync(() => { setValue.call(input, "The longer storm"); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    await press(flushSync, byText("Rename", docBody())!);
    expect(renameCalls).toEqual([{ id: "s1", title: "The longer storm" }]);
    expect(bodyText()).toContain("The longer storm");
    release();
    await settle(flushSync);
    unmountList(flushSync);
  });

  test("Move to folder updates the folder filter at once, before the background reload lands", async () => {
    const flushSync = await mountList(makeCtx());
    const target = scenesFixture.find((s) => s.id === "s1")!; // starts in no folder
    const release = stallReload();
    pick("scene", target, "Move to folder");
    await settle(flushSync);
    // Scoped to the dialog: the sidebar has its own "Main Plot" chapter row with the same text.
    const folderOption = byText("Main Plot", docBody().querySelector(".folder-pick")!)!;
    await press(flushSync, folderOption);
    expect(setFolderCalls).toEqual([{ id: "s1", folderId: "f1" }]);
    const folderRow = host.querySelector<HTMLButtonElement>("[data-part='scenes.folder.row']")!;
    await press(flushSync, folderRow);
    const main = bodyText(host.querySelector(".main")!);
    expect(main).toContain("The long storm"); // now shows under its new folder, before the reload
    release();
    await settle(flushSync);
    unmountList(flushSync);
  });
});

describe("ScenesList: the row a theme's scenes.list pick draws", () => {
  const withPick = async (pick: Parameters<typeof setSurfacePicks>[0], prefs?: string): Promise<FlushSync> => {
    setSurfacePicks(pick);
    const ctx = makeCtx();
    if (prefs) (ctx as unknown as { prefs: { get(k: string): unknown } }).prefs = { get: () => prefs };
    return mountList(ctx);
  };
  afterEach(() => setSurfacePicks({}));

  for (const variant of ["save-file-slots", "chat-list", "table-of-contents"] as const) {
    test(`${variant}: opens as a list, every scene keeps its title, character, count, open and menu controls`, async () => {
      const flushSync = await withPick({ "scenes.list": variant });
      const rows = [...host.querySelectorAll(".scene-list .scene-entry")];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.querySelector("button[data-part='scenes.card.open']")).not.toBeNull();
        expect(row.querySelector(".scene-more")).not.toBeNull();
        expect(row.querySelector(".art")).toBeNull(); // the picture body is replaced, not stacked
      }
      const list = host.querySelector(".scene-list")!;
      expect(bodyText(list).match(/msgs?/) !== null || list.querySelector('[aria-label$="messages"]') !== null).toBe(true);
      unmountList(flushSync);
    });
  }

  test("the marquee-hero pick and no pick keep the picture cards", async () => {
    for (const pick of [{}, { "scenes.list": "marquee-hero" } as const]) {
      const flushSync = await withPick(pick);
      expect(host.querySelector(".scene-list")).toBeNull();
      expect(host.querySelector(".grid [data-part='scenes.card.open'] .art")).not.toBeNull();
      unmountList(flushSync);
    }
  });

  test("the person's own Pictures choice beats the theme's list", async () => {
    const flushSync = await withPick({ "scenes.list": "chat-list" }, "cards");
    expect(host.querySelector(".scene-list")).toBeNull();
    unmountList(flushSync);
  });
});
