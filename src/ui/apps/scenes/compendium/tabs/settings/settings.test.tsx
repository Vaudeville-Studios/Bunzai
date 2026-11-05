/**
 * The Compendium Settings tab as it mounts (index.tsx): showing it writes nothing, every drawn row sends the patch the engine's resolver reads back
 * (so what is shown is what recall uses, 04b F10), books start read only and a grant of write is one click, "Make a book for this scene" is one
 * guarded sequence, and a refused save is said in the status line. Typing is not simulated (see scene-preset-wing.test.tsx's header): a field's real
 * onChange is called straight off its React props.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../../../../app-contract";
import type { SceneLoreBook } from "../../../../../app-contract-scenes";
import { resolveCompendium } from "../../../../../../core/compendium/defaults";
import type { GuideRecord } from "../../../../../../core/guide-record";
import type { Chat, ChatCompendiumPatch } from "../../../../../../stage/contracts/chat-store";
import { installDom, type InstalledDom } from "../../../../../_shared/test-dom";
import { accessChange } from "./books";


let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { observers: true,
    url: "http://127.0.0.1:8321/", pretendToBeVisual: true,
    extraGlobals: ["HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "SVGElement", "Event", "CustomEvent"],
    boundGlobals: ["getComputedStyle"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) },
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
});
afterAll(() => installed.teardown());

const guide = (id: string, over: Partial<GuideRecord> = {}): GuideRecord => ({ id, title: id, content: `text ${id}`, type: "guide", category: "situational", role: "user", mode: "standard", depth: null, target: null, side: null, visible: true, createdAt: 1, updatedAt: 1, ...over });
const book = (id: string, over: Partial<SceneLoreBook> = {}): SceneLoreBook => ({ id, name: `Book ${id}`, source: "scene", addedByScene: true, enabled: true, missing: false, entries: 12, tokens: 300, ...over });
const chatWith = (compendium?: Chat["compendium"]): Chat => ({ id: "chat1", title: "Night", cast: { character: { id: "c1", version: 1, name: "Char" } }, activeBranchId: "b1", createdAt: 0, updatedAt: 0, snapshotVersion: 1, connection: { id: "k1", model: "m-own" }, ...(compendium ? { compendium } : {}) }) as Chat;

let books: SceneLoreBook[] = [];
let patches: ChatCompendiumPatch[] = [];
let loreWrites: unknown[] = [];
let saves: unknown[] = [];
let statuses: string[] = [];
let changed: Chat[] = [];
let refuse = false;
let library: GuideRecord[] = [];
beforeEach(() => { installed.reinstall(); reverts = []; held = {}; books = [book("b1"), book("b2", { enabled: false })]; patches = []; loreWrites = []; saves = []; statuses = []; changed = []; refuse = false; library = [guide("g1", { title: "Slow burn" }), guide("g2", { title: "Hidden", visible: false }), guide("fix", { type: "correction", title: "Fixer" })]; });

const ctx = (): AppContext => ({
  api: {
    listGuides: async () => library,
    getCompendiumTree: async () => ({ tree: null }),
    getCompendiumIngest: async () => ({ total: 0, run: null }),
    getLightEditableEntity: async () => { throw new Error("no book"); },
    getSceneLore: async () => ({ books, lastTurn: null }),
    setSceneLore: async (_id: string, choice: unknown) => { loreWrites.push(choice); return { books, lastTurn: null }; },
    sceneConnections: async () => [{ id: "k1", kind: "openai", label: "Harbor", model: "m-own" }],
    connectionModels: async () => ({ models: [{ id: "m-own" }, { id: "m-tiny", context: 32_000 }], saved: "m-own" }),
    saveEntity: async (e: { id: string; body: { name: string } }) => { saves.push(e.body.name); return { id: "new-book", name: e.body.name, accent: undefined }; },
    standardizeStatus: async () => ({ runs: [], revertable: held }),
    revertStandardize: async (_id: string, bookId: string) => { reverts.push(bookId); held = {}; return { receipts: 1, rewrites: 4, merges: 0, splits: 2, consumed: 1, skipped: [] }; },
    setSceneCompendium: async (_id: string, patch: ChatCompendiumPatch) => { if (refuse) throw new Error("recall.maxEntries is out of range"); patches.push(patch); return chatWith(); },
  },
  prefs: { get: () => undefined, set: () => undefined },
  setStatus: (t: string) => { statuses.push(t); },
} as unknown as AppContext);

let root: Root;
let host: HTMLElement;
type FlushSync = typeof import("react-dom")["flushSync"];
const text = () => host.textContent ?? "";
const buttons = () => [...host.querySelectorAll("button")];
const byLabel = (t: string) => buttons().find((b) => b.getAttribute("aria-label") === t);
const byText = (t: string) => buttons().find((b) => (b.textContent ?? "").trim() === t);
const settle = async (flushSync: FlushSync, ms = 30) => { await new Promise((r) => setTimeout(r, ms)); flushSync(() => undefined); };
let reverts: string[] = [];
let held: Record<string, number> = {};
async function mount(chat: Chat, bookId?: string): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { CompendiumSettingsTab } = await import("./index");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<CompendiumSettingsTab ctx={ctx()} chat={chat} onChat={(c) => changed.push(c)} {...(bookId ? { bookId } : {})} />));
  await settle(flushSync);
  return flushSync;
}
const press = async (flushSync: FlushSync, b: HTMLElement | undefined, ms = 30) => { flushSync(() => b!.click()); await settle(flushSync, ms); };
function typeInto(flushSync: FlushSync, el: Element, value: string): void {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"))!;
  const props = (el as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[key]!;
  flushSync(() => props.onChange({ target: { value } }));
}
const advanced = async (flushSync: FlushSync) => press(flushSync, byText("Advanced"));
/** One Settings card by its title. */
const section = (title: string): Element => [...host.querySelectorAll(".cps-sec")].find((s) => s.querySelector("h3")?.textContent === title)!;

describe("showing the tab", () => {
  test("RoleCall's header, the Essentials sections in order, and not one write for looking", async () => {
    await mount(chatWith());
    expect(text()).toContain("Compendium settings");
    expect(text()).toContain("What Compendium remembers");
    expect([...host.querySelectorAll(".cps-sec > h3")].map((h) => h.textContent)).toEqual(["Compendium", "Model", "Books in this chat", "Before a reply", "After a reply", "Output language"]);
    expect(byText("Essentials")!.getAttribute("aria-pressed")).toBe("true");
    expect(patches).toEqual([]);
    expect(loreWrites).toEqual([]);
    expect(saves).toEqual([]);
    expect(changed).toEqual([]);
  });

  test("Advanced holds the tree choices, Tree building, Retrieval tuning, Narrator lookup, What Compendium may file, Historian, Import chat history, Diagnostics and Standardization defaults, and only those", async () => {
    const flushSync = await mount(chatWith());
    await advanced(flushSync);
    expect([...host.querySelectorAll(".cps-sec > h3")].map((h) => h.textContent)).toEqual(["Tree and entry constraints", "Tree building", "Retrieval tuning", "Narrator lookup", "What Compendium may file", "Historian summaries", "Import chat history", "Diagnostics", "Standardization defaults"]);
    expect(patches).toEqual([]);
  });

  test("an unsaved scene shows the engine's defaults: off, recall on, books read only", async () => {
    const flushSync = await mount(chatWith());
    expect(byLabel("Use Compendium in this scene")!.getAttribute("aria-checked")).toBe("false");
    expect(byLabel("Recall from Compendium")!.getAttribute("aria-checked")).toBe("true");
    expect(byLabel("Use Book b1")!.getAttribute("aria-checked")).toBe("true");
    expect([...host.querySelectorAll(".cps-seg button[aria-pressed=\"true\"]")].map((b) => b.textContent)).toEqual(["Read only", "Read only"]);
    expect(text()).toContain("Compendium Model - uses this scene's model");
    await advanced(flushSync);
    const r = resolveCompendium(undefined).recall;
    const shown = [...section("Retrieval tuning").querySelectorAll(".cps-step output")].map((o) => Number(o.textContent));
    expect(shown).toEqual([r.maxEntries, r.minEntries, r.contextMessages, r.depth]);
    expect([...section("Retrieval tuning").querySelectorAll(".cps-seg button[aria-pressed=\"true\"]")].map((b) => b.textContent)).toEqual(["Names + Taglines", "Unified"]);
  });

  test("what is saved is what is shown, the same values the recall pass resolves", async () => {
    const saved = { on: true, recall: { on: false, maxEntries: 4, minEntries: 2, contextMessages: 50, depth: 7, detail: "preview" as const, bookDisplay: "per_book" as const, guidance: "Favor places.", guide: "g1" } };
    const flushSync = await mount(chatWith(saved));
    expect(byLabel("Use Compendium in this scene")!.getAttribute("aria-checked")).toBe("true");
    expect(byLabel("Recall from Compendium")!.getAttribute("aria-checked")).toBe("false");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Favor places.");
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("g1");
    await advanced(flushSync);
    const r = resolveCompendium(saved).recall;
    expect([...section("Retrieval tuning").querySelectorAll(".cps-step output")].map((o) => Number(o.textContent))).toEqual([r.maxEntries, r.minEntries, r.contextMessages, r.depth]);
    expect([...section("Retrieval tuning").querySelectorAll(".cps-seg button[aria-pressed=\"true\"]")].map((b) => b.textContent)).toEqual(["Names + Taglines + Preview", "Per-Book"]);
  });
});

describe("the rows write one field each", () => {
  test("the master switch and the recall switch", async () => {
    const flushSync = await mount(chatWith());
    await press(flushSync, byLabel("Use Compendium in this scene"));
    await press(flushSync, byLabel("Recall from Compendium"));
    expect(patches).toEqual([{ on: true }, { recall: { on: false } }]);
    expect(changed).toHaveLength(2);
  });

  test("Narrator lookup is one switch, off until chosen, and says when the scene's Narrator Tool Access would keep the tool from the narrator", async () => {
    const flushSync = await mount(chatWith({ on: true }));
    await advanced(flushSync);
    expect(byLabel("Narrator explore tool")!.getAttribute("aria-checked")).toBe("false");
    expect(section("Narrator lookup").textContent).not.toContain("Narrator Tool Access is off");
    await press(flushSync, byLabel("Narrator explore tool"));
    expect(patches).toEqual([{ lookup: true }]);
    const flushHint = await mount(chatWith({ on: true, lookup: true }));
    await advanced(flushHint);
    expect(section("Narrator lookup").textContent).toContain("Narrator Tool Access is off");
    const flushOn = await mount({ ...chatWith({ on: true, lookup: true }), prompting: { toolAccess: true } });
    await advanced(flushOn);
    expect(byLabel("Narrator explore tool")!.getAttribute("aria-checked")).toBe("true");
    expect(section("Narrator lookup").textContent).not.toContain("Narrator Tool Access is off");
  });

  test("the tuning steppers stop at the engine's ranges and send only their own field", async () => {
    const flushSync = await mount(chatWith({ recall: { maxEntries: 30, minEntries: 0 } }));
    await advanced(flushSync);
    expect((byLabel("Max entries to retrieve: one more") as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel("Minimum entries to retrieve: one less") as HTMLButtonElement).disabled).toBe(true);
    await press(flushSync, byLabel("Max entries to retrieve: one less"));
    await press(flushSync, byLabel("Minimum entries to retrieve: one more"));
    await press(flushSync, byLabel("Context messages: one more"));
    await press(flushSync, byLabel("Collapsed depth: one more"));
    expect(patches).toEqual([{ recall: { maxEntries: 29 } }, { recall: { minEntries: 1 } }, { recall: { contextMessages: 21 } }, { recall: { depth: 3 } }]);
  });

  test("entry detail and multi-book display", async () => {
    const flushSync = await mount(chatWith());
    await advanced(flushSync);
    await press(flushSync, byText("Names Only"));
    await press(flushSync, byText("Per-Book"));
    expect(patches).toEqual([{ recall: { detail: "names" } }, { recall: { bookDisplay: "per_book" } }]);
  });

  test("the guidance is saved once typing rests, and clearing it clears the field", async () => {
    const flushSync = await mount(chatWith());
    const ta = host.querySelector("textarea")!;
    typeInto(flushSync, ta, "Favor ");
    typeInto(flushSync, ta, "Favor places.");
    expect(patches).toEqual([]);
    await settle(flushSync, 800);
    expect(patches).toEqual([{ recall: { guidance: "Favor places." } }]);
    typeInto(flushSync, ta, "  ");
    flushSync(() => ta.dispatchEvent(new dom.window.Event("focusout", { bubbles: true })));
    await settle(flushSync, 800);
    expect(patches.at(-1)).toEqual({ recall: { guidance: null } });
  });

  test("the Guide picker lists visible guides only (not corrections), and None clears it", async () => {
    const flushSync = await mount(chatWith({ recall: { guide: "g1" } }));
    const select = host.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["None", "Slow burn"]);
    typeInto(flushSync, select, "");
    await settle(flushSync);
    expect(patches).toEqual([{ recall: { guide: null } }]);
  });

  test("a Guide gone from the library is still named, so the choice is never silently lost", async () => {
    await mount(chatWith({ recall: { guide: "lost" } }));
    expect(([...(host.querySelector("select") as HTMLSelectElement).options]).map((o) => o.textContent)).toContain("A Guide that is no longer in your library");
  });

  test("the model: the scene's own until one is picked, a pick is one patch, and the way back is one click", async () => {
    const flushSync = await mount(chatWith());
    expect(text()).toContain("m-own");
    await press(flushSync, host.querySelector(".bth-pickwrap > [data-control=row]") as HTMLElement);
    await press(flushSync, buttons().find((b) => b.matches(".bth-dlist [data-control=row]") && (b.textContent ?? "").includes("m-tiny")));
    expect(patches).toEqual([{ model: { id: "k1", model: "m-tiny" } }]);
    const again = await mount(chatWith({ model: { id: "k1", model: "m-tiny" } }));
    expect(text()).toContain("Compendium Model");
    await press(again, byText("Use this scene's model"));
    expect(patches.at(-1)).toEqual({ model: null });
  });
});

describe("books", () => {
  test("a grant of write is one click, and Make default appears only for a writable book", async () => {
    const flushSync = await mount(chatWith());
    expect(byText("Make default")).toBeUndefined();
    await press(flushSync, byText("Read and write"));
    expect(patches).toEqual([{ books: { b1: { access: "read_write" } } }]);
  });

  test("Make default and its Clear, and taking write away drops the default with it", async () => {
    const flushSync = await mount(chatWith({ books: { b1: { access: "read_write" } } }));
    await press(flushSync, byText("Make default"));
    expect(patches.at(-1)).toEqual({ writeBook: "b1" });
    await mount(chatWith({ books: { b1: { access: "read_write" } }, writeBook: "b1" }));
    expect(byText("Default write book · Clear")).toBeDefined();
    await press(flushSync, byText("Default write book · Clear"));
    expect(patches.at(-1)).toEqual({ writeBook: null });
    await press(flushSync, buttons().find((b) => b.textContent === "Read only"));
    expect(patches.at(-1)).toEqual({ books: { b1: { access: "read_only" } }, writeBook: null });
  });

  test("the switch is Access off, and back on it is read only again", () => {
    expect(accessChange("b", "off", true)).toEqual({ books: { b: { access: "off" } }, writeBook: null });
    expect(accessChange("b", "read_only", false)).toEqual({ books: { b: { access: "read_only" } } });
    expect(accessChange("b", "read_write", true)).toEqual({ books: { b: { access: "read_write" } } });
  });

  test("a book switched off has no Access row, and one the World wing switched off says it is not read", async () => {
    const flushSync = await mount(chatWith({ books: { b1: { access: "off" } } }));
    expect(byLabel("Use Book b1")!.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelectorAll(".cps-seg")).toHaveLength(1);
    expect(text()).toContain("Switched off in the World wing");
    await press(flushSync, byLabel("Use Book b1"));
    expect(patches).toEqual([{ books: { b1: { access: "read_only" } } }]);
  });

  test("no book attached says so", async () => {
    books = [];
    await mount(chatWith());
    expect(text()).toContain("No lorebook is attached to this scene.");
  });

  test("Make a book for this scene creates the library book, adds it to the scene, grants write and makes it the default; a second click mid-way does nothing", async () => {
    const flushSync = await mount(chatWith());
    const make = byText("Make a book for this scene")!;
    flushSync(() => { make.click(); make.click(); });
    await settle(flushSync, 60);
    expect(saves).toEqual(["Night Compendium"]);
    expect(loreWrites).toHaveLength(1);
    expect((loreWrites[0] as { added: string[] }).added).toContain("new-book");
    expect(patches).toEqual([{ books: { "new-book": { access: "read_write" } }, writeBook: "new-book" }]);
  });
});

describe("a refused save", () => {
  test("is said in the status line with the reason, the page is not thrown at, and the next change still goes", async () => {
    const flushSync = await mount(chatWith());
    refuse = true;
    await press(flushSync, byLabel("Use Compendium in this scene"));
    expect(statuses).toEqual(["could not save the Compendium settings: recall.maxEntries is out of range"]);
    refuse = false;
    await press(flushSync, byLabel("Recall from Compendium"));
    expect(patches).toEqual([{ recall: { on: false } }]);
  });
});

describe("the book bar's access chip", () => {
  async function mountChip(chat: Chat): Promise<FlushSync> {
    const { flushSync } = await import("react-dom");
    const { createRoot } = await import("react-dom/client");
    const { AccessChip } = await import("./access-chip");
    host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root.render(<AccessChip ctx={ctx()} chat={chat} bookId="b1" bookName="Book b1" onChat={(c) => changed.push(c)} />));
    await settle(flushSync);
    return flushSync;
  }

  test("reads Read-Only by default, offers RoleCall's four choices, and a pick is the same patch the Access row sends", async () => {
    const flushSync = await mountChip(chatWith());
    expect(text()).toContain("Read-Only");
    await press(flushSync, host.querySelector(".cp-chipw button") as HTMLElement);
    expect(text()).toContain('AI Access for "Book b1"');
    const labels = ["Read + Write", "Read-Only", "Write-Only", "Disabled"];
    const cards = [...host.querySelectorAll(".cp-chipp [data-control=card]")];
    expect(cards.map((c, i) => (c.textContent ?? "").replace(/^Picked/, "").startsWith(labels[i]!))).toEqual([true, true, true, true]);
    expect(cards.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"]);
    await press(flushSync, buttons().find((b) => b.textContent?.startsWith("Read + Write")));
    expect(patches).toEqual([{ books: { b1: { access: "read_write" } } }]);
  });

  test("Disabled on the default write book takes the default with it", async () => {
    const flushSync = await mountChip(chatWith({ books: { b1: { access: "read_write" } }, writeBook: "b1" }));
    await press(flushSync, host.querySelector(".cp-chipw button") as HTMLElement);
    await press(flushSync, buttons().find((b) => b.textContent?.startsWith("Disabled")));
    expect(patches).toEqual([{ books: { b1: { access: "off" } }, writeBook: null }]);
  });
});

describe("filing rows (After a reply, Output language, What Compendium may file)", () => {
  test("an unsaved scene shows filing on, waiting for the next message, every turn, and every type allowed", async () => {
    const flushSync = await mount(chatWith());
    expect(byLabel("File lasting changes")!.getAttribute("aria-checked")).toBe("true");
    expect((host.querySelector('select[aria-label="When to file"]') as HTMLSelectElement).value).toBe("1");
    expect([...(host.querySelector('select[aria-label="When to file"]') as HTMLSelectElement).options].slice(0, 2).map((o) => o.textContent)).toEqual(["Right away", "On your next message"]);
    expect(host.querySelector('[aria-label="How often (every N of your turns)"] output')!.textContent).toBe("1");
    await advanced(flushSync);
    expect(section("What Compendium may file").querySelectorAll('[role="switch"]')).toHaveLength(11);
    expect([...section("What Compendium may file").querySelectorAll('[role="switch"]')].every((b) => b.getAttribute("aria-checked") === "true")).toBe(true);
    expect(patches).toEqual([]);
  });

  test("each row sends its own field, the one the filing pass resolves", async () => {
    const flushSync = await mount(chatWith());
    await press(flushSync, byLabel("File lasting changes"));
    await press(flushSync, byLabel("How often (every N of your turns): one more"));
    typeInto(flushSync, host.querySelector('select[aria-label="When to file"]')!, "0");
    await settle(flushSync);
    expect(patches).toEqual([{ filing: { on: false } }, { filing: { everyN: 2 } }, { filing: { wait: 0 } }]);
  });

  test("What Compendium may file sends the whole allowed list, and the last one switched off is an empty list, not 'all'", async () => {
    const flushSync = await mount(chatWith({ filing: { allow: ["character"] } }));
    await advanced(flushSync);
    const switches = () => [...section("What Compendium may file").querySelectorAll('[role="switch"]')];
    expect(switches().filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.getAttribute("aria-label"))).toEqual(["Character"]);
    await press(flushSync, byLabel("Location"));
    expect(patches.at(-1)).toEqual({ filing: { allow: ["character", "location"] } });
    await press(flushSync, byLabel("Character"));
    expect(patches.at(-1)).toEqual({ filing: { allow: [] } });
  });

  test("the filing guidance and the Output language are saved once typing rests, and blank clears them", async () => {
    const flushSync = await mount(chatWith({ filing: { guidance: "Track grudges." }, language: "French" }));
    const area = host.querySelector('textarea[aria-label="What should it preserve?"]') as HTMLTextAreaElement;
    expect(area.value).toBe("Track grudges.");
    typeInto(flushSync, area, "");
    typeInto(flushSync, host.querySelector('input[aria-label="Output language"]')!, "German");
    await settle(flushSync, 800);
    expect(patches).toEqual(expect.arrayContaining([{ filing: { guidance: null } }, { language: "German" }]));
  });
});

describe("Standardization defaults (Advanced)", () => {
  test("RoleCall's rows, with its defaults: batch size 5, the Compendium's model, retry once, original content kept and locked on", async () => {
    const flushSync = await mount(chatWith());
    await advanced(flushSync);
    const t = text();
    for (const part of ["Standardization defaults", "Default batch size", "Default model source", "Auto-retry failed entries once", "Preserve original content", "Revert Last Standardization"]) expect(t).toContain(part);
    expect(host.querySelector('[role="group"][aria-label="Default batch size"] output')!.textContent).toBe("5");
    expect(byText("Compendium model")!.getAttribute("aria-pressed")).toBe("true");
    expect(byLabel("Auto-retry failed entries once")!.getAttribute("aria-checked")).toBe("true");
    const keep = byLabel("Preserve original content")!;
    expect([keep.getAttribute("aria-checked"), keep.hasAttribute("disabled")]).toEqual(["true", true]);
    expect(patches).toEqual([]);
  });

  test("each row writes the field the run resolves, five entries at a time for the batch size", async () => {
    const flushSync = await mount(chatWith());
    await advanced(flushSync);
    await press(flushSync, byLabel("Default batch size: one more"));
    await press(flushSync, byText("Narrator"));
    await press(flushSync, byLabel("Auto-retry failed entries once"));
    expect(patches).toEqual([{ standardize: { batchSize: 10 } }, { standardize: { modelSource: "scene" } }, { standardize: { autoRetry: false } }]);
    expect(resolveCompendium({ standardize: { batchSize: 10, modelSource: "scene", autoRetry: false } }).standardize).toMatchObject({ batchSize: 10, modelSource: "scene", autoRetry: false, parallelism: 5, maxRounds: 8 });
  });

  test("Revert Last Standardization acts on the open book, is idle when nothing is held, and says what it restored", async () => {
    const flushSync = await mount(chatWith(), "b1");
    await advanced(flushSync);
    expect(byText("↺ REVERT LAST RUN")!.hasAttribute("disabled")).toBe(true);
    expect(text()).toContain("Nothing from a Standardize run is waiting to be reverted on this book.");
    flushSync(() => root.unmount());
    host.remove();
    held = { b1: 2 };
    const again = await mount(chatWith(), "b1");
    await advanced(again);
    await press(again, byText("↺ REVERT LAST RUN"), 60);
    expect(reverts).toEqual(["b1"]);
    expect(text()).toContain("Reverted: 4 rewrites restored, 2 splits retired, 1 consumed restored.");
    expect(text()).not.toMatch(/deleted/);
  });
});
