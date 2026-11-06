/**
 * The Messenger Lorebooks panel from the fake scene the Full Chat wing's tests use (fake-lore-rig.ts): each control calls the wing's own writer with the right arguments (the scene's
 * choice through setSceneLore, entry edits through patchEditedEntity as a send-only-changed patch), and what the maps mark missing or sample is not drawn.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { LorebookEntry } from "../../../../../../entities/lorebook/schema";
import {
  BOOKS, byLabel, byText, CHAT, entry, bodyOf, heldBody, heldEntry, installLoreDom, loreCtx, press, q, qa, rig, resetLore, settle, text, typeInto, unmount, waitFor, type FlushSync,
} from "../../../fake-lore-rig";

beforeAll(installLoreDom);
afterAll(() => rig.installed?.teardown());
beforeEach(() => resetLore());

async function mountPanel(): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { LorePanel } = await import("./lore-panel");
  rig.host = rig.dom.window.document.createElement("div");
  rig.host.className = "scs";
  rig.dom.window.document.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  flushSync(() => rig.root.render(createElement(LorePanel, { ctx: loreCtx(), chat: CHAT, characterName: "Marguerite Vane", onLore: () => undefined })));
  await settle(flushSync);
  await waitFor(flushSync, () => q('[data-part="scene.messenger.lore.entries"]'), "the entries view");
  await settle(flushSync);
  return flushSync;
}
const rows = (): string[] => qa('[data-part="scene.messenger.lore.entry"]').map((r) => r.textContent ?? "");
const open = async (fs: FlushSync, title: string): Promise<void> => {
  await press(fs, byText('[data-part="scene.messenger.lore.entry-open"]', title), 20);
  await waitFor(fs, () => q('[data-part="scene.messenger.lore.entry-editor"]'), "the inspector");
};

describe("the entries view", () => {
  test("lists each book that is on under its header, Constant then Selective with type and tokens, and a trigger line under each title", async () => {
    resetLore([entry("b", { title: "Selective one", sortOrder: 1 }), entry("a", { title: "Always on", constant: true, triggers: [], sortOrder: 5 })]);
    const fs = await mountPanel();
    expect(rig.loads).toEqual(["b1", "b2"]);
    expect(text()).toContain("2 active · 23 entries");
    expect(rows().map((r) => r.replace(/\d+$/, ""))).toEqual(["Always onAlways onConstant~", "Selective onestormSelective~"]);
    expect(text()).toContain("Keeper's Log");
    expect(text()).toContain("Active");
    expect(byLabel("New entry")).toBeNull();
    expect(byText("button", "New entry")).toBeDefined();
    unmount(fs);
  });

  test("a selective entry with no keywords says so under its title", async () => {
    resetLore([entry("n", { title: "Bare", triggers: [] })]);
    const fs = await mountPanel();
    expect(rows()[0]).toContain("No triggers");
    unmount(fs);
  });

  test("the book header's switch turns the open book off through the scene writer and keeps the book listed", async () => {
    const fs = await mountPanel();
    await press(fs, byLabel("Switch off Keeper's Log"));
    expect(rig.setLore.at(-1)).toEqual({ chatId: "chat1", lore: { added: ["b2"], off: ["b3", "b1"] } });
    expect(q('[data-part="scene.messenger.lore.book-head"]')?.textContent).toContain("Keeper's Log");
    unmount(fs);
  });

  test("a row's switch disables the entry with a manual save, and the saved patch is only that entry", async () => {
    const fs = await mountPanel();
    await press(fs, byLabel("Disable The storm"), 60);
    expect(rig.patches).toHaveLength(1);
    expect(rig.patches[0]!.intent).toBe("manual");
    expect(heldEntry("key1").enabled).toBe(false);
    expect(heldEntry("always1").enabled).toBe(true);
    unmount(fs);
  });

  test("Move up and Move down swap sort orders inside the group, and the ends are disabled", async () => {
    resetLore([entry("s1", { title: "First", sortOrder: 1 }), entry("s2", { title: "Second", sortOrder: 2 })]);
    const fs = await mountPanel();
    expect(byLabel("Move First up")!.hasAttribute("disabled")).toBe(true);
    expect(byLabel("Move Second down")!.hasAttribute("disabled")).toBe(true);
    await press(fs, byLabel("Move First down"), 60);
    expect([heldEntry("s1").sortOrder, heldEntry("s2").sortOrder]).toEqual([2, 1]);
    unmount(fs);
  });

  test("Open full editor hands this entry to the Workbench", async () => {
    const fs = await mountPanel();
    await press(fs, byLabel("Open The storm in the full editor"));
    expect(rig.opened).toEqual([{ id: "b1", kind: "lorebook", name: "Keeper's Log", params: { focusEntry: "key1" } }]);
    unmount(fs);
  });

  test("right click opens the entry menu with the same actions", async () => {
    const fs = await mountPanel();
    const row = q('[data-part="scene.messenger.lore.entry"]')!;
    fs(() => (row as unknown as Record<string, Record<string, (e: unknown) => void>>)[Object.keys(row).find((k) => k.startsWith("__reactProps$"))!]!["onContextMenu"]!({ preventDefault: () => undefined, clientX: 10, clientY: 10 }));
    await settle(fs);
    expect(qa('[role="menuitem"]').map((m) => m.textContent)).toEqual(["Open and edit", "Open full editorWorkbench", "Delete entry"]);
    unmount(fs);
  });

  test("Delete asks first: Keep entry sends nothing, Delete this entry removes it with one patch", async () => {
    const fs = await mountPanel();
    await press(fs, byLabel("Delete The storm"));
    expect(text()).toContain("Delete this entry?");
    expect(rig.patches).toHaveLength(0);
    await press(fs, byText("button", "Keep entry"));
    expect(text()).not.toContain("Delete this entry?");
    expect(rig.patches).toHaveLength(0);
    await press(fs, byLabel("Delete The storm"));
    await press(fs, byText("button", "Delete this entry"), 60);
    expect(heldBody().entries.map((e) => e.id)).toEqual(["always1"]);
    unmount(fs);
  });

  test("New entry adds a selective entry at depth 4 and opens it", async () => {
    const fs = await mountPanel();
    await press(fs, byText("button", "New entry"), 60);
    expect(heldBody().entries).toHaveLength(3);
    expect(heldBody().entries.at(-1)).toMatchObject({ title: "New Entry", position: "depth", depth: 4, constant: false });
    expect(q('[data-part="scene.messenger.lore.entry-editor"]')).not.toBeNull();
    unmount(fs);
  });

  test("a fired entry shows why it fired under its title", async () => {
    rig.lastTurn = { fired: [{ bookId: "b1", entryId: "key1", title: "The storm", reason: "key", matched: ["storm"], tokens: 5, cut: false }], totalTokens: 5 };
    const fs = await mountPanel();
    expect(rows().find((r) => r.includes("The storm"))).toContain('"storm"');
    expect(text()).toContain("Last turn: 1 fired · ~5 tok");
    unmount(fs);
  });

  test("a 500-entry book mounts only the rows near the viewport, not all of them", async () => {
    resetLore(Array.from({ length: 500 }, (_, i) => entry(`e${i}`, { title: `Entry ${i}`, sortOrder: i })));
    const fs = await mountPanel();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThan(60);
    unmount(fs);
  });

  test("search narrows the list and offers Clear search when nothing matches", async () => {
    const fs = await mountPanel();
    typeInto(fs, q('input[type="search"]'), "nothing like this");
    await settle(fs);
    expect(text()).toContain("No matching entries");
    await press(fs, byText("button", "Clear search"));
    expect(rows()).toHaveLength(2);
    unmount(fs);
  });
});

/** The library holds a second book (b2, "The Drowned Coast") at its own revision, so two books can be edited side by side. */
function holdDrowned(entries: LorebookEntry[], revision = 5): void {
  rig.held.set("b2", { entity: { kind: "lorebook", id: "b2", body: bodyOf("The Drowned Coast", entries) }, revision });
}
const heads = (): string[] => qa('[data-part="scene.messenger.lore.book-head"]').map((h) => h.textContent ?? "");

describe("every active book in one list", () => {
  test("groups the entries of each book that is on under its own header, and a book that is off keeps a header without loading", async () => {
    holdDrowned([entry("t1", { title: "Tide table", sortOrder: 1 })]);
    const fs = await mountPanel();
    await waitFor(fs, () => rows().length === 3, "both open books' entries");
    expect(heads().map((h) => /^[^0-9]+/.exec(h)![0])).toEqual(["Keeper's Log", "The Drowned Coast", "My quirks"]);
    expect(rows().map((r) => r.slice(0, 8))).toEqual(["always1A", "The stor", "Tide tab"]);
    expect(rig.loads).toEqual(["b1", "b2"]);
    expect(byLabel("Switch on My quirks")).not.toBeNull();
    unmount(fs);
  });

  test("a switch on a row of the second book saves that library book against its own revision and leaves the first untouched", async () => {
    holdDrowned([entry("t1", { title: "Tide table" })], 5);
    const fs = await mountPanel();
    await press(fs, byLabel("Disable Tide table"), 60);
    expect(rig.patches.map((p) => [p.id, p.revision, p.intent])).toEqual([["b2", "r5", "manual"]]);
    expect(heldEntry("t1", "b2").enabled).toBe(false);
    expect(heldBody("b1").entries.every((e) => e.enabled)).toBe(true);
    unmount(fs);
  });

  test("two books edited while a save is still in flight each land with their own revision and neither overwrites the other", async () => {
    holdDrowned([entry("t1", { title: "Tide table" })], 5);
    const fs = await mountPanel();
    let release = (): void => undefined;
    rig.gate = new Promise<void>((r) => { release = r; });
    await press(fs, byLabel("Disable The storm"), 10);
    await press(fs, byLabel("Disable Tide table"), 10);
    await press(fs, byLabel("Disable always1"), 10);
    expect(rig.patches).toHaveLength(0);
    release();
    await waitFor(fs, () => rig.patches.length === 3, "all three saves");
    expect(rig.patches.map((p) => [p.id, p.revision])).toEqual([["b1", "r1"], ["b2", "r5"], ["b1", "r2"]]);
    expect(heldEntry("key1").enabled).toBe(false);
    expect(heldEntry("t1", "b2").enabled).toBe(false);
    expect(rig.statuses).toEqual([]);
    unmount(fs);
  });

  test("opening an entry of the second book shows that book in the inspector, and the typed edit saves into it", async () => {
    holdDrowned([entry("t1", { title: "Tide table" })]);
    const fs = await mountPanel();
    await open(fs, "Tide table");
    expect(text()).toMatch(/The Drowned Coast · entry 1 of 1/);
    typeInto(fs, byLabel("Entry title"), "Tide tables");
    await press(fs, byLabel("Back to entries"), 60);
    expect(rig.patches.map((p) => [p.id, p.intent])).toEqual([["b2", "autosave"]]);
    expect(heldEntry("t1", "b2").title).toBe("Tide tables");
    expect(q('[data-part="scene.messenger.lore"]')!.getAttribute("data-view")).toBe("list");
    expect(rows().some((r) => r.includes("Tide tables"))).toBe(true);
    unmount(fs);
  });

  test("a header's add button puts a new entry in that book and opens it", async () => {
    holdDrowned([entry("t1", { title: "Tide table" })]);
    const fs = await mountPanel();
    await press(fs, byLabel("Add an entry to The Drowned Coast"), 60);
    expect(heldBody("b2").entries).toHaveLength(2);
    expect(heldBody("b1").entries).toHaveLength(2);
    expect(rig.patches.map((p) => p.id)).toEqual(["b2"]);
    expect(text()).toContain("The Drowned Coast · entry");
    unmount(fs);
  });

  test("folding a book hides its rows only, and search reaches every book", async () => {
    holdDrowned([entry("t1", { title: "Tide table" })]);
    const fs = await mountPanel();
    await press(fs, byLabel("Collapse Keeper's Log"));
    expect(rows()).toHaveLength(1);
    await press(fs, byLabel("Expand Keeper's Log"));
    typeInto(fs, q('input[type="search"]'), "tide");
    await settle(fs);
    expect(rows()).toHaveLength(1);
    expect(heads()).toHaveLength(3);
    unmount(fs);
  });

  test("a book the library no longer has says so under its own header while the others still list", async () => {
    const fs = await mountPanel();
    expect(text()).toContain("This book is no longer in your library.");
    expect(rows()).toHaveLength(2);
    unmount(fs);
  });

  test("two long books mount only the rows near the viewport", async () => {
    resetLore(Array.from({ length: 400 }, (_, i) => entry(`k${i}`, { title: `Key ${i}`, sortOrder: i })));
    holdDrowned(Array.from({ length: 400 }, (_, i) => entry(`d${i}`, { title: `Drown ${i}`, sortOrder: i })));
    const fs = await mountPanel();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThan(60);
    unmount(fs);
  });
});

describe("the entry inspector", () => {
  test("opens with the book and token cost, saves a typed edit when Back is pressed, and draws nothing the maps call missing", async () => {
    const fs = await mountPanel();
    await open(fs, "The storm");
    expect(q('[data-part="scene.messenger.lore"]')!.getAttribute("data-view")).toBe("entry");
    expect(text()).toMatch(/Keeper's Log · entry 2 of 2 · \d+ tokens/);
    expect(text()).not.toContain("Keywords");
    expect(text()).not.toContain("World");
    typeInto(fs, byLabel("Entry title"), "The big storm");
    expect(rig.patches).toHaveLength(0);
    await press(fs, byLabel("Back to entries"), 60);
    expect(rig.patches).toHaveLength(1);
    expect(rig.patches[0]!.intent).toBe("autosave");
    expect(heldEntry("key1").title).toBe("The big storm");
    expect(q('[data-part="scene.messenger.lore"]')!.getAttribute("data-view")).toBe("list");
    unmount(fs);
  });

  test("Enabled, Entry type, probability and Preserve each patch their own field", async () => {
    const fs = await mountPanel();
    await open(fs, "The storm");
    await press(fs, q('[data-part="scene.messenger.lore.enabled"]'));
    await press(fs, byText('[aria-label="Entry type"] button', "Constant"));
    typeInto(fs, byLabel("Entry probability"), "40");
    await press(fs, byLabel("Preserve during standardization"));
    await press(fs, byLabel("Back to entries"), 60);
    expect(heldEntry("key1")).toMatchObject({ enabled: false, constant: true, probability: 40 });
    expect(heldEntry("key1").metadata?.["preserve_during_standardize"]).toBe(true);
    unmount(fs);
  });

  test("a selective entry shows secondary triggers and the selective logic choice; a constant one does not", async () => {
    const fs = await mountPanel();
    await open(fs, "The storm");
    expect(byLabel("Selective logic")).not.toBeNull();
    await press(fs, byText('[aria-label="Entry type"] button', "Constant"));
    expect(byLabel("Selective logic")).toBeNull();
    unmount(fs);
  });

  test("the Advanced tab turns the shared advanced pref on and draws the real cards, Timing writing sticky", async () => {
    const fs = await mountPanel();
    await open(fs, "The storm");
    await press(fs, byText('[role="tab"]', "Advanced"));
    expect(rig.prefs.get("scenes.loreAdvanced")).toBe(true);
    expect(qa(".msn-lore-card").map((c) => c.getAttribute("aria-label"))).toEqual(["Trigger mode", "Injection", "Timing", "Recursion and cross-entry boosting", "Group", "Character filter", "Side effects"]);
    expect(text()).not.toContain("Scope");
    expect(text()).not.toContain("Prepend");
    typeInto(fs, byLabel("Sticky messages"), "3");
    await press(fs, byLabel("Back to entries"), 60);
    expect(heldEntry("key1").sticky).toBe(3);
    unmount(fs);
  });

  test("Delete entry in the inspector asks first, then removes the entry and returns to the list", async () => {
    const fs = await mountPanel();
    await open(fs, "The storm");
    await press(fs, byText("button", "Delete entry"));
    expect(rig.patches).toHaveLength(0);
    await press(fs, byText("button", "Delete this entry"), 60);
    expect(heldBody().entries.map((e) => e.id)).toEqual(["always1"]);
    expect(q('[data-part="scene.messenger.lore"]')!.getAttribute("data-view")).toBe("list");
    unmount(fs);
  });
});

describe("the book manager", () => {
  const openManager = async (fs: FlushSync): Promise<void> => {
    await press(fs, byLabel("Browse and add lorebooks"));
    await waitFor(fs, () => q('[data-part="scene.messenger.lore.books"]'), "the manager");
  };

  test("lists the scene's books with fired counts, switches one off through the scene writer, and removes only books the scene added", async () => {
    rig.lastTurn = { fired: [{ bookId: "b1", entryId: "key1", title: "The storm", reason: "key", matched: ["storm"], tokens: 5, cut: false }], totalTokens: 5 };
    const fs = await mountPanel();
    await openManager(fs);
    expect(text()).toContain("This scene only");
    expect(text()).toContain("2 entries · 1 fired last turn · From Marguerite Vane");
    expect(qa('[data-part="scene.messenger.lore.book-remove"]').map((b) => b.getAttribute("aria-label"))).toEqual(["Remove The Drowned Coast from this scene"]);
    await press(fs, byLabel("Enable My quirks"));
    await press(fs, byLabel("Disable Keeper's Log"));
    expect(rig.setLore.at(-1)).toEqual({ chatId: "chat1", lore: { added: ["b2"], off: ["b1"] } });
    await press(fs, byLabel("Remove The Drowned Coast from this scene"));
    expect(rig.setLore.at(-1)!.lore!.added).toEqual([]);
    unmount(fs);
  });

  test("adding from the library and creating a new book both go through the scene writer", async () => {
    const fs = await mountPanel();
    await openManager(fs);
    await press(fs, byText('[data-part="scene.lore.book-row"]', "Sea Reckoning"), 60);
    expect(rig.setLore.at(-1)!.lore!.added).toContain("b4");
    await openManager(fs);
    typeInto(fs, byLabel("New lorebook name"), "Tide tables");
    await press(fs, byText("button", "Create"), 60);
    expect(rig.created).toEqual(["Tide tables"]);
    expect(rig.setLore.at(-1)!.lore!.added).toContain("newbook1");
    unmount(fs);
  });

  test("opening a book from the manager returns to its entries; Back returns without a change", async () => {
    const fs = await mountPanel();
    await openManager(fs);
    await press(fs, byLabel("Back to lorebooks"));
    expect(q('[data-part="scene.messenger.lore.entries"]')).not.toBeNull();
    expect(rig.setLore).toHaveLength(0);
    await openManager(fs);
    await press(fs, byText('[data-part="scene.messenger.lore.book-open"]', "Keeper's Log"), 40);
    expect(q('[data-part="scene.messenger.lore.entries"]')).not.toBeNull();
    unmount(fs);
  });

  test("with no books the list says so and offers Add a lorebook", async () => {
    rig.books = [];
    const fs = await mountPanel();
    expect(text()).toContain("No lorebooks");
    await press(fs, byText("button", "Add a lorebook"));
    await waitFor(fs, () => q('[data-part="scene.messenger.lore.books"]'), "the manager");
    expect(BOOKS).toHaveLength(3);
    unmount(fs);
  });
});
