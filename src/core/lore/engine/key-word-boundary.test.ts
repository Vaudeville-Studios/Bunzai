/**
 * Whole-word lore keys use a Unicode word boundary (key-word-boundary.ts). Every case runs through
 * BOTH matchers (triggers-keyword.ts's regex path and key-index.ts's compiled trie) and must give
 * the same, stated answer. The ASCII differential pins the old `(?:^|\W)key(?:$|\W)` result.
 */
import { describe, expect, test } from "bun:test";
import { compileBookKeyIndex, scanBookKeyIndex } from "./key-index";
import { matchKeywordTrigger } from "./triggers-keyword";
import { escapeRegex } from "../../regex/escape";
import { book, entry } from "./_test-helpers";

function bothPaths(key: string, text: string, caseSensitive = false): boolean {
  const viaRegex = matchKeywordTrigger({ keyword: key, isRegex: false }, text, { caseSensitive, matchWholeWords: true });
  const idx = compileBookKeyIndex(book("b", [entry("e", { triggers: [{ keyword: key, isRegex: false }], matchWholeWords: true, caseSensitive })]));
  const viaTrie = scanBookKeyIndex(idx, text).has(key, caseSensitive, true);
  expect(viaTrie).toBe(viaRegex);
  return viaRegex;
}

describe("whole-word keys: non-ASCII letters are word characters", () => {
  const cases: [string, string, string, boolean][] = [
    ["Cyrillic inside a longer word", "Ева", "Евангелие", false],
    ["Cyrillic suffix glued", "Ева", "праЕва", false],
    ["Cyrillic as a whole word", "Ева", "Это Ева, привет", true],
    ["Cyrillic case-insensitive", "ева", "ЕВА пришла", true],
    ["Greek upper vs lower with final sigma", "ΟΔΟΣ", "η οδος", true],
    ["Turkish dotted capital I", "İstanbul", "ISTANBUL İSTANBUL", true],
    ["Cyrillic at string start", "Ева", "Ева ушла", true],
    ["Cyrillic at string end", "Ева", "пришла Ева", true],
    ["Greek inside a longer word", "Αθήνα", "ΑθήναΙοι", false],
    ["Greek whole word", "Αθήνα", "στην Αθήνα.", true],
    ["Greek final sigma, whole word", "Οδυσσέας", "ο Οδυσσέας γύρισε", true],
    ["accented Latin key ending in an accent, at a real edge", "café", "un café, merci", true],
    ["accented Latin key inside a longer word", "café", "cafétéria", false],
    ["ASCII key glued to an accented letter", "cafe", "cafés", false],
    ["ASCII key before a decomposed accent", "cafe", "cafe\u0301 noir", false],
    ["accented letter before the key", "Eve", "éEve", false],
    ["Hangul inside a longer word", "하나", "하나님", false],
    ["Hangul with a space", "하나", "하나 둘", true],
    ["digit neighbor", "Ева", "Ева2", false],
    ["punctuation edges", "Ева", "(Ева)", true],
    ["quotes and ellipsis edges", "Ева", "\u201cЕва\u201d\u2026", true],
    ["apostrophe is a boundary (as in ASCII)", "Ева", "Ева's", true],
    ["underscore is a word char (as in ASCII)", "Ева", "Ева_два", false],
    ["multi-word Cyrillic key", "Ева Браун", "это Ева Браун.", true],
    ["supplementary-plane letter glued", "a", "\u{10400}a", false],
    ["supplementary-plane letter after", "a", "a\u{10400}", false],
    ["later occurrence after an astral letter", "a", "\u{10400}a a", true],
    ["emoji neighbor is a boundary", "Ева", "\u{1F409}Ева\u{1F409}", true],
  ];
  for (const [name, key, text, expected] of cases) {
    test(name, () => expect(bothPaths(key, text)).toBe(expected));
  }

  test("case-sensitive Cyrillic still honors case", () => {
    expect(bothPaths("Ева", "ева пришла", true)).toBe(false);
    expect(bothPaths("Ева", "Ева пришла", true)).toBe(true);
  });

  test("a later whole-word occurrence can match after an earlier glued occurrence", () => {
    expect(bothPaths("a a", "xa a a")).toBe(true);
  });

  test("the cached whole-word matcher resets its scan on every call", () => {
    const trigger = { keyword: "a", isRegex: false };
    const options = { caseSensitive: false, matchWholeWords: true };
    for (let i = 0; i < 3; i++) expect(matchKeywordTrigger(trigger, "a", options)).toBe(true);
  });

  test("bounded child keeps repeated literal candidates out of the matcher loop", () => {
    const matcherUrl = new URL("./triggers-keyword.ts", import.meta.url).href;
    const child = `
      import { matchKeywordTrigger } from ${JSON.stringify(matcherUrl)};
      const trigger = { keyword: "a".repeat(4096), isRegex: false };
      const options = { caseSensitive: true, matchWholeWords: true };
      const text = "a".repeat(8192);
      matchKeywordTrigger(trigger, text, options);
      const astralKey = String.fromCodePoint(0x10400);
      const astral = [true, false].map(caseSensitive => {
        const astralOptions = { caseSensitive, matchWholeWords: true };
        return [
          matchKeywordTrigger({ keyword: astralKey, isRegex: false }, "x" + astralKey, astralOptions),
          matchKeywordTrigger({ keyword: astralKey, isRegex: false }, "x" + astralKey + " " + astralKey, astralOptions),
        ];
      });
      const originalExec = RegExp.prototype.exec;
      let calls = 0;
      RegExp.prototype.exec = function (input) { calls++; return originalExec.call(this, input); };
      try {
        const matched = matchKeywordTrigger(trigger, text, options);
        console.log(JSON.stringify({ astral, matched, calls }));
        if (matched || calls < 1 || calls > 8 || JSON.stringify(astral) !== "[[false,true],[false,true]]") process.exitCode = 1;
      } finally { RegExp.prototype.exec = originalExec; }
    `;
    const result = Bun.spawnSync([process.execPath, "-e", child], { cwd: import.meta.dir, env: process.env, timeout: 10_000 });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout.toString().trim());
    expect(output.astral).toEqual([[false, true], [false, true]]);
    expect(output.matched).toBe(false);
    expect(output.calls).toBeGreaterThanOrEqual(1);
    expect(output.calls).toBeLessThanOrEqual(8);
  });
});

describe("whole-word keys: spaceless scripts keep the old behaviour (documented rule)", () => {
  // Han, Hiragana, Katakana, and Thai have no word gaps in running text, so they are not word
  // characters: a CJK whole-word key matches inside running CJK text, exactly as `\W` did before.
  const cases: [string, string, string, boolean][] = [
    ["Han key inside running Han text", "龍", "巨龍王", true],
    ["Han key next to ASCII letters is NOT a boundary", "龍", "x龍", false],
    ["ASCII key inside running Han text", "cat", "龍cat城", true],
    ["Hiragana key in running text", "ねこ", "これはねこです", true],
    ["Katakana long-vowel mark is not a word char", "ネコ", "ネコー", true],
    ["Thai key in running text", "แมว", "ฉันมีแมวสองตัว", true],
    ["Han key glued to a Cyrillic letter is not a boundary", "龍", "Е龍", false],
  ];
  for (const [name, key, text, expected] of cases) {
    test(name, () => expect(bothPaths(key, text)).toBe(expected));
  }
});

describe("whole-word keys: ASCII results are identical to the old (?:^|\W)key(?:$|\W) rule", () => {
  const keys = ["cat", "Cat", "C++", "o'clock", "a-b", "x_y", "New York", "1999", ".", "é".normalize("NFD").slice(0, 1)];
  const texts = [
    "", "cat", "Cat", "CAT", "the cat sat", "concat", "catalog", "cat's", "cat_", "_cat", "cat-cat", "cat.", "(cat)", "cat2", "2cat",
    "C++ and C+++", "c++", "xC++", "o'clock", "at o'clock sharp", "no'clock", "a-b", "a-bc", "ca-b", "x_y", "x_yz", "New York City",
    "New Yorker", "in 1999.", "11999", ".", "a.b", "tab\tcat\nline", "龍cat城", "\u{1F409}cat\u{1F409}", "cat\u{1F409}", "e",
  ];
  for (const key of keys) {
    for (const caseSensitive of [false, true]) {
      test(`${JSON.stringify(key)} caseSensitive=${caseSensitive}`, () => {
        const legacy = new RegExp(String.raw`(?:^|\W)${escapeRegex(key)}(?:$|\W)`, caseSensitive ? "" : "i");
        for (const text of texts) expect([key, text, bothPaths(key, text, caseSensitive)]).toEqual([key, text, legacy.test(text)]);
      });
    }
  }
});
