/**
 * Plain-text and regex keyword matching. Ported from RoleCall's triggers/keyword.ts, with RE2 replaced by Bunzai's ReDoS vet (src/core/regex/validate.ts vetPattern) plus
 * native RegExp, the way src/core/lore/match-keys.ts compiles untrusted regex keys - no new
 * dependency, no invented regex engine. A key the vet refuses (or that fails to compile) never
 * matches, fail closed.
 *
 * Two caches below hold compiled RegExp objects: one per vetted regex trigger, one per whole-word
 * plain keyword. Both are a true LRU (insertion order doubles as recency order, same shape as
 * src/core/tokens/base.ts's countText cache), not a clear-at-cap map, because clearing the whole cache at its cap made a book with more
 * distinct keys than the cap recompile every one of them, every turn.
 *
 * A cache key here IS a lorebook trigger's plaintext keyword - decrypted user content, same as any
 * card or message the token meter's countText cache holds (src/core/tokens/base.ts). So it gets the
 * same treatment: a gate that closes the moment the library locks (checked on every compile, so a
 * turn already running when a lock lands still answers but never re-enters the cache) and a clear
 * that empties both caches outright. src/stage/crypto/keyring.ts's zero() (through the server cache
 * registry's lockAll()) and the browser's LIBRARY_LOCKED_EVENT (through src/ui/_shared/caches.ts's
 * own registry) both call clearKeywordRegexCaches(); keyring.ts also registers
 * setKeywordRegexCacheGate the way it registers setTokenCacheGate, both through one gate source
 * (src/stage/caches.ts's setGate).
 */
import { createBudgetedLru } from "../../caches/budgeted-lru";
import { escapeRegex } from "../../regex/escape";
import { vetPattern } from "../../regex/validate";
import { WORD_LOOKAHEAD, WORD_PREFIX } from "./key-word-boundary";
import type { LorebookBody, LorebookEntry, Trigger } from "../../../entities/lorebook/schema";

export interface KeywordMatchOptions {
  caseSensitive: boolean;
  matchWholeWords: boolean;
}

/** An entry's effective match flags, inheriting the book's globals when the entry leaves them null. */
export function resolveKeywordOptions(entry: LorebookEntry, book: LorebookBody): KeywordMatchOptions {
  return {
    caseSensitive: entry.caseSensitive ?? book.globalCaseSensitive,
    matchWholeWords: entry.matchWholeWords ?? book.globalMatchWholeWords,
  };
}

/** Bounds for each cache below, mirroring src/core/tokens/base.ts's TEXT_CACHE_MAX_ENTRIES /
 * TEXT_CACHE_MAX_CHARS: whichever limit is hit first evicts the oldest entry. 20,000 entries is
 * large enough to hold a massive lorebook's whole working set of compiled keys (the measured worst
 * case is 7,508 whole-word keys on a 5,000-entry book), so the LRU never has to evict an entry the
 * same book will ask for again next turn. 2,000,000 characters of key text is a generous ceiling
 * (keys are short words/short patterns, not message bodies) that still bounds a pathological book
 * with a handful of enormous regex keys. */
const REGEX_CACHE_MAX_ENTRIES = 20_000;
const REGEX_CACHE_MAX_CHARS = 2_000_000;
const vettedRegexCache = createBudgetedLru<string, RegExp | null>({
  maxEntries: REGEX_CACHE_MAX_ENTRIES,
  maxWeightBytes: REGEX_CACHE_MAX_CHARS,
  weightOf: (key) => key.length,
});
const wholeWordRegexCache = createBudgetedLru<string, RegExp>({
  maxEntries: REGEX_CACHE_MAX_ENTRIES,
  maxWeightBytes: REGEX_CACHE_MAX_CHARS,
  weightOf: (key) => key.length,
});

/** Test-only counters: how many times each cache actually compiled (vs. served a hit) since the
 * last reset. Never read by production code. */
let vettedCompiles = 0;
let wholeWordCompiles = 0;

/** Registers what decides whether the caches above may be read or written right now (mirrors
 * src/core/tokens/base.ts's setTokenCacheGate). src/stage/crypto/keyring.ts registers
 * `() => dataKey !== null` alongside its token-cache gate, so both close on the exact same
 * lock/unlock transition. */
export function setKeywordRegexCacheGate(gate: () => boolean): void {
  vettedRegexCache.setGate(gate);
  wholeWordRegexCache.setGate(gate);
}

/** Called once after a real cache write (never a hit) finishes inserting and evicting, so the cache
 * registry (src/stage/caches.ts, src/ui/_shared/caches.ts) can sample memory pressure right after
 * this module's own state actually changed. Open (a no-op) by default, mirroring
 * src/core/tokens/base.ts's setTokenCacheInsertHook. */
export function setKeywordRegexCacheInsertHook(hook: () => void): void {
  vettedRegexCache.setInsertHook(hook);
  wholeWordRegexCache.setInsertHook(hook);
}

/** Both caches in this module together, in bytes - the one figure the cache registry's budget and
 * trim compare against. AN ESTIMATE, documented: UTF-16 key text is 2 bytes/char, plus a flat
 * per-entry overhead (`REGEXP_OBJECT_OVERHEAD_BYTES`) for each compiled RegExp's own JS object and
 * whatever compiled form the engine keeps for it - both opaque to JS, so this is a deliberately
 * generous flat number, not a measurement. */
const REGEXP_OBJECT_OVERHEAD_BYTES = 200;
export function keywordRegexCacheBytes(): number {
  return (vettedRegexCache.bytes() + wholeWordRegexCache.bytes()) * 2 + (vettedRegexCache.size + wholeWordRegexCache.size) * REGEXP_OBJECT_OVERHEAD_BYTES;
}

/** Evicts the oldest entries of both caches - vettedRegexCache first - until keywordRegexCacheBytes()
 * is at or under targetBytes, or only one entry remains in each. A no-op when already at or under
 * target. Registered as this module's `trim` with the cache registry. */
export function trimKeywordRegexCache(targetBytes: number): void {
  while (keywordRegexCacheBytes() > targetBytes && vettedRegexCache.dropOldest()) {
    // loop condition re-checks keywordRegexCacheBytes() each pass
  }
  while (keywordRegexCacheBytes() > targetBytes && wholeWordRegexCache.dropOldest()) {
    // loop condition re-checks keywordRegexCacheBytes() each pass
  }
}

/** `g` makes RegExp.test stateful (it advances `lastIndex` on a match and resumes from there next
 * call) and means nothing extra for a single yes/no `.test()`, so it is dropped before a pattern is
 * compiled or cached. `y` ("sticky": match only exactly at
 * `lastIndex`) is NOT dropped, because that changes what the pattern means - `/dragon/y` matches
 * "dragon here" but not "a dragon", and stripping `y` would silently turn it into an anywhere-in-text
 * search. `y` is kept and its statefulness is handled instead at the call site (matchKeywordTrigger
 * resets `lastIndex = 0` before every `.test()`), so a cached sticky regex always tests fresh from
 * the start of the given text - the same deterministic answer a freshly-constructed `y` regex would
 * give, on every call, regardless of what a previous call against different text left `lastIndex` at. */
function stripGlobalFlag(flags: string): string {
  return flags.replace(/g/g, "");
}

/** Compile an UNTRUSTED regex key only after the static ReDoS vet passes. */
function compileVettedKey(pattern: string, flags: string): RegExp | null {
  const safeFlags = stripGlobalFlag(flags);
  const cacheKey = `${pattern}\0${safeFlags}`;
  const cached = vettedRegexCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  if (vetPattern(pattern, safeFlags)) {
    try {
      compiled = new RegExp(pattern, safeFlags);
    } catch {
      compiled = null;
    }
  }
  vettedCompiles++;
  vettedRegexCache.set(cacheKey, compiled);
  return compiled;
}

function compileWholeWord(keyword: string, caseSensitive: boolean): RegExp {
  const flags = caseSensitive ? "u" : "iu";
  const cacheKey = `${keyword}\0${flags}`;
  const cached = wholeWordRegexCache.get(cacheKey);
  if (cached) return cached;
  const compiled = new RegExp(`${WORD_PREFIX}${escapeRegex(keyword)}${WORD_LOOKAHEAD}`, flags);
  wholeWordCompiles++;
  wholeWordRegexCache.set(cacheKey, compiled);
  return compiled;
}

/** Empties both caches - the production half of the lock contract (see file header). Never touches
 * the compile counters (a test concern) or the gate (a production concern that outlives any one
 * clear); called by src/stage/crypto/keyring.ts's zero() and the browser's LIBRARY_LOCKED_EVENT. */
export function clearKeywordRegexCaches(): void {
  vettedRegexCache.clear();
  wholeWordRegexCache.clear();
}

/** Test-only introspection for both caches above (mirrors src/core/tokens/base.ts's
 * __tokenCacheStatsForTests convention). Never read by production code. */
export function __keywordRegexCacheStatsForTests(): {
  vettedCompiles: number;
  wholeWordCompiles: number;
  vettedSize: number;
  wholeWordSize: number;
} {
  return {
    vettedCompiles,
    wholeWordCompiles,
    vettedSize: vettedRegexCache.size,
    wholeWordSize: wholeWordRegexCache.size,
  };
}

/** Test-only: empties both caches, zeroes both compile counters, and reopens the gate. Never called
 * by production code. */
export function __resetKeywordRegexCachesForTests(): void {
  clearKeywordRegexCaches();
  vettedCompiles = 0;
  wholeWordCompiles = 0;
  setKeywordRegexCacheGate(() => true);
}

/**
 * Match a plain keyword or regex trigger against text. RoleCall's matchKeywordTrigger:
 * - regex triggers use the trigger's own flags, falling back to case-sensitivity-derived
 *   flags only when the trigger carries none ('i' when the entry is not case-sensitive);
 * - plain keywords honor whole-word (no Unicode word character right before or after the key, see
 *   key-word-boundary.ts; multi-word keys work via the space boundary too);
 * - non-whole-word plain keywords are a substring check.
 */
export function matchKeywordTrigger(
  trigger: Trigger,
  text: string,
  options: KeywordMatchOptions,
  textLower?: string,
): boolean {
  const keyword = trigger.keyword;
  if (!keyword) return false;

  if (trigger.isRegex) {
    const flags = trigger.flags ?? (options.caseSensitive ? "" : "i");
    const re = compileVettedKey(keyword, flags);
    if (re === null) return false;
    // `y` (sticky) is the one flag test() still consults lastIndex for, now that `g` is always
    // stripped. Reset before every test so a cached, shared regex always matches fresh from the
    // start of THIS text, never resuming from wherever a previous call (on other text) left off.
    if (re.sticky) re.lastIndex = 0;
    return re.test(text);
  }

  if (options.matchWholeWords) {
    return compileWholeWord(keyword, options.caseSensitive).test(text);
  }

  if (options.caseSensitive) return text.includes(keyword);
  return (textLower ?? text.toLowerCase()).includes(keyword.toLowerCase());
}
