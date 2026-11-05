/**
 * Standardize on the Dashboard (RoleCall `BentoDashboard.tsx:802-1448`, rc-world-comp-dashboard): the banner's copy and controls, the
 * START button blocked in words with the button that fixes it, the progress drawer with CANCEL and the lock banner that pauses the
 * book's edits, the Complete, Revert Complete, Revert Failed and Error cards, and a reopened tab finding a run in progress.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement, useState, type JSX } from "react";
import type { AppContext } from "../../../app-contract";
import type { SceneLoreBook } from "../../../app-contract-scenes";
import type { Chat, ChatCompendium } from "../../../../stage/contracts/chat-store";
import type { RevertResult, RunSnapshot } from "../../../../core/compendium";
import { typedEntry } from "../../../../core/compendium/fixture-book";
import { emptyLoreEntry } from "../../../../core/lore";
import { teardownAllDoms } from "../../../_shared/test-dom";
import { CHAT, bodyOf, installLoreDom, press, qa, rig, settle, text, typeInto, waitFor, type FlushSync } from "../fake-lore-rig";
import { CompendiumWithFiling } from "./compendium-mounts";
import { LOCK_TEXT } from "./standardize/standardize-cards";

const BOOK: SceneLoreBook = { id: "b1", name: "The Drowned Coast", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 6, tokens: 0 };
const classic = (id: string, over = {}) => ({ ...emptyLoreEntry(id), title: id, content: `${id} is a person of the harbor.`, ...over });
const ENTRIES = [typedEntry("t1", "Mira", "character", { name: "Mira" }), classic("a"), classic("b"), classic("c"), classic("p", { metadata: { preserve_during_standardize: true } }), classic("r", { enabled: false, metadata: { retired: { at: 1 } } })];
const run = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({ chatId: "chat1", bookId: "b1", status: "running", startedAt: 1, model: "vera-1", total: 3, processed: 0, rewritten: 0, consumed: 0, created: 0, dedup: 0, failed: 0, typed: {}, batches: { done: 0, total: 1 }, warnings: [], log: [], ...over });

let chatState: Chat;
let runs: RunSnapshot[] = [];
let back: Record<string, number> = {};
let calls: { name: string; args: unknown[] }[] = [];
let startRefusal: string | null = null;
let revertAnswer: RevertResult | Error = { receipts: 2, rewrites: 3, merges: 1, splits: 1, consumed: 1, skipped: [] };
let flushSync: FlushSync;

const ctx = (): AppContext => ({
  api: {
    getCompendiumTree: async () => ({ tree: null }),
    getLightEditableEntity: async (query: string) => ({ entity: { kind: "lorebook", id: /id=([^&]+)/.exec(query)![1], body: bodyOf(BOOK.name, ENTRIES) }, revision: "r", version: 1 }),
    listCompendiumReceipts: async () => ({ receipts: [], feedClearedAt: 0 }),
    listCompendiumReconcile: async () => ({ rows: [{ sourceEntryId: "t1", sourceTitle: "Mira", targetEntryId: "t2", targetTitle: "Dov", nature: "ally" }] }),
    standardizeStatus: async () => ({ runs: structuredClone(runs), revertable: back }),
    startStandardize: async (...args: unknown[]) => {
      calls.push({ name: "start", args });
      if (startRefusal) throw new Error(startRefusal);
      runs = [run()];
      return { run: runs[0]! };
    },
    cancelStandardize: async (...args: unknown[]) => { calls.push({ name: "cancel", args }); runs = [run({ status: "cancelling" })]; return { run: runs[0]! }; },
    dismissStandardize: async (...args: unknown[]) => { calls.push({ name: "dismiss", args }); runs = []; return { dismissed: true }; },
    revertStandardize: async (...args: unknown[]) => { calls.push({ name: "revert", args }); if (revertAnswer instanceof Error) throw revertAnswer; runs = []; back = {}; return revertAnswer; },
    setSceneCompendium: async (_id: string, patch: { on?: boolean; standardize?: Record<string, number>; books?: Record<string, { access: string }> }) => {
      calls.push({ name: "set", args: [patch] });
      const c: ChatCompendium = { ...chatState.compendium };
      if (patch.on !== undefined) c.on = patch.on;
      if (patch.standardize) c.standardize = { ...c.standardize, ...patch.standardize };
      if (patch.books) c.books = { ...c.books, ...patch.books } as ChatCompendium["books"];
      chatState = { ...chatState, compendium: c };
      return chatState;
    },
  },
  pieces: { subscribe: () => () => undefined },
  setStatus: () => undefined, prefs: { get: () => undefined, set: () => undefined },
}) as unknown as AppContext;

function Harness(): JSX.Element {
  const [chat, setChat] = useState<Chat>(chatState);
  return createElement(CompendiumWithFiling, { ctx: ctx(), chat, books: [BOOK], onChat: (c: Chat) => { chatState = c; setChat(c); } });
}
async function mount(compendium: ChatCompendium = { on: true, books: { b1: { access: "read_write" } } }): Promise<void> {
  chatState = { ...CHAT, compendium, connection: { id: "conn", model: "vera-1" } } as Chat;
  const { createRoot } = await import("react-dom/client");
  rig.host = rig.dom.window.document.createElement("div");
  rig.dom.window.document.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  flushSync(() => rig.root.render(createElement(Harness)));
  for (let i = 0; i < 3; i++) await settle(flushSync);
}
const btn = (label: string): HTMLElement | undefined => qa("button").find((b) => (b.textContent ?? "").trim().toLowerCase().includes(label.toLowerCase()));
const field = (label: string): HTMLInputElement => qa<HTMLInputElement>("input").find((i) => i.getAttribute("aria-label") === label)!;
const names = () => calls.map((c) => c.name);

beforeAll(async () => { installLoreDom(); flushSync = (await import("react-dom")).flushSync; });
afterAll(async () => { await teardownAllDoms(); });
afterEach(() => { flushSync(() => rig.root.unmount()); rig.host.remove(); });
beforeEach(() => { rig.installed?.reinstall(); runs = []; back = {}; calls = []; startRefusal = null; revertAnswer = { receipts: 2, rewrites: 3, merges: 1, splits: 1, consumed: 1, skipped: [] }; });

describe("the banner (rc-world-comp-dashboard)", () => {
  test("counts the entries a run would convert (not typed, retired or Preserve), in RoleCall's words, with its controls", async () => {
    await mount();
    const t = text();
    expect(t).toContain("◆ Standardize Lorebook");
    expect(t).toContain("3 classic entries waiting to convert");
    expect(t).toContain("This lorebook has 3 classic entries that haven't been converted to the compendium format yet.");
    expect(btn("STANDARDIZE")!.textContent).toBe("STANDARDIZE →");
    for (const label of ["Batch By", "Entries Per Batch", "Parallelism", "Tool Loop Cap", "Model"]) expect(t).toContain(label);
    expect(field("Entries Per Batch").value).toBe("5");
    expect(field("Parallelism").value).toBe("5");
    expect(field("Tool Loop Cap").value).toBe("8");
    expect(t).toContain("Single-batch run, best dedup");
    expect(t).toContain("Concurrent batches");
    expect(t).toContain("Max LLM rounds per batch");
    expect(qa(".mdl").map((e) => e.textContent)).toEqual(["vera-1"]);
    expect(t).not.toContain("Bad run?");
  });

  test("the controls write the scene's saved settings; ALL sets the batch size to the whole book", async () => {
    await mount();
    await press(flushSync, btn("ALL"), 20);
    await press(flushSync, qa("button").find((b) => b.getAttribute("aria-label") === "Parallelism: less"), 20);
    typeInto(flushSync, field("Tool Loop Cap"), "12");
    await settle(flushSync, 30);
    expect(calls.filter((c) => c.name === "set").map((c) => c.args[0])).toEqual([{ standardize: { batchSize: 3 } }, { standardize: { parallelism: 4 } }, { standardize: { maxRounds: 12 } }]);
    expect(field("Parallelism").value).toBe("4");
  });

  test("Batch By Tokens shows the budget with its presets, and the run asks for that budget", async () => {
    await mount();
    await press(flushSync, btn("Tokens"), 20);
    expect(text()).toContain("Token Budget Per Batch");
    expect(qa("button").filter((b) => /^\d+K$/.test(b.textContent ?? "")).map((b) => b.textContent)).toEqual(["32K", "100K", "200K"]);
    expect(text()).toMatch(/avg ~\d+ tokens\/entry/);
    await press(flushSync, btn("32K"), 20);
    await press(flushSync, btn("STANDARDIZE"), 30);
    expect(calls.find((c) => c.name === "start")!.args).toEqual(["chat1", "b1", { by: "tokens", tokenBudget: 32_000 }]);
  });

  test("START asks for entries batches, then the drawer replaces the banner and the book's edits are paused", async () => {
    await mount();
    await press(flushSync, btn("STANDARDIZE"), 30);
    expect(calls.find((c) => c.name === "start")!.args).toEqual(["chat1", "b1", { by: "entries" }]);
    expect(text()).toContain("◆ Standardization Running");
    expect(text()).not.toContain("Standardize Lorebook");
    expect(text()).toContain(LOCK_TEXT);
    expect(btn("Reconcile")!.hasAttribute("disabled")).toBe(true);
    await press(flushSync, btn("CANCEL"), 30);
    expect(names()).toContain("cancel");
    expect(btn("STOPPING")!.hasAttribute("disabled")).toBe(true);
  });

  test("a reopened tab finds a run in progress, with its counters, the current batch and the live log", async () => {
    runs = [run({ processed: 2, total: 3, rewritten: 1, consumed: 1, created: 2, dedup: 1, failed: 0, current: "a, b", batches: { done: 0, total: 2 }, log: [{ at: Date.UTC(2026, 9, 11, 12, 0, 0), level: "info", text: "Batch 1/2: round 1, asking about 3 entries" }] })];
    await mount();
    const t = text();
    expect(t).toContain("Currently processing: a, b");
    expect(t).toContain("2 / 3");
    for (const part of ["OK 1", "CONSUMED 1", "NEW 2", "DEDUP 1", "FAIL 0", "Live Log (1)", "Batch 1/2: round 1, asking about 3 entries"]) expect(t).toContain(part);
    expect(t).toContain(LOCK_TEXT);
  });

  test("while a run works the page asks for it every second, and the lock lifts when it ends", async () => {
    runs = [run({ processed: 0 })];
    await mount();
    expect(text()).toContain("0 / 3");
    runs = [run({ processed: 2, rewritten: 2 })];
    await waitFor(flushSync, () => text().includes("2 / 3"), "the new count");
    runs = [run({ status: "complete", processed: 3, rewritten: 3 })];
    await waitFor(flushSync, () => text().includes("Standardization Complete"), "the Complete card");
    expect(text()).not.toContain(LOCK_TEXT);
    expect(btn("Reconcile")!.hasAttribute("disabled")).toBe(false);
  });

  test("a start the server refuses is said in an Error card with the reason, and can be dismissed", async () => {
    startRefusal = "This scene has no model to standardize with. Pick one in the AI wing.";
    await mount();
    await press(flushSync, btn("STANDARDIZE"), 30);
    expect(text()).toContain("✕ Standardization Error");
    expect(text()).toContain(startRefusal);
    await press(flushSync, btn("DISMISS"), 20);
    expect(text()).not.toContain("Standardization Error");
  });
});

describe("blocked", () => {
  test("a read only book: the reason in words, and Enable Read + Write allows it", async () => {
    await mount({ on: true });
    expect(btn("STANDARDIZATION BLOCKED")!.hasAttribute("disabled")).toBe(true);
    expect(text()).toContain("This book does not allow writing, so Compendium cannot standardize it.");
    await press(flushSync, btn("Enable Read + Write"), 30);
    expect(calls.find((c) => c.name === "set")!.args[0]).toEqual({ books: { b1: { access: "read_write" } } });
    expect(btn("STANDARDIZE →")).toBeDefined();
  });

  test("the Compendium off: the reason, and Turn On Compendium turns it on", async () => {
    await mount({ books: { b1: { access: "read_write" } } });
    expect(text()).toContain("The Compendium is off for this scene. Turn it on in Settings to standardize.");
    await press(flushSync, btn("Turn On Compendium"), 30);
    expect(calls.find((c) => c.name === "set")!.args[0]).toEqual({ on: true });
  });
});

describe("the finished run", () => {
  const done = (over: Partial<RunSnapshot> = {}) => run({ status: "complete", processed: 3, total: 3, rewritten: 1, consumed: 1, created: 1, dedup: 2, failed: 1, typed: { character: 2, location: 1 }, warnings: ["b: it was edited while the model was working, so it was left as it is"], ...over });

  test("Standardization Complete: the counts in RoleCall's line, where the entries went, the warnings", async () => {
    runs = [done()];
    back = { b1: 2 };
    await mount();
    const t = text();
    expect(t).toContain("✓ Standardization Complete");
    expect(t).toContain("1 rewritten · 1 consumed · 1 new (dedup: 2) · 1 failed");
    expect(t).toContain("2 Character");
    expect(t).toContain("1 Location");
    expect(t).toContain("1 warning (click to expand)");
    expect(t).toContain("b: it was edited while the model was working");
    expect(t).toContain("Bad run? Revert to undo all standardize writes (restores originals, retires splits).");
  });

  test("DISMISS forgets the card; REVERT RUN restores from the receipts and says what it did, with 'retired' where RoleCall says 'deleted'", async () => {
    runs = [done()];
    back = { b1: 2 };
    await mount();
    await press(flushSync, btn("REVERT RUN"), 30);
    await waitFor(flushSync, () => text().includes("Revert Complete"), "the Revert Complete card");
    expect(text()).toContain("3 rewrites restored · 1 splits retired · 1 consumed restored · 1 merges undone");
    expect(text()).toContain("All affected rows are back to their original classic state. You can re-run standardization now.");
    expect(text()).not.toMatch(/deleted/);
    await press(flushSync, btn("DISMISS"), 20);
    expect(text()).not.toContain("Revert Complete");
  });

  test("a revert that skipped entries changed since says which", async () => {
    runs = [done()];
    back = { b1: 1 };
    revertAnswer = { receipts: 0, rewrites: 0, merges: 0, splits: 0, consumed: 0, skipped: ["skipped: Aria was edited since it was filed"] };
    await mount();
    await press(flushSync, btn("REVERT RUN"), 30);
    await waitFor(flushSync, () => text().includes("Revert Complete"), "the Revert Complete card");
    expect(text()).toContain("These were changed since the run");
    expect(text()).toContain("Aria was edited since it was filed");
  });

  test("a revert the server refuses is the Revert Failed card with the reason", async () => {
    runs = [done()];
    back = { b1: 1 };
    revertAnswer = new Error("Standardization is running; stop it or wait for it to finish before reverting.");
    await mount();
    await press(flushSync, btn("REVERT RUN"), 30);
    await waitFor(flushSync, () => text().includes("Revert Failed"), "the Revert Failed card");
    expect(text()).toContain("✕ Revert Failed");
    expect(text()).toContain("Standardization is running");
  });

  test("a run that Cancel ended says it stopped, how many were not reached, and that what was written is receipted", async () => {
    runs = [run({ status: "cancelled", processed: 1, total: 3, rewritten: 1 })];
    await mount();
    expect(text()).toContain("◆ Standardization Stopped");
    expect(text()).toContain("Everything written is receipted");
    expect(text()).toContain("2 not reached");
  });

  test("a run that converted nothing is an Error card with its reason and its log, and no lock", async () => {
    runs = [run({ status: "failed", processed: 3, total: 3, failed: 3, error: "No entry could be converted. a: the model gave no answer for it", log: [{ at: 1, level: "error", text: "Batch 1/1: upstream said no" }] })];
    await mount();
    expect(text()).toContain("✕ Standardization Error");
    expect(text()).toContain("No entry could be converted.");
    expect(text()).toContain("Live log (1 lines)");
    expect(text()).not.toContain(LOCK_TEXT);
  });
});
