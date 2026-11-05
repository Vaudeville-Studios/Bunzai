/** The World wing's rules: the scene's own choice, the last-turn label, and moving/adding entries. */
import { describe, expect, test } from "bun:test";
import type { LorebookEntry } from "../../../entities/lorebook/schema";
import type { SceneLoreBook, SceneLoreFired } from "../../app-contract-scenes";
import { emptyLoreEntry } from "../../../core/lore";
import {
  addBook, choiceFromBooks, fireLabel, footerLine, loreTabMeta, moveEntry,
  entryMatches, entryTokens, groupNamesOf, kfmt, nextSortOrder, parseTriggerInput, removeBook, sameChoice, sourceBadge, statLine, toggleBook,
} from "./lore-core";

const book = (id: string, over: Partial<SceneLoreBook> = {}): SceneLoreBook =>
  ({ id, name: id, source: "character", addedByScene: false, enabled: true, missing: false, entries: 1, tokens: 10, ...over });

describe("choiceFromBooks", () => {
  test("added is the scene's own books; off is whichever are disabled, whatever their source", () => {
    const books = [book("a"), book("b", { source: "scene", addedByScene: true }), book("c", { source: "persona", addedByScene: false, enabled: false })];
    expect(choiceFromBooks(books)).toEqual({ added: ["b"], off: ["c"] });
  });
});

describe("choiceFromBooks keeps the scene's own additions", () => {
  test("a book the scene added stays added when the character also links it", () => {
    const linked = { id: "x", name: "Shared", source: "character" as const, addedByScene: true, enabled: true, missing: false, entries: 1, tokens: 1 };
    expect(choiceFromBooks([linked]).added).toEqual(["x"]);
  });
});

describe("toggleBook", () => {
  test("switching off adds to off; switching on removes it; no duplicates", () => {
    expect(toggleBook({ added: [], off: [] }, "a", false)).toEqual({ added: [], off: ["a"] });
    expect(toggleBook({ added: [], off: ["a"] }, "a", false)).toEqual({ added: [], off: ["a"] });
    expect(toggleBook({ added: [], off: ["a", "b"] }, "a", true)).toEqual({ added: [], off: ["b"] });
  });
});

describe("addBook", () => {
  test("adds once, and switches a previously-off id back on", () => {
    expect(addBook({ added: [], off: [] }, "a")).toEqual({ added: ["a"], off: [] });
    expect(addBook({ added: ["a"], off: [] }, "a")).toEqual({ added: ["a"], off: [] });
    expect(addBook({ added: [], off: ["a"] }, "a")).toEqual({ added: ["a"], off: [] });
  });
});

describe("removeBook", () => {
  test("drops it from added, and from off too", () => {
    expect(removeBook({ added: ["a", "b"], off: ["a"] }, "a")).toEqual({ added: ["b"], off: [] });
    expect(removeBook({ added: ["b"], off: ["c"] }, "a")).toEqual({ added: ["b"], off: ["c"] });
  });
});

test("sameChoice ignores order", () => {
  expect(sameChoice({ added: ["a", "b"], off: [] }, { added: ["b", "a"], off: [] })).toBe(true);
  expect(sameChoice({ added: ["a"], off: [] }, { added: ["a", "b"], off: [] })).toBe(false);
});

describe("fireLabel", () => {
  const fired = (over: Partial<SceneLoreFired> = {}): SceneLoreFired =>
    ({ bookId: "b", entryId: "e", title: "E", reason: "key", matched: [], tokens: 5, cut: false, ...over });

  test("constant always shows 'always'", () => {
    expect(fireLabel(fired({ reason: "constant" }))).toEqual({ text: "always", cls: "c-con" });
  });
  test("key and secondary show the first matched word in quotes", () => {
    expect(fireLabel(fired({ reason: "key", matched: ["storm", "flood"] }))).toEqual({ text: '"storm"', cls: "c-key" });
    expect(fireLabel(fired({ reason: "secondary", matched: ["keeper"] }))).toEqual({ text: '"keeper"', cls: "c-key" });
  });
  test("sticky shows 'sticky'", () => {
    expect(fireLabel(fired({ reason: "sticky", matched: ["x"] }))).toEqual({ text: "sticky", cls: "c-stk" });
  });
  test("recursion, special, and emotion show the word itself, unquoted", () => {
    expect(fireLabel(fired({ reason: "recursion", matched: ["dream"] }))).toEqual({ text: "dream", cls: "c-key" });
    expect(fireLabel(fired({ reason: "special", matched: ["ritual"] }))).toEqual({ text: "ritual", cls: "c-key" });
    expect(fireLabel(fired({ reason: "emotion", matched: ["grief"] }))).toEqual({ text: "grief", cls: "c-key" });
  });
  test("cut wins over the reason, whatever it was", () => {
    expect(fireLabel(fired({ reason: "constant", cut: true }))).toEqual({ text: "matched, over budget", cls: "c-cut" });
  });
});

test("footerLine counts only entries the budget did not cut", () => {
  const fired = (id: string, cut: boolean): SceneLoreFired => ({ bookId: "b", entryId: id, title: id, reason: "key", matched: ["x"], tokens: 10, cut });
  expect(footerLine({ fired: [fired("a", false), fired("b", false), fired("c", true)], totalTokens: 740 })).toBe("2 fired · ~740 tok");
});

describe("loreTabMeta", () => {
  test("RoleCall's count: the books switched on, as 'N linked', 0 before any load", () => {
    expect(loreTabMeta(null)).toBe("0 linked");
    expect(loreTabMeta([])).toBe("0 linked");
    expect(loreTabMeta([book("a"), book("b", { enabled: false }), book("c")])).toBe("2 linked");
    expect(loreTabMeta([book("a")])).toBe("1 linked");
  });
});

describe("sourceBadge", () => {
  test("names the character, names your persona, or says it was added here", () => {
    expect(sourceBadge({ source: "character" }, "Marguerite Vane")).toBe("From Marguerite Vane");
    expect(sourceBadge({ source: "persona" }, "Marguerite Vane")).toBe("From your persona");
    expect(sourceBadge({ source: "scene" }, "Marguerite Vane")).toBe("Added here");
  });
});

const withOrder = (id: string, over: Partial<LorebookEntry> = {}): LorebookEntry => ({ ...emptyLoreEntry(id), ...over });

describe("nextSortOrder", () => {
  test("one past the highest sortOrder; 0 with no entries", () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([withOrder("a", { sortOrder: 5 }), withOrder("b", { sortOrder: 12 })])).toBe(13);
  });
});

describe("moveEntry", () => {
  const a = withOrder("a", { constant: true, sortOrder: 1 });
  const b = withOrder("b", { constant: true, sortOrder: 2 });
  const c = withOrder("c", { constant: false, sortOrder: 1 });

  test("swaps sortOrder with the neighbor in the same group", () => {
    const moved = moveEntry([a, b, c], "b", "up");
    expect(moved.find((e) => e.id === "a")!.sortOrder).toBe(2);
    expect(moved.find((e) => e.id === "b")!.sortOrder).toBe(1);
    expect(moved.find((e) => e.id === "c")!.sortOrder).toBe(1); // a different group: untouched
  });

  test("never crosses into the other group", () => {
    // "a" is already first among Constant entries; "c" (Selective) is not a valid neighbor.
    const entries = [a, b, c];
    expect(moveEntry(entries, "a", "up")).toBe(entries);
  });

  test("no neighbor: returns the same array reference, so a caller's dirty check can skip the save", () => {
    const entries = [a, b];
    expect(moveEntry(entries, "a", "up")).toBe(entries);
    expect(moveEntry(entries, "b", "down")).toBe(entries);
  });

  test("an unknown id: returns the same array reference", () => {
    const entries = [a, b];
    expect(moveEntry(entries, "nope", "up")).toBe(entries);
  });

  test("a tied sortOrder: the swap would change nothing, so it is a no-op too", () => {
    const tied = [withOrder("x", { constant: true, sortOrder: 5 }), withOrder("y", { constant: true, sortOrder: 5 })];
    expect(moveEntry(tied, "y", "up")).toBe(tied);
  });
});

describe("the header's stat line", () => {
  test("browsing counts books; an open book does not", () => {
    expect(statLine({ books: 1, entries: 213, tokens: 92_600 })).toBe("· 1 book · 213 entries · 92.6k tok");
    expect(statLine({ books: 0, entries: 0, tokens: 0 })).toBe("· 0 books · 0 entries · 0 tok");
    expect(statLine({ entries: 1, tokens: 999 })).toBe("· 1 entry · 999 tok");
  });
  test("kfmt reads thousands with one decimal", () => {
    expect([kfmt(999), kfmt(1_000), kfmt(75_049)]).toEqual(["999", "1.0k", "75.0k"]);
  });
});

describe("entry search and counts", () => {
  const e = (over: Partial<LorebookEntry>): LorebookEntry => ({ ...emptyLoreEntry("x"), ...over });
  test("matches a title, the content, or a trigger, ignoring case; blank matches all", () => {
    const harbour = e({ title: "Harbour", content: "salt and tar", triggers: [{ keyword: "Dock", isRegex: false }] });
    expect(["harb", "TAR", "dock", "  ", "lamp"].map((q) => entryMatches(harbour, q))).toEqual([true, true, true, true, false]);
  });
  test("a token count is remembered per entry object, and an edited copy is counted again", () => {
    const a = e({ content: "one two three" });
    expect(entryTokens(a)).toBe(entryTokens(a));
    expect(entryTokens({ ...a, content: "one two three four five six seven eight nine ten" })).toBeGreaterThan(entryTokens(a));
  });
  test("group names are listed once, sorted", () => {
    expect(groupNamesOf([e({ groupName: "weather" }), e({ groupName: null }), e({ groupName: "bells" }), e({ groupName: "weather" })])).toEqual(["bells", "weather"]);
  });
});

describe("parseTriggerInput", () => {
  test("a plain word is a keyword", () => {
    expect(parseTriggerInput("  storm ")).toEqual({ ok: true, trigger: { keyword: "storm", isRegex: false } });
  });
  test("/pattern/flags is a regex with its flags", () => {
    expect(parseTriggerInput("/mage|wizard/i")).toEqual({ ok: true, trigger: { keyword: "mage|wizard", isRegex: true, flags: "i" } });
    expect(parseTriggerInput("/a+/")).toEqual({ ok: true, trigger: { keyword: "a+", isRegex: true } });
  });
  test("a regex that will not compile is refused with its reason", () => {
    const refused = parseTriggerInput("/(/");
    expect(refused.ok).toBe(false);
  });
});
