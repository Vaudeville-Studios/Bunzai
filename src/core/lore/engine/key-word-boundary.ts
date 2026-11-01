/**
 * The one definition of a "word character" for whole-word lore key matching, shared by
 * triggers-keyword.ts (literal regex) and key-index.ts (trie hit check) so both paths use the same
 * word-character categories. A word character is a Unicode letter, number,
 * combining mark, or underscore, so a Cyrillic, Greek, or accented key matches only at real word
 * edges. Characters of scripts
 * written without spaces (Han, Hiragana, Katakana, Thai) are NOT word characters: they were never
 * word characters under the old ASCII `\W` rule either, so a CJK whole-word key keeps matching
 * inside running text exactly as before. ASCII is unchanged: [A-Za-z0-9_] are word characters,
 * everything else (apostrophes, hyphens, spaces) is a boundary.
 */

const SPACELESS = "\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Thai}";
const BASE_WORD_CLASS = "\\p{L}\\p{N}\\p{M}_";
const WORD_CHAR = `(?![${SPACELESS}])[${BASE_WORD_CLASS}]`;

/** Regex source matching start-of-text or consuming one code point outside WORD_CHAR. */
export const WORD_PREFIX = `(?:^|[^${BASE_WORD_CLASS}]|[${SPACELESS}])`;
export const WORD_LOOKAHEAD = `(?!${WORD_CHAR})`;

const WORD_CHAR_RE = new RegExp(`^${WORD_CHAR}$`, "u");

/** Whether the code point is a word character; ASCII is answered without a regex. */
export function isWordCodePoint(cp: number): boolean {
  if (cp < 128) return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 95;
  return WORD_CHAR_RE.test(String.fromCodePoint(cp));
}

/** The code point ending just before UTF-16 index `end` (so a surrogate pair is read whole). */
export function codePointBefore(text: string, end: number): number {
  const low = text.charCodeAt(end - 1);
  if (low >= 0xdc00 && low <= 0xdfff && end >= 2) {
    const high = text.charCodeAt(end - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(end - 2)!;
  }
  return low;
}
