/**
 * Track C's pieces in the wing (mount ids compendium.activity, compendium.headerActions, recentWrites): the Activity tab's empty
 * copy, a card per receipt with Undo and File again, a damaged receipt that does not break the list, Clear feed as a watermark that
 * hides and deletes nothing, and Reconcile's button, MIRROR, KEEP and its failure state, all through the receipt API.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { AppContext } from "../../../app-contract";
import type { CompendiumReceipt } from "../../../../stage/contracts/chat-store";
import type { SceneLoreBook, SceneTrace } from "../../../app-contract-scenes";
import { typedEntry } from "../../../../core/compendium/fixture-book";
import { teardownAllDoms } from "../../../_shared/test-dom";
import { CHAT, bodyOf, installLoreDom, press, q, qa, rig, settle, text, waitFor, type FlushSync } from "../fake-lore-rig";
import { CompendiumWithFiling } from "./compendium-mounts";

const BOOK: SceneLoreBook = { id: "b1", name: "The Drowned Coast", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 3, tokens: 0 };
const CHAT_W = { ...CHAT, compendium: { books: { b1: { access: "read_write" as const } } } };
let entries = [typedEntry("e1", "Mira Vance", "character", { name: "Mira Vance" }), typedEntry("e2", "Dov Ketter", "character", { name: "Dov Ketter" })];
const base = { chatId: "chat1", branchId: "b1", settledAt: 1, writes: [] as CompendiumReceipt["writes"] };
const filed: CompendiumReceipt = { ...base, id: "r1", kind: "filing", status: "filed", at: Date.now() - 5_000, model: "scribe", writes: [{ bookId: "b1", entryId: "e1", op: "update", fields: { before: { "data.tier": "B" }, after: { "data.tier": "A" } } }] };
const skipped: CompendiumReceipt = { ...base, id: "r2", kind: "filing", status: "skipped", at: Date.now() - 9_000, reason: "no enabled book allows writes" };
const damaged: CompendiumReceipt = { ...base, id: "r3", kind: "filing", status: "filed", at: Date.now() - 20_000, damaged: true };

let calls: { name: string; args: unknown[] }[] = [];
let receipts: CompendiumReceipt[] = [];
/** Replies' traces by message id; "latest" answers a read with no message. */
let traces: Record<string, SceneTrace | null> = {};
let traceFails = false;
const trace = (messageId: string, recall: SceneTrace["recall"], replies: string[] = [messageId]): SceneTrace => ({
  reply: { messageId, swipeId: `s-${messageId}`, number: 2, model: "narrator", take: "Director's Cut" }, blocks: [], window: { context: 1, reply: 1, stated: true }, trimmed: 0, lore: null, recall,
  rawAvailable: false, replies: replies.map((id, i) => ({ messageId: id, swipeId: `s-${id}`, number: 4 - i * 2 })),
});
const picked: NonNullable<SceneTrace["recall"]> = { status: "recalled", at: Date.now() - 2_000, model: "scout", calls: 1, cached: false, alreadyPlaced: 0, cut: [], injected: [{ bookId: "b1", entryId: "e1", bookName: "The Drowned Coast", title: "Mira Vance", tokens: 1234, reason: "She is on the quay" }] };
let cleared = 0;
let rows = [{ sourceEntryId: "e1", sourceTitle: "Mira Vance", targetEntryId: "e2", targetTitle: "Dov Ketter", nature: "ally" }];
let reconcileStates: Record<string, string> = { "e1>e2": "done" };
let flushSync: FlushSync;
/** The piece store's per-piece listeners, as the shell's change stream would call them. */
let listeners = new Map<string, Set<() => void>>();
const changed = (key: string): void => listeners.get(key)?.forEach((fn) => fn());

const ctx = (): AppContext => ({
  api: {
    getLightEditableEntity: async (query: string) => ({ entity: { kind: "lorebook", id: /id=([^&]+)/.exec(query)![1], body: bodyOf(BOOK.name, entries) }, revision: "r", version: 1 }),
    getCompendiumTree: async () => ({ tree: null }),
    getSceneLore: async () => ({ books: [BOOK], lastTurn: null }),
    getSceneTrace: async (_chat: string, messageId?: string) => { if (traceFails) throw new Error("trace route down"); return traces[messageId ?? "latest"] ?? null; },
    listCompendiumReceipts: async () => ({ receipts, feedClearedAt: cleared }),
    clearCompendiumFeed: async (...args: unknown[]) => { calls.push({ name: "clear", args }); cleared = Date.now(); return { feedClearedAt: cleared }; },
    undoCompendiumReceipt: async (...args: unknown[]) => { calls.push({ name: "undo", args }); return { ...base, id: "u1", kind: "undo", status: "filed", at: 1 }; },
    fileCompendiumAgain: async (...args: unknown[]) => { calls.push({ name: "again", args }); return filed; },
    listCompendiumReconcile: async () => ({ rows }),
    reconcileCompendium: async (...args: unknown[]) => { calls.push({ name: "reconcile", args }); return { receipt: { ...base, id: "m1", kind: "mirror", status: "filed", at: 1 }, states: reconcileStates }; },
  },
  pieces: { subscribe: (kind: string, id: string, fn: () => void) => { const k = `${kind}:${id}`; listeners.set(k, (listeners.get(k) ?? new Set()).add(fn)); return () => listeners.get(k)?.delete(fn); } },
  setStatus: () => undefined, prefs: { get: () => undefined, set: () => undefined },
}) as unknown as AppContext;

async function mount(context = ctx()): Promise<void> {
  const { createRoot } = await import("react-dom/client");
  rig.host = rig.dom.window.document.createElement("div");
  rig.dom.window.document.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  flushSync(() => rig.root.render(createElement(CompendiumWithFiling, { ctx: context, chat: CHAT_W as never, books: [BOOK] })));
  for (let i = 0; i < 3; i++) await settle(flushSync);
}
const tab = (label: string): HTMLElement => qa('[role="tab"]').find((t) => t.textContent === label)!;
const btn = (label: string, root: ParentNode = rig.host): HTMLElement => [...root.querySelectorAll<HTMLElement>("button")].find((b) => (b.textContent ?? "").trim().toLowerCase().startsWith(label.toLowerCase()))!;
const dialog = (): HTMLElement => [...rig.dom.window.document.querySelectorAll<HTMLElement>(".cp-rec")].at(-1)!;
async function openReconcile(): Promise<void> {
  await waitFor(flushSync, () => (rig.host.textContent ?? "").includes("Reconcile ("), "the Reconcile button");
  await press(flushSync, btn("Reconcile"), 40);
}
async function activity(): Promise<void> { await press(flushSync, tab("Activity"), 30); await settle(flushSync); }

beforeAll(async () => { installLoreDom(); flushSync = (await import("react-dom")).flushSync; });
afterAll(async () => { await teardownAllDoms(); });
// Unmounted so the receipts poll and the modal's portal never outlive the test that made them.
afterEach(() => { flushSync(() => rig.root.unmount()); rig.host.remove(); rig.dom.window.document.querySelectorAll(".cp-rec").forEach((n) => n.remove()); });
beforeEach(() => {
  rig.installed?.reinstall();
  calls = []; receipts = []; cleared = 0; listeners = new Map(); traces = {}; traceFails = false;
  entries = [typedEntry("e1", "Mira Vance", "character", { name: "Mira Vance" }), typedEntry("e2", "Dov Ketter", "character", { name: "Dov Ketter" })]; reconcileStates = { "e1>e2": "done" };
  rows = [{ sourceEntryId: "e1", sourceTitle: "Mira Vance", targetEntryId: "e2", targetTitle: "Dov Ketter", nature: "ally" }];
});

describe("Activity (rc-world-comp-activity.png)", () => {
  test("with no receipts it says so in RoleCall's words, under ALL | ENTRIES | TOOLS and a Clear feed button", async () => {
    await mount();
    await activity();
    expect(text()).toContain("No activity yet");
    expect(text()).toContain("Compendium tool calls will stream here in real-time.");
    expect(qa(".cp-feed [role=\"tab\"]").map((b) => b.textContent)).toEqual(["All", "Entries", "Tools"]);
    expect(q('[aria-label="Clear feed"]')).not.toBeNull();
  });

  test("a card per receipt with the entry's name, a damaged one beside healthy ones, and Recent Writes fed from the same receipts", async () => {
    receipts = [filed, skipped, damaged];
    await mount();
    expect(text()).toContain("Mira Vance");
    await activity();
    const cards = qa(".cp-act");
    expect(cards).toHaveLength(3);
    expect(cards[0]!.textContent).toContain("Updated");
    expect(cards[0]!.textContent).toContain("scribe");
    expect(cards[0]!.textContent).toContain("Mira Vance");
    expect(cards[1]!.textContent).toContain("Skipped: no enabled book allows writes");
    expect(cards[2]!.textContent).toContain("Damaged");
  });

  test("a Historian receipt is a HIST card, Summarized, with the recaps it wrote, and Undo goes through the receipt API", async () => {
    const hist: CompendiumReceipt = { ...base, id: "h1", kind: "historian", status: "filed", at: Date.now() - 3_000, model: "scribe", messageId: "m4", writes: [{ bookId: "b1", entryId: "e1", op: "create", fields: { before: {}, after: { enabled: true, "data.title": "The Howl" } } }] };
    const idle: CompendiumReceipt = { ...hist, id: "h2", status: "nothing_to_file", writes: [], at: Date.now() - 4_000 };
    receipts = [hist, idle];
    await mount();
    await activity();
    const [card, empty] = qa(".cp-act");
    expect(card!.className).toContain("hist");
    expect(card!.querySelector(".chip.phase")!.textContent).toBe("HIST");
    expect(card!.querySelector(".lab")!.textContent).toBe("Summarized");
    expect(card!.textContent).toContain("Mira Vance");
    expect(empty!.querySelector(".lab")!.textContent).toBe("Historian");
    expect(empty!.querySelector(".chip.phase")!.textContent).toBe("HIST");
    await press(flushSync, [...card!.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.includes("Undo")));
    expect(calls.at(-1)).toEqual({ name: "undo", args: ["chat1", "h1"] });
    await press(flushSync, qa(".cp-feed [role=\"tab\"]")[1]!);
    expect(qa(".cp-act")).toHaveLength(1);
  });

  test("ENTRIES shows what wrote, TOOLS what searched, and a skipped pass only under ALL (RoleCall's split)", async () => {
    receipts = [filed, skipped];
    traces = { latest: trace("m4", picked) };
    await mount();
    await activity();
    expect(qa(".cp-act")).toHaveLength(3);
    await press(flushSync, qa(".cp-feed [role=\"tab\"]")[1]!);
    expect(qa(".cp-act").map((c) => c.textContent)).toEqual([expect.stringContaining("Updated")]);
    await press(flushSync, qa(".cp-feed [role=\"tab\"]")[2]!);
    expect(qa(".cp-act")).toHaveLength(1);
    expect(qa(".cp-act")[0]!.textContent).toContain("Searched");
  });

  test("the tabs move with the arrow keys, Home and End, one tab stop at a time", async () => {
    await mount();
    await activity();
    const key = async (k: string): Promise<void> => { flushSync(() => { document.activeElement!.dispatchEvent(new rig.dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); }); await settle(flushSync); };
    const seg = (): HTMLElement[] => qa(".cp-feed [role=\"tab\"]");
    seg()[0]!.focus();
    await key("ArrowRight");
    expect(seg().map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(seg().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.activeElement).toBe(seg()[1]!);
    await key("End");
    expect(document.activeElement).toBe(seg()[2]!);
    await key("ArrowRight");
    expect(document.activeElement).toBe(seg()[0]!);
    await key("ArrowLeft");
    expect(document.activeElement).toBe(seg()[2]!);
  });

  test("PRE: each entry the recall pass retrieved is a Searched card with its book, Retrieved, tokens and a Why this entry that opens", async () => {
    traces = { latest: trace("m4", picked) };
    await mount();
    await activity();
    const card = qa(".cp-act")[0]!;
    expect(card.textContent).toContain("Searched");
    expect(card.textContent).toContain("PRE");
    expect(card.textContent).toContain("scout");
    expect(card.textContent).toContain("Retrieved: Mira Vance");
    expect(card.textContent).toContain("The Drowned Coast");
    expect(card.textContent).toContain("1,234 tokens");
    expect(card.textContent).not.toContain("She is on the quay");
    await press(flushSync, [...card.querySelectorAll<HTMLElement>("button")].find((b) => (b.textContent ?? "").includes("Why this entry"))!);
    expect(card.textContent).toContain("She is on the quay");
  });

  test("PRE cards come from the newest replies' traces, and a recall that found nothing says so once", async () => {
    traces = { latest: trace("m4", { ...picked, status: "empty", injected: [] }, ["m4", "m2"]), m2: trace("m2", { ...picked, at: Date.now() - 90_000 }) };
    await mount();
    await activity();
    const cards = qa(".cp-act").map((c) => c.textContent ?? "");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("Pre-gen retrieval found no relevant entries for this scene");
    expect(cards[1]).toContain("Retrieved: Mira Vance");
  });

  test("a trace that cannot be read is said, not shown as no activity", async () => {
    traceFails = true;
    await mount();
    await activity();
    expect(text()).toContain("trace route down");
  });

  test("Undo goes through the receipt API; Clear feed hides the cards and the receipts stay", async () => {
    receipts = [{ ...filed, swipeId: "s" }];
    await mount();
    await activity();
    await press(flushSync, btn("Undo"), 40);
    expect(calls.at(-1)).toEqual({ name: "undo", args: ["chat1", "r1"] });
    await press(flushSync, q('[aria-label="Clear feed"]'), 40);
    expect(calls.at(-1)).toEqual({ name: "clear", args: ["chat1"] });
    expect(qa(".cp-act")).toHaveLength(0);
    expect(text()).toContain("No activity yet");
    expect(receipts).toHaveLength(1);
  });
});

describe("the views follow the library's change notification", () => {
  test("a write that lands (a filing, an Undo, a Reconcile) refreshes the Dashboard and Recent Writes without reopening, and nothing polls", async () => {
    const context = ctx();
    const getBook = context.api.getLightEditableEntity;
    let holdBook = false;
    let releaseBook!: () => void;
    const held = new Promise<void>((resolve) => { releaseBook = resolve; });
    context.api.getLightEditableEntity = async (...args) => { if (holdBook) await held; return getBook(...args); };
    await mount(context);
    expect(text()).toContain("No recent writes yet.");
    expect(text()).toContain("Updated -");
    expect(text()).not.toContain("Sela Brandt");
    entries = [...entries, typedEntry("e3", "Sela Brandt", "character", { name: "Sela Brandt" })];
    receipts = [filed];
    holdBook = true;
    changed("lorebook:b1");
    try {
      await waitFor(flushSync, () => text().includes("Updated just now"), "the refreshed receipt timestamp");
    } finally { releaseBook(); }
    const cells = (): string => qa(".cp-cell").map((c) => c.textContent).join(" ");
    await waitFor(flushSync, () => cells().includes("Entry Counts3Cast"), "the refreshed Dashboard's three cast entries");
    expect(text()).toContain("Mira Vance");
    expect(text()).not.toContain("No recent writes yet.");
    expect(text()).toContain("Updated just now");
    expect(cells()).toContain("3");
  });

  test("it listens to the scene's own book and nothing else", async () => {
    await mount();
    expect([...listeners.keys()]).toEqual(["lorebook:b1"]);
  });
});

describe("Reconcile", () => {
  test("RECONCILE (N) opens the modal in RoleCall's words; MIRROR is one call and the row reads Mirrored", async () => {
    await mount();
    expect(text()).toContain("Reconcile (1)");
    await openReconcile();
    expect(dialog().textContent).toContain("1 One-Sided Edge");
    expect(dialog().textContent).toContain("These are relationships that exist on one side but not the other.");
    await press(flushSync, btn("Mirror", dialog()), 40);
    expect(calls.at(-1)).toEqual({ name: "reconcile", args: ["chat1", "b1", "mirror", [{ sourceEntryId: "e1", targetEntryId: "e2" }]] });
    expect(dialog().textContent).toContain("Mirrored");
    expect(dialog().textContent).toContain("1 / 1 resolved");
  });

  test("KEEP is sent to be saved and the row reads Kept", async () => {
    await mount();
    await openReconcile();
    await press(flushSync, btn("Keep", dialog()), 40);
    expect(calls.at(-1)).toMatchObject({ name: "reconcile", args: ["chat1", "b1", "keep", [{ sourceEntryId: "e1", targetEntryId: "e2" }]] });
    expect(dialog().textContent).toContain("Kept");
  });

  test("a pair the server could not write reads Failed and can be tried again", async () => {
    reconcileStates = { "e1>e2": "failed" };
    await mount();
    await openReconcile();
    await press(flushSync, btn("Mirror", dialog()), 40);
    expect(dialog().textContent).toContain("Failed");
    expect(btn("Mirror", dialog())).toBeDefined();
    expect(dialog().textContent).toContain("0 / 1 resolved");
  });

  test("no one-sided relationships draws no button", async () => {
    rows = [];
    await mount();
    expect(text()).not.toContain("Reconcile (");
  });
});
