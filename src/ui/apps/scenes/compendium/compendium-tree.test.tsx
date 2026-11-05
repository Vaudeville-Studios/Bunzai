/**
 * Shaping the Compendium's tree by hand and with the model (04b D3, RoleCall `NodeConstraintMenu`, `EntryPickerModal`,
 * `TreeFirstView` drag, the header's Tree maintenance, Settings > Tree building and Tree and entry constraints): a stored layout is
 * the TV Tree, a right-click gives Lock, Forbid, Reorganize (and Move to... on an entry) and each saves one field of the scene's
 * choices, a drag files an entry under a branch only when a tree is built, Repair tree from entries and Undo last build go through the
 * server, and the Settings list names what is saved and clears it. Typing is not simulated: handlers are called off React's props.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement, useState, type JSX } from "react";
import type { AppContext } from "../../../app-contract";
import type { SceneLoreBook } from "../../../app-contract-scenes";
import type { Chat, ChatCompendiumPatch, StoredLayout, StoredTree } from "../../../../stage/contracts/chat-store";
import { checkCompendium, mergeCompendium } from "../../../../stage/store/compendium-rules";
import { emptyLoreEntry } from "../../../../core/lore/empty-book";
import type { LorebookEntry } from "../../../../entities/lorebook/schema";
import { teardownAllDoms } from "../../../_shared/test-dom";
import { CHAT, bodyOf, installLoreDom, press, props, q, qa, rig, settle, text, waitFor, type FlushSync } from "../fake-lore-rig";
import { CompendiumWing } from "./compendium-wing";
import { CompendiumSettingsTab } from "./tabs/settings";

const BOOK: SceneLoreBook = { id: "b1", name: "The Drowned Coast", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 4, tokens: 0 };
const entries: LorebookEntry[] = ["Alder", "Birch", "Cedar", "Dogwood"].map((t, i) => ({ ...emptyLoreEntry(`e${i}`), title: t, content: `${t}.` }));
const node = (id: string, label: string, entryIds: string[]) => ({ id, label, summary: label, entryIds, children: [] });
const LAYOUT: StoredLayout = { rev: "r1", model: "m1", granularity: 0, detail: "lite", root: { id: "root", label: "World Knowledge", summary: "A coast.", entryIds: [], children: [node("n:woods", "Woods", ["e0", "e1"]), node("n:marsh", "Marsh", ["e2", "e3"])] } };
const stored = (layout: StoredLayout): StoredTree => ({ id: "t1", chatId: "chat1", bookId: "b1", at: 1, status: "live", layout });

let flushSync: FlushSync;
let current: StoredTree | null = null;
let chat: Chat = CHAT;
let patches: ChatCompendiumPatch[] = [];
let calls: { name: string; args: unknown[] }[] = [];
let statuses: string[] = [];
let release: (() => void) | null = null;
let buildNotes: string[] = [];
let ingestRun: import("../../../../studio/compendium-ingest").IngestRun | null = null;

const ctx = (): AppContext => ({
  api: {
    getLightEditableEntity: async (query: string) => ({ entity: { kind: "lorebook", id: /id=([^&]+)/.exec(query)![1], body: bodyOf(BOOK.name, entries) }, revision: "r1", version: 1 }),
    getCompendiumTree: async () => ({ tree: current }),
    buildCompendiumTree: async (...args: unknown[]) => { calls.push({ name: "build", args }); await new Promise<void>((r) => { release = r; }); current = stored(LAYOUT); return { tree: current, notes: buildNotes }; },
    undoCompendiumTree: async (...args: unknown[]) => { calls.push({ name: "undo", args }); const was = current; current = null; return { undone: was !== null, current: null }; },
    moveCompendiumEntry: async (...args: unknown[]) => { calls.push({ name: "move", args }); const [, , entryId, nodeId] = args as string[]; current = stored({ ...LAYOUT, root: { ...LAYOUT.root, children: LAYOUT.root.children.map((n) => ({ ...n, entryIds: [...n.entryIds.filter((e) => e !== entryId), ...(n.id === nodeId ? [entryId!] : [])] })) } }); return { tree: current }; },
    setSceneCompendium: async (_id: string, patch: ChatCompendiumPatch) => { patches.push(patch); const next = mergeCompendium(chat.compendium, checkCompendium(patch)); chat = { ...chat, ...(next ? { compendium: next } : {}) } as Chat; if (!next) delete (chat as { compendium?: unknown }).compendium; return chat; },
    listGuides: async () => [],
    getCompendiumIngest: async () => ({ total: 30, run: ingestRun }),
    startCompendiumIngest: async (...args: unknown[]) => { calls.push({ name: "ingest", args }); ingestRun = { id: "run1", chatId: "chat1", bookId: "b1", from: 0, to: 30, status: "running", at: 12, lines: [{ chunk: 1, from: 0, to: 12, status: "filed", created: 3, updated: 1, receiptId: "r1" }], errors: [] }; return { run: ingestRun }; },
    cancelCompendiumIngest: async (...args: unknown[]) => { calls.push({ name: "cancel", args }); ingestRun = { ...ingestRun!, status: "cancelled" }; return { cancelled: true }; },
    undoCompendiumIngest: async (...args: unknown[]) => { calls.push({ name: "undo-ingest", args }); return { undone: 1, failed: [] }; },
    getSceneLore: async () => ({ books: [BOOK], lastTurn: null }),
    sceneConnections: async () => [{ id: "k1", kind: "openai", label: "Harbor", model: "m-own" }],
    connectionModels: async () => ({ models: [{ id: "m-own" }], saved: "m-own" }),
  },
  setStatus: (s: string) => statuses.push(s), prefs: { get: () => undefined, set: () => undefined }, pieces: undefined,
}) as unknown as AppContext;

function Harness({ tab = "wing", bookId = "b1" }: { tab?: "wing" | "settings"; bookId?: string }): JSX.Element {
  const [c, setC] = useState<Chat>(chat);
  const onChat = (next: Chat): void => { chat = next; setC(next); };
  return tab === "wing"
    ? createElement(CompendiumWing, { ctx: ctx(), chat: c, books: [BOOK], onChat })
    : createElement(CompendiumSettingsTab, { ctx: ctx(), chat: c, onChat, bookId });
}

async function mount(tab: "wing" | "settings" = "wing"): Promise<void> {
  const { createRoot } = await import("react-dom/client");
  rig.host = rig.dom.window.document.createElement("div");
  rig.dom.window.document.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  flushSync(() => rig.root.render(createElement(Harness, { tab })));
  for (let i = 0; i < 3; i++) await settle(flushSync);
}
const tabBtn = (label: string): HTMLElement => qa('[role="tab"]').find((t) => t.textContent === label)!;
const sub = (label: string): HTMLElement => qa('.cp-cat [role="tab"]').find((b) => b.textContent === label)!;
async function openTree(): Promise<void> {
  await press(flushSync, tabBtn("Browse"), 30);
  await waitFor(flushSync, () => q(".cp-cat"), "the catalogue");
  await press(flushSync, sub("TV Tree"), 30);
}
/** A row reads its name, then (on a branch) its entry count; a childless branch leads with a dot. */
const nameOf = (r: Element): string => (r.textContent ?? "").replace(/^·/, "").replace(/\d+$/, "");
const rowOf = (label: string): HTMLElement => qa("[data-node-id], [data-entry-id]").find((r) => nameOf(r) === label)!;
const menu = (): HTMLElement | null => q(".cp-tmenu");
const rightClick = async (el: HTMLElement): Promise<void> => { flushSync(() => props(el)["onContextMenu"]!({ preventDefault: () => undefined, clientX: 40, clientY: 40 })); await settle(flushSync); };
const item = (label: string): HTMLElement => qa(".cp-tmenu button").find((b) => (b.textContent ?? "").includes(label))!;
const doc = (): Document => rig.dom.window.document as unknown as Document;

beforeAll(async () => { installLoreDom(); flushSync = (await import("react-dom")).flushSync; });
afterAll(async () => { await teardownAllDoms(); });
beforeEach(() => {
  rig.installed?.reinstall();
  current = null; chat = CHAT; patches = []; calls = []; statuses = []; release = null; buildNotes = []; ingestRun = null;
});

describe("the TV Tree", () => {
  test("a stored layout is the tree, its branches are the model's, and the Dashboard counts its nodes", async () => {
    current = stored(LAYOUT);
    await mount();
    await waitFor(flushSync, () => q(".cp-dash"), "the dashboard");
    expect(text()).toMatch(/TV Tree . 3 nodes . depth 2/);
    await openTree();
    expect(qa("[data-node-id]").map((n) => nameOf(n))).toEqual(["Woods", "Marsh"]);
  });

  test("with no layout the derived tree shows, and a right-click on its branch still offers the menu", async () => {
    await mount();
    await openTree();
    expect(qa("[data-node-id]").map((n) => nameOf(n))).toEqual(["General"]);
    await rightClick(rowOf("General"));
    expect(menu()!.getAttribute("aria-label")).toBe("Tree Constraints");
  });

  test("a right-click on a branch offers Lock, Forbid and Reorganize in RoleCall's words; Lock saves one list and the row shows the flag", async () => {
    current = stored(LAYOUT);
    await mount();
    await openTree();
    await rightClick(rowOf("Woods"));
    expect(menu()!.textContent).toContain("Tree Constraints");
    expect(menu()!.textContent).toContain("Woods");
    expect(qa(".cp-tmenu button[role^='menuitem']").map((b) => b.querySelector("b")!.textContent)).toEqual(["Lock branch", "Forbid branch", "Reorganize on next rebuild"]);
    expect(menu()!.textContent).toContain("AI can never modify this branch on rebuild.");
    await press(flushSync, item("Lock branch"));
    expect(patches).toEqual([{ books: { b1: { tree: { locked: ["n:woods"] } } } }]);
    expect(statuses).toContain('"Woods" locked.');
    expect(menu()).toBeNull();
    await waitFor(flushSync, () => rowOf("Woods").querySelector(".cp-flags"), "the flag");
    await rightClick(rowOf("Woods"));
    expect(item("Lock branch").getAttribute("aria-checked")).toBe("true");
    await press(flushSync, item("Lock branch"));
    expect(patches.at(-1)).toEqual({ books: { b1: { tree: null } } });
    expect(statuses.at(-1)).toBe('"Woods" unlocked.');
  });

  test("Reorganize says it is a one-shot, Forbid says what it did, Escape closes the menu", async () => {
    current = stored(LAYOUT);
    await mount();
    await openTree();
    await rightClick(rowOf("Marsh"));
    await press(flushSync, item("Forbid branch"));
    await rightClick(rowOf("Marsh"));
    await press(flushSync, item("Reorganize"));
    expect(patches.at(-1)).toEqual({ books: { b1: { tree: { forbidden: ["n:marsh"], reorganize: ["n:marsh"] } } } });
    expect(statuses[0]).toBe('"Marsh" forbidden from rebuild.');
    expect(statuses[1]).toContain("one-shot");
    await rightClick(rowOf("Marsh"));
    flushSync(() => doc().dispatchEvent(new rig.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu()).toBeNull();
  });

  test("an entry's menu adds Move to..., which opens the picker without the entry itself; picking pins it and the tree shows Pinned", async () => {
    current = stored(LAYOUT);
    await mount();
    await openTree();
    await press(flushSync, rowOf("Woods"), 10);
    await rightClick(rowOf("Alder"));
    expect(menu()!.getAttribute("aria-label")).toBe("Entry Constraints");
    await press(flushSync, item("Move to..."));
    const picker = [...doc().querySelectorAll<HTMLElement>(".cp-pick")].at(-1)!;
    expect(picker.textContent).toContain('Move "Alder" to...');
    const names = [...picker.querySelectorAll(".list [data-control=row]")].map((r) => (r.textContent ?? "").replace(/Classic$/, ""));
    expect(names).toEqual(["Birch", "Cedar", "Dogwood"]);
    flushSync(() => (([...picker.querySelectorAll<HTMLElement>(".list button")].find((b) => b.textContent?.includes("Cedar")))!).click());
    await settle(flushSync);
    expect(patches).toEqual([{ books: { b1: { tree: { pins: { e0: "e2" } } } } }]);
    expect(statuses).toContain('"Alder" moved under "Cedar".');
    await press(flushSync, rowOf("Marsh"), 10);
    await waitFor(flushSync, () => qa("[data-node-id]").find((n) => nameOf(n) === "Pinned"), "the Pinned branch");
  });

  test("dragging an entry onto a branch files it there through the server; with no tree built it says so and calls nothing", async () => {
    current = stored(LAYOUT);
    await mount();
    await openTree();
    await press(flushSync, rowOf("Woods"), 10);
    const drop = (el: HTMLElement, id: string) => flushSync(() => props(el)["onDrop"]!({ preventDefault: () => undefined, dataTransfer: { getData: () => id } }));
    const start = (el: HTMLElement) => flushSync(() => props(el)["onDragStart"]!({ dataTransfer: { setData: (_: string, v: string) => (dragged = v) } }));
    let dragged = "";
    start(rowOf("Alder"));
    expect(dragged).toBe("e0");
    drop(rowOf("Marsh"), "e0");
    await settle(flushSync);
    expect(calls).toEqual([{ name: "move", args: ["chat1", "b1", "e0", "n:marsh"] }]);
    expect(statuses.at(-1)).toBe('"Alder" moved under "Marsh".');
  });

  test("with no built tree a drop is refused in RoleCall's words and nothing is called", async () => {
    await mount();
    await openTree();
    await press(flushSync, rowOf("General"), 10);
    flushSync(() => props(rowOf("General"))["onDrop"]!({ preventDefault: () => undefined, dataTransfer: { getData: () => "e0" } }));
    expect(statuses).toEqual(["Tree not built yet - build one first"]);
    expect(calls).toEqual([]);
  });
});

describe("Tree maintenance", () => {
  test("Repair tree from entries asks the server, reads Repairing... while it runs, then the tree and what it repaired show", async () => {
    buildNotes = ["1 entry was left out of the model's answer and filed under General"];
    await mount();
    await waitFor(flushSync, () => q(".cp-maint"), "the disclosure");
    expect(q(".cp-maint summary")!.textContent).toBe("Tree maintenance");
    expect(qa(".cp-maint button").map((b) => b.textContent)).toEqual(["Repair tree from entries"]);
    const go = qa(".cp-maint button")[0]!;
    flushSync(() => go.click());
    await settle(flushSync);
    expect(qa(".cp-maint button")[0]!.textContent).toBe("Repairing...");
    expect((qa(".cp-maint button")[0] as HTMLButtonElement).disabled).toBe(true);
    flushSync(() => release!());
    await settle(flushSync, 60);
    expect(calls).toEqual([{ name: "build", args: ["chat1", "b1"] }]);
    expect(qa(".cp-maint button").map((b) => b.textContent)).toEqual(["Repair tree from entries", "Undo last build"]);
    expect(q(".cp-maint .notes")!.textContent).toContain("filed under General");
    expect(text()).toMatch(/TV Tree . 3 nodes/);
  });

  test("Undo last build goes back to the derived tree", async () => {
    current = stored(LAYOUT);
    await mount();
    await waitFor(flushSync, () => q(".cp-maint"), "the disclosure");
    await press(flushSync, qa(".cp-maint button").find((b) => b.textContent === "Undo last build"), 60);
    expect(calls).toEqual([{ name: "undo", args: ["chat1", "b1"] }]);
    expect(qa(".cp-maint button").map((b) => b.textContent)).toEqual(["Repair tree from entries"]);
  });
});

describe("Settings", () => {
  const advanced = async (): Promise<void> => { await press(flushSync, qa("[aria-label=\"Settings view\"] button").find((b) => b.textContent === "Advanced"), 30); };

  test("Tree building shows the defaults and each row saves its own field", async () => {
    await mount("settings");
    await advanced();
    const sel = (label: string) => q<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    expect(sel("Granularity").value).toBe("0");
    expect(sel("Entry detail level").value).toBe("lite");
    expect(sel("Placement mode").value).toBe("auto");
    expect([...sel("Granularity").options].map((o) => o.textContent)[1]).toBe("Minimal - 3-5 categories, max 20/node");
    flushSync(() => props(sel("Granularity"))["onChange"]!({ target: { value: "3" } }));
    flushSync(() => props(sel("Entry detail level"))["onChange"]!({ target: { value: "full" } }));
    flushSync(() => props(sel("Placement mode"))["onChange"]!({ target: { value: "parallel" } }));
    await settle(flushSync);
    expect(patches).toEqual([{ treeBuild: { granularity: 3 } }, { treeBuild: { detail: "full" } }, { treeBuild: { placement: "parallel" } }]);
  });

  test("Refine entries during build is drawn now that the build reads it: off by default, and its switch writes treeBuild.refine", async () => {
    await mount("settings");
    await advanced();
    const sec = qa(".cps-sec").find((s) => s.querySelector("h3")?.textContent === "Tree building")!;
    const sw = sec.querySelector<HTMLElement>('[aria-label="Refine entries during build"]')!;
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sec.textContent).toContain("splits multi-topic entries into focused pieces");
    await press(flushSync, sw);
    expect(patches).toEqual([{ treeBuild: { refine: true } }]);
  });

  test("Historian summaries shows 20 and 10 and each stepper sends its own field", async () => {
    await mount("settings");
    await advanced();
    const sec = qa(".cps-sec").find((s) => s.querySelector("h3")?.textContent === "Historian summaries")!;
    expect([...sec.querySelectorAll("output")].map((o) => o.textContent)).toEqual(["20", "10"]);
    const smart = sec.querySelector<HTMLElement>('[aria-label="Summary-aware context truncation"]')!;
    expect(smart.getAttribute("aria-checked")).toBe("false");
    expect(sec.textContent).toContain("Drop older messages from the narrator's context once they've been summarized, freeing tokens for newer content");
    await press(flushSync, sec.querySelector<HTMLElement>('[aria-label="Interval (your turns): one less"]'));
    await press(flushSync, sec.querySelector<HTMLElement>('[aria-label="Context overlap: one more"]'));
    await press(flushSync, smart);
    expect(patches).toEqual([{ historian: { interval: 19 } }, { historian: { overlap: 11 } }, { historian: { smartContext: true } }]);
  });

  test("Import chat history shows RoleCall's defaults and each control writes its own field", async () => {
    await mount("settings");
    await advanced();
    const sec = qa(".cps-sec").find((s) => s.querySelector("h3")?.textContent === "Import chat history")!;
    const sw = (label: string) => sec.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
    for (const l of ["Cross-chunk continuity", "Search", "Facts", "Narrative"]) expect(sw(l).getAttribute("aria-checked")).toBe("true");
    expect(sec.querySelector(".cps-seg button[aria-pressed=\"true\"]")!.textContent).toBe("Compendium model");
    expect(sw("Tokens per chunk").getAttribute("min")).toBe("1000");
    expect(sw("Tokens per chunk").getAttribute("max")).toBe("32000");
    expect((sw("Tokens per chunk") as HTMLInputElement).value).toBe("6000");
    await press(flushSync, sw("Cross-chunk continuity"));
    await press(flushSync, sw("Narrative"));
    await press(flushSync, qa(".cps-seg button").find((b) => b.textContent === "Scene model"));
    flushSync(() => props(sw("Tokens per chunk"))["onChange"]!({ target: { value: "12000" } }));
    await settle(flushSync);
    expect(patches).toEqual([{ ingest: { continuity: false } }, { ingest: { narrative: false } }, { ingest: { model: "scene" } }, { ingest: { chunkTokens: 12000 } }]);
  });

  test("Ingest Messages needs a writable book and says so; with write it starts the range, shows the drawer, and Cancel and Undo this ingest go to the server", async () => {
    await mount("settings");
    await advanced();
    expect(text()).toContain("This book does not allow the Compendium to write.");
    expect(qa("button").find((b) => b.textContent === "Ingest Messages")!.hasAttribute("disabled")).toBe(true);
    flushSync(() => rig.root.unmount());
    rig.host.remove();
    chat = { ...CHAT, compendium: { books: { b1: { access: "read_write" } } } } as Chat;
    await mount("settings");
    await advanced();
    expect(q<HTMLInputElement>('[aria-label="To"]')!.value).toBe("30");
    expect(text()).toContain("of 30");
    await press(flushSync, qa("button").find((b) => b.textContent === "Ingest Messages"), 60);
    expect(calls).toEqual([{ name: "ingest", args: ["chat1", "b1", 0, 30] }]);
    expect(q(".cps-drawer .hd")!.textContent).toContain("Reading message 12 of 30");
    expect(q(".cps-drawer li")!.textContent).toContain("Chunk 1 messages 0 to 11: filed, 3 created, 1 updated");
    expect(qa("button").map((b) => b.textContent)).toContain("Cancel");
    await press(flushSync, qa("button").find((b) => b.textContent === "Cancel"), 60);
    expect(calls.at(-1)).toEqual({ name: "cancel", args: ["chat1", "run1"] });
    expect(q(".cps-drawer .hd")!.textContent).toContain("Ingest cancelled");
    await press(flushSync, qa("button").find((b) => b.textContent === "Undo this ingest"), 60);
    expect(calls.at(-1)).toEqual({ name: "undo-ingest", args: ["chat1", "run1"] });
    expect(statuses.at(-1)).toBe("Took back 1 chunk.");
  });

  test("Run Diagnostics reads the books and lists PASS, WARN and FAIL rows by category, and writes nothing", async () => {
    await mount("settings");
    await advanced();
    expect(q(".cps-diag")).toBeNull();
    await press(flushSync, qa("button").find((b) => b.textContent === "Run Diagnostics"), 80);
    const rows = qa(".cps-diag .row");
    expect(rows.length).toBeGreaterThan(3);
    expect(rows[0]!.textContent).toContain("[PASS]");
    expect(rows[0]!.textContent).toContain("Configuration");
    expect(rows[0]!.textContent).toContain("1 book enabled, 0 allowing writes");
    expect(qa(".cps-diag .row.warn").map((r) => r.textContent).join(" ")).toContain("Write access");
    expect(text()).toContain("Derived from the book (no built tree)");
    expect(text()).toContain("Recall token budget");
    expect(text()).toContain("8,192 tokens (a quarter of the 32,768 token window)");
    expect(patches).toEqual([]);
  });

  test("the constraints list is empty in RoleCall's words, and names what is saved by its branch or entry with a clear X", async () => {
    current = stored(LAYOUT);
    await mount("settings");
    await advanced();
    expect(text()).toContain("No constraints set. Right-click a tree node or an entry in Browse to lock, forbid, or schedule it for reorganization.");
    chat = { ...CHAT, compendium: { books: { b1: { tree: { locked: ["n:woods"], reorganize: ["n:woods", "e1"], pins: { e0: "e2" } } } } } } as Chat;
    flushSync(() => rig.root.unmount());
    rig.host.remove();
    await mount("settings");
    await advanced();
    const rows = qa(".cps-cons .row");
    expect(qa(".cps-cons").length).toBe(2);
    expect(rows.map((r) => r.querySelector("b")!.textContent)).toEqual(["Woods", "Birch", "Alder"]);
    expect(rows[0]!.textContent).toContain("Locked");
    expect(rows[0]!.textContent).toContain("Reorganize Pending");
    expect(rows[2]!.textContent).toContain("Pinned under Cedar");
    expect(text()).toContain("Branches (1)");
    expect(text()).toContain("Entries (2)");
    await press(flushSync, rows[0]!.querySelector("button"));
    expect(patches).toEqual([{ books: { b1: { tree: { reorganize: ["e1"], pins: { e0: "e2" } } } } }]);
  });
});
