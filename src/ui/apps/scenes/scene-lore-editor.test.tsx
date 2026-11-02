/**
 * The World wing's entry editor: each control writes the one canonical field it names, through the
 * wing's single entry writer (leaving the wing saves what is typed, so a test reads the library's copy
 * afterwards). The engine's reading of those fields is scene-lore-fields.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  byLabel, entry, heldEntry, installLoreDom, mountWing, openBook, openEntry, press, pressKey, props, q, qa, resetLore, rig, settle, text, typeInto, unmount, waitFor, type FlushSync,
} from "./fake-lore-rig";

beforeAll(installLoreDom);
afterAll(() => rig.installed?.teardown());
beforeEach(() => resetLore());

/** Mount, open "The storm" (advanced open when asked), run `act`, leave the wing so the pending edit saves, and return the library's copy. */
async function edit(act: (flushSync: FlushSync) => Promise<void> | void, opts: { advanced?: boolean; noPersist?: boolean } = {}) {
  const revision = rig.held.get("b1")!.revision;
  const patchCount = rig.patches.length;
  const flushSync = await mountWing();
  try {
    await openBook(flushSync);
    await openEntry(flushSync, "The storm");
    if (opts.advanced && !q(".wl-ord")) await press(flushSync, q("[data-part='scene.lore.advanced']")); // the open state is remembered across entries
    await act(flushSync);
  } finally {
    unmount(flushSync);
  }
  if (opts.noPersist) {
    await settle(flushSync, 80);
    expect(rig.patches).toHaveLength(patchCount);
    expect(rig.held.get("b1")!.revision).toBe(revision);
  } else {
    await waitFor(flushSync, () => rig.held.get("b1")!.revision > revision, "the edited book revision to commit");
  }
  return heldEntry("key1");
}
const choose = (flushSync: FlushSync, selector: string, label: string) => press(flushSync, qa(selector).find((b) => b.textContent!.startsWith(label)), 10);
const number = (flushSync: FlushSync, label: string, value: string): void => typeInto(flushSync, byLabel(label), value);
const blurWith = (flushSync: FlushSync, label: string, value: string): void => { flushSync(() => props(byLabel(label)!)["onBlur"]!({ target: { value } })); };

describe("the header", () => {
  test("the switch writes enabled", async () => {
    expect((await edit((f) => press(f, q('[role="switch"]'), 5))).enabled).toBe(false);
  });
  test("the title and the content write theirs", async () => {
    const saved = await edit((f) => { typeInto(f, byLabel("Entry title"), "Squall"); typeInto(f, q("textarea.wl-ta"), "A line squall."); });
    expect([saved.title, saved.content]).toEqual(["Squall", "A line squall."]);
  });
  test("the type dropdown writes constant, and the status dot follows", async () => {
    const saved = await edit(async (f) => {
      await press(f, q("[data-part='scene.lore.type']"), 5);
      await choose(f, ".wl-dd button", "Constant");
      expect(q(".wl-eh1 .dot")!.className).toContain("con");
    }, { advanced: true });
    expect(saved.constant).toBe(true);
  });
  test("Preserve writes the key Standardize reads, keeps the rest of the entry's metadata, and turns off again", async () => {
    resetLore([entry("always1", { constant: true, triggers: [] }), entry("key1", { title: "The storm", metadata: { note: "mine" } })]);
    const on = await edit((f) => press(f, byLabel("Preserve during standardize"), 5), { advanced: true });
    expect(on.metadata).toEqual({ note: "mine", preserve_during_standardize: true });
    const off = await edit(async (f) => {
      expect(byLabel("Preserved during standardize, click to allow rewrites")!.textContent).toContain("Preserved");
      await press(f, byLabel("Preserved during standardize, click to allow rewrites"), 5);
    }, { advanced: true });
    expect(off.metadata).toEqual({ note: "mine", preserve_during_standardize: false });
  });
  test("Order writes sortOrder and Scan writes scanDepth", async () => {
    const saved = await edit((f) => { number(f, "Insertion order", "250"); number(f, "Scan depth", "9"); }, { advanced: true });
    expect([saved.sortOrder, saved.scanDepth]).toEqual([250, 9]);
  });
  test("an emptied Order falls back to 100 when the field is left", async () => {
    resetLore([entry("always1", { constant: true, triggers: [] }), entry("key1", { title: "The storm", sortOrder: 250 })]);
    const saved = await edit((f) => { number(f, "Insertion order", "7"); typeInto(f, byLabel("Insertion order"), ""); blurWith(f, "Insertion order", ""); }, { advanced: true });
    expect(saved.sortOrder).toBe(100);
  });
});

describe("keywords", () => {
  const triggers = (n: number) => Array.from({ length: n }, (_, i) => ({ keyword: `k${i}`, isRegex: false }));
  const add = (f: FlushSync, label: string, value: string): void => { typeInto(f, byLabel(label), value); pressKey(f, byLabel(label)!, "Enter"); };

  test("Enter adds a plain keyword; the box clears", async () => {
    const saved = await edit((f) => { add(f, "Add keyword", "squall"); expect((byLabel("Add keyword") as HTMLInputElement).value).toBe(""); });
    expect(saved.triggers.map((t) => t.keyword)).toEqual(["storm", "squall"]);
  });
  test("/pattern/flags becomes a regex trigger", async () => {
    const saved = await edit((f) => add(f, "Add keyword", "/mage|wizard/i"));
    expect(saved.triggers[1]).toEqual({ keyword: "mage|wizard", isRegex: true, flags: "i" });
  });
  test("a regex that will not compile is refused with the reason, and nothing is added", async () => {
    const saved = await edit((f) => { add(f, "Add keyword", "/(/"); expect(q('[role="alert"]')!.textContent).toContain("Invalid regex"); }, { noPersist: true });
    expect(saved.triggers).toHaveLength(1);
  });
  test("the x removes one", async () => {
    const saved = await edit((f) => press(f, byLabel("Remove storm"), 5));
    expect(saved.triggers).toEqual([]);
  });
  test("past three keywords the rest fold into 'and N more'", async () => {
    resetLore([entry("key1", { title: "The storm", triggers: triggers(5) })]);
    await edit(async (f) => {
      expect(qa(".wl-ch")).toHaveLength(3);
      await press(f, byLabel("Show 2 more triggers"), 5);
      expect(qa(".wl-ch")).toHaveLength(5);
      await press(f, byLabel("Show fewer triggers"), 5);
      expect(qa(".wl-ch")).toHaveLength(3);
    }, { noPersist: true });
  });
  test("Simple and Advanced switch the mode; Advanced edits each key's percent and cooldown in place", async () => {
    const saved = await edit(async (f) => {
      expect(text()).toContain("100%"); // the entry's own probability badge, in Simple
      await choose(f, ".wl-tm button", "Advanced");
      expect(text()).toContain("per-trigger %");
      await press(f, byLabel("Change trigger probability"), 5);
      blurWith(f, "Trigger probability", "40");
      await settle(f, 5);
      await press(f, byLabel("Change trigger cooldown"), 5);
      blurWith(f, "Trigger cooldown", "3");
    }, { advanced: true });
    expect(saved.triggerMode).toBe("advanced");
    expect(saved.triggers[0]).toMatchObject({ keyword: "storm", probability: 40, frequency: 3 });
  });
  test("Simple's badge writes the entry probability", async () => {
    const saved = await edit(async (f) => { await press(f, byLabel("Entry probability"), 5); blurWith(f, "Entry probability", "35"); }, { advanced: true });
    expect(saved.probability).toBe(35);
  });
  test("the logic menu writes selectiveLogic, and the second box writes secondary keywords", async () => {
    const saved = await edit(async (f) => {
      await press(f, q(".wl-lg > button"), 5);
      await choose(f, ".wl-lg .wl-dd button", "AND ALL");
      add(f, "Add secondary keyword", "lamp");
    }, { advanced: true });
    expect([saved.selectiveLogic, saved.secondaryTriggers.map((t) => t.keyword)]).toEqual(["and_all", ["lamp"]]);
  });
  test("+ Condition (Advanced) offers only the keys a turn evaluates", async () => {
    await edit(async (f) => {
      await choose(f, ".wl-tm button", "Advanced");
      await press(f, qa("button").find((b) => b.textContent === "+ Condition"), 5);
      const items = qa('[aria-label="Insert special condition"] button').map((b) => b.textContent!);
      expect(items.some((i) => i.startsWith("Recency"))).toBe(true);
      expect(items.some((i) => i.startsWith("Lorebook Active"))).toBe(false); // fixed false in assembly
      expect(items.some((i) => i.startsWith("Group Chat"))).toBe(false);
      await press(f, qa('[aria-label="Insert special condition"] button').find((b) => b.textContent!.startsWith("Recency")), 5);
    }, { advanced: true }).then((saved) => expect(saved.triggers.at(-1)).toEqual({ keyword: "[recency:5m]", isRegex: false, probability: 100 }));
  });
});

describe("injection, timing, recursion and group", () => {
  test("each position card writes its position", async () => {
    for (const [card, position] of [["World", "world"], ["Character", "character"], ["Scene", "scene"], ["Top", "prepend_top"], ["Bottom", "append_bottom"]] as const) {
      resetLore([entry("always1", { constant: true, triggers: [] }), entry("key1", { title: "The storm", position: "depth" })]);
      expect((await edit((f) => choose(f, "[data-part='scene.lore.position'] button", card), { advanced: true })).position).toBe(position);
    }
  });
  test("@ Depth and Append take a depth and a role once chosen", async () => {
    const depth = await edit(async (f) => {
      await choose(f, "[data-part='scene.lore.position'] button", "@ Depth");
      number(f, "Injection depth", "6");
      typeInto(f, byLabel("Injection role"), "user");
    }, { advanced: true });
    expect([depth.position, depth.depth, depth.role]).toEqual(["depth", 6, "user"]);
    resetLore();
    const append = await edit(async (f) => { await choose(f, "[data-part='scene.lore.position'] button", "Append"); number(f, "Append depth", "2"); }, { advanced: true });
    expect([append.position, append.depth]).toEqual(["append", 2]);
  });
  test("Sticky, Cool and Delay write their message counts", async () => {
    const saved = await edit((f) => { number(f, "Sticky messages", "3"); number(f, "Cooldown messages", "2"); number(f, "Delay messages", "1"); }, { advanced: true });
    expect([saved.sticky, saved.cooldown, saved.delay]).toEqual([3, 2, 1]);
  });
  test("Normal, Prevent and Delay write the recursion fields", async () => {
    expect(await edit((f) => choose(f, '[aria-label="Recursion"] button', "Prevent"), { advanced: true })).toMatchObject({ preventRecursion: true, delayUntilRecursion: 0 });
    resetLore();
    expect(await edit((f) => choose(f, '[aria-label="Recursion"] button', "Delay"), { advanced: true })).toMatchObject({ preventRecursion: false, delayUntilRecursion: 1 });
    resetLore([entry("key1", { title: "The storm", preventRecursion: true })]);
    expect(await edit((f) => choose(f, '[aria-label="Recursion"] button', "Normal"), { advanced: true })).toMatchObject({ preventRecursion: false, delayUntilRecursion: 0 });
  });
  test("a group is named in the box (existing ones are offered), weighted, and removed", async () => {
    resetLore([entry("key1", { title: "The storm" }), entry("key2", { title: "Sun", groupName: "weather" })]);
    const joined = await edit((f) => { typeInto(f, byLabel("Assign to group"), "wea"); expect(qa(".wl-dd button").map((b) => b.textContent)).toEqual(["weather", "+ Create \"wea\""]); pressKey(f, byLabel("Assign to group")!, "Enter"); number(f, "Group weight", "40"); }, { advanced: true });
    expect([joined.groupName, joined.groupWeight]).toEqual(["wea", 40]);
    resetLore([entry("key1", { title: "The storm", groupName: "weather", groupWeight: 40 })]);
    expect(await edit((f) => press(f, byLabel("Remove from group"), 5), { advanced: true })).toMatchObject({ groupName: null, groupWeight: 100 });
  });
});

describe("the character filter", () => {
  test("Whitelist and Blacklist keep the names and #tags typed; None clears the filter", async () => {
    const filtered = await edit(async (f) => {
      await choose(f, ".wl-cf .modes button", "Whitelist");
      typeInto(f, byLabel("Add character name or tag"), "Aria");
      pressKey(f, byLabel("Add character name or tag")!, "Enter");
      typeInto(f, byLabel("Add character name or tag"), "#hero");
      pressKey(f, byLabel("Add character name or tag")!, "Enter");
      await choose(f, ".wl-cf .modes button", "Blacklist");
    }, { advanced: true });
    expect(filtered.characterFilter).toEqual({ names: ["Aria"], tags: ["hero"], isExclude: true });
    const cleared = await edit((f) => choose(f, ".wl-cf .modes button", "None"), { advanced: true });
    expect(cleared.characterFilter).toBeNull();
  });
  test("a name or tag is removed with its x", async () => {
    resetLore([entry("key1", { title: "The storm", characterFilter: { names: ["Aria", "Zed"], tags: [], isExclude: false } })]);
    const saved = await edit((f) => press(f, byLabel("Remove Aria from character filter"), 5), { advanced: true });
    expect(saved.characterFilter!.names).toEqual(["Zed"]);
  });
});

describe("side effects", () => {
  const rows = () => qa(".wl-fr");
  test("Add Effect adds a Set row; its type, variable, value and scope write through; Remove clears them", async () => {
    const saved = await edit(async (f) => {
      expect(text()).toContain("Side Effects");
      await press(f, byLabel("Add a new side effect"), 5);
      expect(rows()).toHaveLength(1);
      typeInto(f, byLabel("Variable name"), "mood");
      typeInto(f, byLabel("Value"), "wary");
      typeInto(f, byLabel("Scope"), "global");
    }, { advanced: true });
    expect(saved.sideEffects).toEqual({ effects: [{ type: "setvar", variable: "mood", value: "wary", scope: "global" }], onlyOnFirstTrigger: false, clearOnDeactivate: false });
    const gone = await edit((f) => press(f, byLabel("Remove this side effect"), 5), { advanced: true });
    expect(gone.sideEffects).toBeNull();
  });
  test("Increment asks for an amount, not a value, and the two options are checkboxes", async () => {
    const saved = await edit(async (f) => {
      await press(f, byLabel("Add a new side effect"), 5);
      typeInto(f, byLabel("Effect type"), "incvar");
      expect(byLabel("Value")).toBeNull();
      typeInto(f, byLabel("Amount"), "3");
      const boxes = qa<HTMLInputElement>('.wl-fxo input[type="checkbox"]');
      expect(qa(".wl-fxo label").map((l) => l.textContent)).toEqual(["Only on first trigger", "Clear when deactivated"]);
      flushSync2(f, () => boxes[0]!.click());
    }, { advanced: true });
    expect(saved.sideEffects).toMatchObject({ effects: [{ type: "incvar", amount: 3, scope: "local" }], onlyOnFirstTrigger: true, clearOnDeactivate: false });
  });
});
const flushSync2 = (f: FlushSync, fn: () => void): void => f(fn);

describe("cross-entry boosting", () => {
  const books = () => resetLore([entry("always1", { constant: true, triggers: [] }), entry("key1", { title: "The storm" }), entry("key2", { title: "The lantern" }), entry("key3", { title: "The lantern" })]);
  const add = (f: FlushSync, name: string): void => { typeInto(f, byLabel("Entry name to boost"), name); pressKey(f, byLabel("Entry name to boost")!, "Enter"); };

  test("a name resolves to the entry's id, the first target sets the 0.2 the box shows, and the line says the percent", async () => {
    books();
    const saved = await edit((f) => { add(f, "always1"); expect(text()).toContain("boost probability of listed entries by 20%"); expect(qa(".wl-cf .tag.bst").map((t) => t.textContent)).toEqual(["always1\u00d7"]); }, { advanced: true });
    expect([saved.boostIds, saved.boostAmount]).toEqual([["always1"], 0.2]);
  });
  test("the amount is a decimal from 0 to 1", async () => {
    books();
    const saved = await edit((f) => { add(f, "always1"); number(f, "Boost amount", "0.5"); expect(text()).toContain("by 50%"); }, { advanced: true });
    expect(saved.boostAmount).toBe(0.5);
  });
  test("refuses itself, an unknown name, an ambiguous one and a duplicate, each with RoleCall's words", async () => {
    books();
    const saved = await edit((f) => {
      const said = (): string => q('[role="alert"]')?.textContent ?? "";
      add(f, "The storm"); expect(said()).toBe("An entry cannot boost itself.");
      add(f, "nothing"); expect(said()).toBe("No entry in this lorebook has that name.");
      add(f, "The lantern"); expect(said()).toBe("Several entries share that name. Rename one so the target is unambiguous.");
      add(f, "key2"); // by id
      add(f, "key2"); expect(said()).toBe("That entry is already in the boost list.");
      add(f, "  "); expect(said()).toBe("Type the name of another entry in this lorebook.");
    }, { advanced: true });
    expect(saved.boostIds).toEqual(["key2"]);
  });
  test("a target is removed with its x", async () => {
    books();
    const saved = await edit(async (f) => { add(f, "always1"); await press(f, byLabel("Remove always1 from boost list"), 5); }, { advanced: true });
    expect(saved.boostIds).toEqual([]);
  });
});
