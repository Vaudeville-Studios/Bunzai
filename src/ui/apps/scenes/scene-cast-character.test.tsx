/**
 * The Cast wing's Character tab where it follows RoleCall's CharacterPanel past the fields: the Save
 * Draft button, the content rating dial, the Tags card with its Open Tagsheet button, and the Lorebooks
 * section (bundled and added books, the scene's own choice, the full editor). Typing is not simulated
 * (see scene-preset-wing.test.tsx); the handler React attached is called straight off the node.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext, StudioEntitySummary } from "../../app-contract";
import type { SceneLoreBook, SceneLoreChoice } from "../../app-contract-scenes";
import type { OpenScene } from "../../../studio/scenes";
import { installDom, waitFor, type InstalledDom } from "../../_shared/test-dom";

let dom: JSDOM;
let installed: InstalledDom;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { observers: true,
    url: "http://127.0.0.1:8321/", pretendToBeVisual: true,
    extraGlobals: ["HTMLInputElement", "HTMLTextAreaElement", "SVGElement", "Event", "CustomEvent", "Node", "MutationObserver", "KeyboardEvent"],
    boundGlobals: ["getComputedStyle"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) },
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
});
afterAll(() => installed.teardown());

const card = (tags: string[] = ["lighthouse"]) => ({
  schemaVersion: "1", kind: "character", id: "vera",
  body: {
    identity: { name: "Marguerite Vane", description: "Weathered." }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {},
    discovery: { tags, rating: "mature" },
  },
});
const scene = (): OpenScene => ({
  chat: { id: "chat1", title: "Scene", activeBranchId: "b1", createdAt: 0, updatedAt: 0, snapshotVersion: 4, cast: { character: { id: "vera", version: 3, name: "Marguerite Vane" } } },
  snapshot: { character: card() },
  hasPortrait: false, messages: [], messageOffset: 0, messageCount: 0, beforeSeq: null, hasMore: false, userMessageCount: 0, assistantMessageCount: 0,
  lastUserMessageIndex: null, lastAssistantMessageIndex: null, branchVersion: 1, takes: [], latestCardVersion: 3,
}) as unknown as OpenScene;

const book = (id: string, name: string, source: SceneLoreBook["source"], enabled = true): SceneLoreBook => ({ id, name, source, addedByScene: source === "scene", enabled, missing: false, entries: 3, tokens: 90 });
const library: StudioEntitySummary[] = [
  { id: "tides", kind: "lorebook", name: "Tide Tables", version: 1, facts: { lore: { entryCount: 12 } } } as unknown as StudioEntitySummary,
  { id: "mine", kind: "lorebook", name: "Keeper's Notes", version: 1 } as StudioEntitySummary,
];

type Saved = { patch: { head: { body: { discovery?: { tags?: string[]; rating?: string } } } } };
let saves: Saved[] = [];
let loreWrites: SceneLoreChoice[] = [];
let opened: unknown[] = [];
let books: SceneLoreBook[] = [];

beforeEach(() => {
  installed.reinstall();
  while (doc().body.firstChild) doc().body.removeChild(doc().body.firstChild!);
  saves = []; loreWrites = []; opened = [];
  books = [book("lore-a", "Lighthouse Lore", "character"), book("mine", "Keeper's Notes", "scene")];
});

function makeCtx(): AppContext {
  return {
    api: {
      getEditableEntity: async () => ({ entity: card(), revision: "r1" }),
      getEntitySummary: async () => null,
      listEntities: async (kind?: string) => (kind === "lorebook" ? library : []),
      personaStats: async () => ({ messages: 0, scenes: 0, streak: 0 }),
      saveSceneMember: async (s: Saved) => { saves.push(s); return { summary: { revision: "r2", version: 4 }, scene: scene(), applied: true }; },
      getSceneLore: async () => ({ books, lastTurn: null }),
      setSceneLore: async (_chat: string, choice: SceneLoreChoice) => {
        loreWrites.push(choice);
        books = books.filter((b) => b.source !== "scene" || choice.added.includes(b.id));
        for (const id of choice.added) if (!books.some((b) => b.id === id)) books.push(book(id, library.find((l) => l.id === id)?.name ?? id, "scene"));
        books = books.map((b) => ({ ...b, enabled: !choice.off.includes(b.id) }));
        return { books, lastTurn: null };
      },
      uploadAsset: async () => ({ ref: "x", mime: "image/png" }),
      discardAssetUploads: async () => undefined,
    },
    prefs: { get: () => "", set: () => undefined },
    setStatus: () => undefined,
    workbench: { open: (target: unknown) => { opened.push(target); } },
    openApp: () => undefined,
  } as unknown as AppContext;
}

let root: Root | null = null;
let host: HTMLElement;
afterEach(async () => { unmount((await import("react-dom")).flushSync); });
type FlushSync = typeof import("react-dom")["flushSync"];
const doc = (): Document => dom.window.document;
const buttons = (): HTMLButtonElement[] => [...doc().body.querySelectorAll("button")];
const byText = (text: string): HTMLButtonElement | undefined => buttons().find((b) => (b.textContent ?? "").trim() === text);
const byLabel = (label: string): HTMLElement | null => doc().body.querySelector(`[aria-label="${label}"]`);
const has = (text: string): boolean => (doc().body.textContent ?? "").includes(text);
const settle = async (flushSync: FlushSync, ms = 40): Promise<void> => { await new Promise((r) => setTimeout(r, ms)); flushSync(() => undefined); };
async function mount(ctx = makeCtx()): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { CastWing } = await import("./scene-cast-wing");
  host = doc().createElement("div");
  doc().body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(<CastWing ctx={ctx} scene={scene()} busy={false} card={null} onScene={() => undefined} onUpdate={() => undefined} onRevert={() => undefined} />));
  await settle(flushSync, 80);
  return flushSync;
}
function unmount(flushSync: FlushSync): void {
  const current = root;
  root = null;
  try { flushSync(() => current?.unmount()); }
  finally { host?.remove(); }
}
async function press(flushSync: FlushSync, el: HTMLElement | undefined | null, ms = 60): Promise<void> {
  if (!el) throw new Error("nothing to press");
  flushSync(() => el.click());
  await settle(flushSync, ms);
}
function typeInto(flushSync: FlushSync, el: HTMLInputElement, text: string): void {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"))!;
  const onChange = (el as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[key]!.onChange;
  flushSync(() => onChange({ target: { value: text } }));
}
function enter(flushSync: FlushSync, el: HTMLInputElement): void {
  flushSync(() => { el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}

describe("Cast wing: Character tab, RoleCall's footer and dials", () => {
  test("an edit turns Saved into Save Draft, and saving sends the one changed field with the revision it read", async () => {
    const flushSync = await mount();
    expect(byText("Saved")?.disabled).toBe(true);
    await press(flushSync, byText("After Dark"));
    expect(byText("Save Draft")?.disabled).toBe(false);
    await press(flushSync, byText("Save Draft"), 120);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.patch.head.body.discovery).toEqual({ tags: ["lighthouse"], rating: "explicit" });
    expect(byText("Saved")?.disabled).toBe(true);
    unmount(flushSync);
  });

  test("the content rating dial shows RoleCall's three grades with the card's grade pressed", async () => {
    const flushSync = await mount();
    const dial = [...doc().body.querySelectorAll('[aria-label="Content rating"] button')] as HTMLButtonElement[];
    expect(dial.map((b) => (b.textContent ?? "").trim())).toEqual(["All Hours", "Late Night", "After Dark"]);
    expect(dial.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    unmount(flushSync);
  });
});

describe("Cast wing: Character tab, the Tags card", () => {
  test("reads Open Tagsheet with RoleCall's count line and the tags as chips; Open reveals the editor", async () => {
    const flushSync = await mount();
    const open = byText("Open Tagsheet1 tags selected") ?? buttons().find((b) => (b.textContent ?? "").includes("Open Tagsheet"));
    expect(open?.textContent).toContain("1 tags selected");
    expect(doc().body.querySelector(".cw-chips")?.textContent).toContain("lighthouse");
    expect(byLabel("Add a tag")).toBeNull();
    await press(flushSync, open);
    expect(byLabel("Add a tag")).not.toBeNull();
    unmount(flushSync);
  });

  test("adding a tag in the Tagsheet changes only the card's tags", async () => {
    const flushSync = await mount();
    await press(flushSync, buttons().find((b) => (b.textContent ?? "").includes("Open Tagsheet")));
    const input = byLabel("Add a tag") as HTMLInputElement;
    input.value = "storm";
    enter(flushSync, input);
    await settle(flushSync);
    await press(flushSync, byText("Save Draft"), 120);
    expect(saves[0]!.patch.head.body.discovery).toEqual({ tags: ["lighthouse", "storm"], rating: "mature" });
    unmount(flushSync);
  });
});

describe("Cast wing: Character tab, the Lorebooks section", () => {
  test("counts the card's bundled books and the ones this scene added, in RoleCall's words", async () => {
    const flushSync = await mount();
    await waitFor(flushSync, () => has("(1 bundled, 1 added)"), "bundled and added lorebook count");
    expect(has("(1 bundled, 1 added)")).toBe(true);
    expect(has("Creator Recommends")).toBe(true);
    expect(has("Lighthouse Lore")).toBe(true);
    expect(has("Your Added Lorebooks")).toBe(true);
    expect(has("Keeper's Notes")).toBe(true);
    expect(has("Manage bundled lorebooks in the full editor")).toBe(true);
    unmount(flushSync);
  });

  test("switching a bundled book off and removing an added one are the scene's own choice, not a card edit", async () => {
    const ctx = makeCtx();
    const getLore = ctx.api.getSceneLore;
    let releaseLore!: () => void;
    const held = new Promise<void>((resolve) => { releaseLore = resolve; });
    ctx.api.getSceneLore = async (...args) => { await held; return getLore(...args); };
    const flushSync = await mount(ctx);
    releaseLore();
    await press(flushSync, await waitFor(flushSync, () => byLabel("Switch off Lighthouse Lore"), "loaded bundled lorebook switch"));
    expect(loreWrites.at(-1)).toEqual({ added: ["mine"], off: ["lore-a"] });
    await press(flushSync, await waitFor(flushSync, () => byLabel("Remove Keeper's Notes from this scene"), "loaded added lorebook removal"));
    expect(loreWrites.at(-1)).toEqual({ added: [], off: ["lore-a"] });
    expect(byText("Save Draft")).toBeUndefined();
    expect(saves).toHaveLength(0);
    unmount(flushSync);
  });

  test("Add Your Lorebook lists the library and adds the pick to this scene", async () => {
    const flushSync = await mount();
    await press(flushSync, byText("Add Your Lorebook"));
    await press(flushSync, buttons().find((b) => (b.textContent ?? "").includes("Tide Tables")));
    expect(loreWrites.at(-1)).toEqual({ added: ["mine", "tides"], off: [] });
    unmount(flushSync);
  });

  test("Open Full Editor opens the card in the Workbench", async () => {
    const flushSync = await mount();
    await press(flushSync, byText("Open Full Editor"));
    expect(opened).toEqual([{ id: "vera", kind: "character", name: "Marguerite Vane" }]);
    unmount(flushSync);
  });
});
