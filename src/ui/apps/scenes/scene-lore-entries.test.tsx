/**
 * The World wing's entry writes: "New entry", each row's "..." menu (Open and edit, Disable or Enable,
 * Move up and down, Delete), the debounced typed edit with its flush and conflict handling, and what a
 * save actually sends: the one changed entry (or the swapped pair) as a patch against a book read
 * without its escrow, then read back by the activation engine on the next turn. The fake library
 * (fake-lore-rig.ts) checks every patch's revision, so a save that built on a stale one fails here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { runLore } from "../../../core/lore/engine";
import { countText } from "../../../core/tokens";
import { ApiHttpError } from "../../_shared/api-fetch";
import {
  byLabel, byText, entry, entryRow, heldBody, heldEntry, installLoreDom, mountWing, openBook, openEntry, PAUSE, press, pressKey, q, qa, resetLore, rig, settle, text, typeInto, unmount, waitFor,
} from "./fake-lore-rig";

beforeAll(installLoreDom);
afterAll(() => rig.installed?.teardown());
beforeEach(() => resetLore());
afterEach(async () => {
  if (!rig.mounted) return;
  const { flushSync } = await import("react-dom");
  unmount(flushSync);
});

const twoSelective = () => resetLore([
  entry("always1", { constant: true, triggers: [] }), entry("key1", { title: "The storm", sortOrder: 100 }), entry("key2", { title: "The lantern", sortOrder: 200 }),
]);
const sent = (i: number): string[] => Object.keys(rig.patches[i]!.patch.items ?? {}).sort();

describe("New entry", () => {
  test("adds RoleCall's blank entry, opens it, and saves once as a manual save", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await press(flushSync, byLabel("New entry"), 60);
    expect(q<HTMLInputElement>('input[aria-label="Entry title"]')!.value).toBe("New Entry");
    expect(rig.patches).toHaveLength(1);
    expect(rig.patches[0]!.intent).toBe("manual");
    expect(sent(0)).toHaveLength(1);
    const added = heldBody().entries.find((e) => !["always1", "key1"].includes(e.id))!;
    expect(added).toMatchObject({ title: "New Entry", enabled: true, constant: false, triggers: [], position: "depth", depth: 4, sortOrder: 101 });
    await press(flushSync, byLabel("Close this entry panel"));
    expect(entryRow("New Entry")).toBeDefined();
    unmount(flushSync);
  });
});

describe('the row "..." menu', () => {
  const openMenu = async (flushSync: Parameters<typeof press>[0], title: string): Promise<HTMLElement> => {
    await press(flushSync, byLabel(`Actions for ${title}`), 10);
    return q(".wl-menu")!;
  };
  const choose = (menu: HTMLElement, label: string): HTMLElement => [...menu.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === label)!;

  test("lists RoleCall's actions", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    const menu = await openMenu(flushSync, "The storm");
    expect(menu.getAttribute("role")).toBe("menu");
    expect([...menu.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Open and edit", "Disable entry", "Move up", "Move down", "Delete entry"]);
    unmount(flushSync);
  });

  test("Open and edit selects the entry", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await press(flushSync, choose(await openMenu(flushSync, "The storm"), "Open and edit"));
    expect(q<HTMLInputElement>('input[aria-label="Entry title"]')!.value).toBe("The storm");
    expect(q(".wl-menu")).toBeNull();
    unmount(flushSync);
  });

  test("Disable entry saves once, dims the row, and the menu then offers Enable", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await press(flushSync, choose(await openMenu(flushSync, "The storm"), "Disable entry"), 60);
    expect(rig.patches).toHaveLength(1);
    expect(sent(0)).toEqual(["i/key1"]);
    expect(heldEntry("key1").enabled).toBe(false);
    expect(entryRow("The storm")!.className).toContain("off");
    expect(choose(await openMenu(flushSync, "The storm"), "Enable entry")).toBeDefined();
    unmount(flushSync);
  });

  test("Move up and Move down swap sortOrder with the neighbour in the same group, in one patch", async () => {
    twoSelective();
    const flushSync = await mountWing();
    await openBook(flushSync);
    await press(flushSync, choose(await openMenu(flushSync, "The lantern"), "Move up"), 60);
    expect(sent(0)).toEqual(["i/key1", "i/key2"]);
    expect([heldEntry("key2").sortOrder, heldEntry("key1").sortOrder]).toEqual([100, 200]);
    expect(qa(".wl-en-n").map((n) => n.textContent)).toEqual(["always1", "The lantern", "The storm"]);
    await press(flushSync, choose(await openMenu(flushSync, "The lantern"), "Move down"), 60);
    expect([heldEntry("key1").sortOrder, heldEntry("key2").sortOrder]).toEqual([100, 200]);
    unmount(flushSync);
  });

  test("Move is off at the ends of the group and sends nothing", async () => {
    twoSelective();
    const flushSync = await mountWing();
    await openBook(flushSync);
    const first = await openMenu(flushSync, "The storm");
    expect((choose(first, "Move up") as HTMLButtonElement).disabled).toBe(true);
    expect((choose(first, "Move down") as HTMLButtonElement).disabled).toBe(false);
    await press(flushSync, choose(first, "Move up"));
    expect(rig.patches).toHaveLength(0);
    unmount(flushSync);
  });

  test("Escape closes the menu without doing anything", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openMenu(flushSync, "The storm");
    rig.dom.window.document.dispatchEvent(new rig.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle(flushSync);
    expect(q(".wl-menu")).toBeNull();
    expect(rig.patches).toHaveLength(0);
    unmount(flushSync);
  });

  test("a fast second action while the first save is still in flight is never lost", async () => {
    let release: () => void = () => undefined;
    rig.gate = new Promise<void>((resolve) => { release = resolve; });
    const flushSync = await mountWing();
    await openBook(flushSync);
    await press(flushSync, choose(await openMenu(flushSync, "The storm"), "Disable entry"), 10); // save #1 starts, held by the gate
    await press(flushSync, choose(await openMenu(flushSync, "always1"), "Disable entry"), 10); // folded in at once, saved behind it
    release();
    await waitFor(flushSync, () => rig.patches.length === 2, "both saves");
    expect(heldEntry("key1").enabled).toBe(false);
    expect(heldEntry("always1").enabled).toBe(false);
    expect(rig.patches.map((p) => p.revision)).toEqual(["r1", "r2"]); // the second was sent against the revision the first produced
    unmount(flushSync);
  });

  test("Delete asks first: Keep entry cancels, Delete entry removes it as a manual save", async () => {
    const buttons = (): HTMLButtonElement[] => [...rig.dom.window.document.body.querySelectorAll("button")];
    const dialog = (label: string): HTMLButtonElement => buttons().find((b) => b.textContent === label)!;
    const flushSync = await mountWing();
    await openBook(flushSync);
    await press(flushSync, choose(await openMenu(flushSync, "The storm"), "Delete entry"));
    expect(rig.dom.window.document.body.textContent).toContain("Delete this entry");
    await press(flushSync, dialog("Keep entry"));
    expect(rig.patches).toHaveLength(0);
    await press(flushSync, choose(await openMenu(flushSync, "The storm"), "Delete entry"));
    await press(flushSync, dialog("Delete entry"), 60);
    expect(rig.patches).toHaveLength(1);
    expect(rig.patches[0]!.intent).toBe("manual");
    expect(heldBody().entries.map((e) => e.id)).toEqual(["always1"]);
    expect(entryRow("The storm")).toBeUndefined();
    unmount(flushSync);
  });
});

describe("a typed edit", () => {
  test("saves once after the pause, sends only that entry as an autosave, and says where it went", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    typeInto(flushSync, byLabel("Entry title"), "The storm of '09");
    await settle(flushSync, 50);
    expect(rig.patches).toHaveLength(0); // still inside the pause
    await waitFor(flushSync, () => rig.patches.length === 1 && text().includes("Saved to Keeper's Log. Every scene reading this book uses the new text from its next turn."), "entry autosave and notice");
    expect(rig.patches).toHaveLength(1);
    expect(sent(0)).toEqual(["i/key1"]);
    expect(rig.patches[0]!.patch.order).toBeUndefined();
    expect((rig.patches[0]!.patch.head as { body: { entries: unknown[] } }).body.entries).toEqual([]); // the book's other entries do not travel
    expect(rig.patches[0]!.intent).toBe("autosave");
    expect(rig.loads).toEqual(["b1"]); // one light read; the save needed no second read
    expect(heldEntry("key1").title).toBe("The storm of '09");
    expect(text()).toContain("Saved to Keeper's Log. Every scene reading this book uses the new text from its next turn.");
    unmount(flushSync);
  }, 15_000);

  test("typed back to what it was, nothing is sent", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    typeInto(flushSync, byLabel("Entry title"), "same");
    typeInto(flushSync, byLabel("Entry title"), "The storm");
    await settle(flushSync, PAUSE);
    expect(rig.patches).toHaveLength(0);
    unmount(flushSync);
  }, 15_000);

  test("leaving the wing inside the pause still saves what was typed", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    typeInto(flushSync, byLabel("Entry title"), "The storm renamed");
    await settle(flushSync, 50);
    unmount(flushSync);
    await settle(flushSync, 60);
    expect(rig.patches).toHaveLength(1);
    expect(heldEntry("key1").title).toBe("The storm renamed");
  }, 15_000);

  test("going back to the book list inside the pause saves it first, so the next load cannot orphan it", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    typeInto(flushSync, byLabel("Entry title"), "Renamed on the way out");
    await press(flushSync, byLabel("Back to lorebooks"), 80);
    expect(heldEntry("key1").title).toBe("Renamed on the way out");
    expect(q(".wl-books")).not.toBeNull();
    unmount(flushSync);
  });

  test("closing the entry inside the pause saves what was typed at once", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    typeInto(flushSync, byLabel("Entry title"), "Closed early");
    await press(flushSync, byLabel("Close this entry panel"), 60);
    expect(rig.patches).toHaveLength(1); // not two seconds later: on close
    expect(heldEntry("key1").title).toBe("Closed early");
    unmount(flushSync);
  });

  test("a toggle while a typed edit waits keeps the typed text", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    typeInto(flushSync, byLabel("Entry title"), "Half typed");
    await press(flushSync, byLabel("Actions for always1"), 10);
    await press(flushSync, [...q(".wl-menu")!.querySelectorAll("button")].find((b) => b.textContent === "Disable entry"), 60);
    expect(q<HTMLInputElement>('input[aria-label="Entry title"]')!.value).toBe("Half typed");
    expect(heldEntry("key1").title).toBe("Half typed"); // the manual save carried it too
    expect(heldEntry("always1").enabled).toBe(false);
    unmount(flushSync);
  });

  test("a 409 reloads the book and says the edit was not saved", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    rig.failPatch = () => { throw new ApiHttpError(409, "conflict"); };
    typeInto(flushSync, byLabel("Entry title"), "changed");
    await waitFor(flushSync, () => rig.loads.length >= 2 && text().includes("changed somewhere else first"), "conflict reload notice");
    expect(text()).toContain("changed somewhere else first");
    expect(q<HTMLInputElement>('input[aria-label="Entry title"]')!.value).toBe("The storm"); // the latest copy, not the lost edit
    unmount(flushSync);
  }, 15_000);

  test("a refused save keeps the text and says so", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    rig.failPatch = () => { throw new Error("the disk is full"); };
    typeInto(flushSync, byLabel("Entry title"), "kept");
    await waitFor(flushSync, () => text().includes("The edit was not saved: the disk is full. It is still here to try again."), "refused edit notice");
    expect(text()).toContain("The edit was not saved: the disk is full. It is still here to try again.");
    expect(q<HTMLInputElement>('input[aria-label="Entry title"]')!.value).toBe("kept");
    unmount(flushSync);
  }, 15_000);
});

describe("the activation engine reads what the wing saved", () => {
  const scan = (said: string) => ({
    messages: [{ role: "user" as const, content: said }], messageCount: 1,
    character: { name: "Aria", tags: [], description: "", personality: "", scenario: "" },
    persona: "", generationType: "normal" as const, variables: {}, now: 1_700_000_000_000,
  });
  const fires = (said: string): string[] =>
    runLore([{ id: "b1", name: "Keeper's Log", body: heldBody() }], scan(said), { rng: () => 0, countTokens: countText, budgetTokens: Infinity, recentFires: [] }).injected.map((h) => h.entryId);

  test("a keyword swapped in the editor fires on the next turn, and the old one no longer does", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    await press(flushSync, byLabel("Remove storm"), 5);
    const input = byLabel("Add keyword")!;
    typeInto(flushSync, input, "gale");
    pressKey(flushSync, input, "Enter");
    await waitFor(flushSync, () => rig.patches.length === 1 && heldEntry("key1").triggers.some((trigger) => trigger.keyword === "gale"), "keyword autosave before activation");
    expect(rig.patches).toHaveLength(1);
    expect(fires("a gale rolls in")).toContain("key1");
    expect(fires("the storm rolls in")).not.toContain("key1");
    unmount(flushSync);
  }, 15_000);

  test("a disabled entry stops firing, and a toggled-on constant entry always fires", async () => {
    const flushSync = await mountWing();
    await openBook(flushSync);
    expect(fires("the storm")).toContain("key1");
    await press(flushSync, byLabel("Actions for The storm"), 10);
    await press(flushSync, byText(".wl-menu button", "Disable entry"), 60);
    expect(fires("the storm")).not.toContain("key1");
    expect(fires("anything at all")).toContain("always1");
    unmount(flushSync);
  });
});
