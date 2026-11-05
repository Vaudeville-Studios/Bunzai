/**
 * The World wing's rules (approved wireframe rc-port/scene-lorebook-wing.html, version B; RoleCall's
 * LorebookPanel and ActiveLorePanel): the scene's own lore choice, built fresh from the books it
 * currently reads; how an entry that fired on the last turn reads in one line; the injection grid;
 * and moving/adding entries within a book. The recursion fold moved to
 * src/ui/_shared/lore-recursion.ts (2e-d7 plan step 4): both this wing and the Workbench's own lore
 * editor use it now. Pure.
 */
import type { InjectionPosition, LorebookEntry, Trigger } from "../../../entities/lorebook/schema";
import { countText } from "../../../core/tokens";
import { toErrorMessage } from "../../../error-message";
import type { SceneLoreBook, SceneLoreChoice, SceneLoreFired } from "../../app-contract-scenes";

const dedup = (ids: readonly string[]): string[] => [...new Set(ids)];

/** The scene's own choice as the current books already reflect it: which it added, which it turned off. */
export function choiceFromBooks(books: readonly SceneLoreBook[]): SceneLoreChoice {
  return {
    added: dedup(books.filter((b) => b.addedByScene).map((b) => b.id)),
    off: dedup(books.filter((b) => !b.enabled).map((b) => b.id)),
  };
}

/** Switching a book on or off; no duplicate entries in `off`. */
export function toggleBook(choice: SceneLoreChoice, bookId: string, on: boolean): SceneLoreChoice {
  const off = choice.off.filter((id) => id !== bookId);
  return { added: choice.added, off: on ? off : dedup([...off, bookId]) };
}

/**
 * Removing a book this scene added: drops it from `added`, and from `off` too - a book that no
 * longer belongs to the scene cannot stay switched off for it.
 */
export function removeBook(choice: SceneLoreChoice, bookId: string): SceneLoreChoice {
  return { added: choice.added.filter((id) => id !== bookId), off: choice.off.filter((id) => id !== bookId) };
}

/** Adding a library book to the scene; no duplicates, and it starts switched on. */
export function addBook(choice: SceneLoreChoice, bookId: string): SceneLoreChoice {
  return { added: dedup([...choice.added, bookId]), off: choice.off.filter((id) => id !== bookId) };
}

export const sameChoice = (a: SceneLoreChoice, b: SceneLoreChoice): boolean =>
  a.added.length === b.added.length && a.off.length === b.off.length
  && a.added.every((id) => b.added.includes(id)) && a.off.every((id) => b.off.includes(id));

export interface FireLabel { text: string; cls: "c-con" | "c-key" | "c-stk" | "c-cut" }

/** How one entry's last-turn firing reads. A budget cut always wins over the reason it matched for. */
export function fireLabel(fired: SceneLoreFired): FireLabel {
  if (fired.cut) return { text: "matched, over budget", cls: "c-cut" };
  const word = fired.matched[0] ?? "";
  switch (fired.reason) {
    case "constant": return { text: "always", cls: "c-con" };
    case "sticky": return { text: "sticky", cls: "c-stk" };
    case "key":
    case "secondary": return { text: `"${word}"`, cls: "c-key" };
    default: return { text: word, cls: "c-key" }; // recursion, special, emotion: the word itself
  }
}

/** The side-foot's "N fired · ~T tok" line; N counts only entries the budget did not cut. */
export function footerLine(lastTurn: { fired: SceneLoreFired[]; totalTokens: number }): string {
  const n = lastTurn.fired.filter((f) => !f.cut).length;
  return `${n} fired · ~${lastTurn.totalTokens.toLocaleString()} tok`;
}

/** The Lorebook card's second line, RoleCall's own count ("2 linked", `LeftWingPanelContent.tsx:249`): the books switched on. */
export const loreTabMeta = (books: readonly SceneLoreBook[] | null): string => `${(books ?? []).filter((b) => b.enabled).length} linked`;

/** The source badge (version B): where a book this scene reads came from. */
export function sourceBadge(book: Pick<SceneLoreBook, "source">, characterName: string): string {
  if (book.source === "character") return `From ${characterName}`;
  if (book.source === "persona") return "From your persona";
  return "Added here";
}

// -- the injection grid: the seven spots the wireframe draws, each a real canonical position --------

export const POSITION_SPOTS: readonly { value: InjectionPosition; label: string }[] = [
  { value: "world", label: "World" },
  { value: "character", label: "Character" },
  { value: "scene", label: "Scene" },
  { value: "depth", label: "@ Depth" },
  { value: "append", label: "Append" },
  { value: "prepend_top", label: "Top" },
  { value: "append_bottom", label: "Bottom" },
];

// -- moving and adding entries: the row "..." menu and "New entry" (2e-d7 plan steps 2 and 3) --------

/** One past the book's current highest sortOrder; -1 with no entries, so the first one lands at 0. */
export const nextSortOrder = (entries: readonly LorebookEntry[]): number =>
  entries.reduce((max, e) => Math.max(max, e.sortOrder), -1) + 1;

/**
 * Moves an entry up or down within its own group (Constant vs Selective, ordered by sortOrder),
 * swapping sortOrder with the neighbor it passes. No neighbor there (already first/last, entries
 * missing), or the neighbor shares its sortOrder (the swap would change nothing): returns the same
 * array reference, so a caller's dirty check can skip the save.
 */
export function moveEntry(entries: readonly LorebookEntry[], entryId: string, direction: "up" | "down"): LorebookEntry[] {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return entries as LorebookEntry[];
  const group = entries.filter((e) => e.constant === entry.constant).sort((a, b) => a.sortOrder - b.sortOrder);
  const at = group.findIndex((e) => e.id === entryId);
  const other = group[direction === "up" ? at - 1 : at + 1];
  if (!other || other.sortOrder === entry.sortOrder) return entries as LorebookEntry[];
  return entries.map((e) => {
    if (e.id === entry.id) return { ...e, sortOrder: other.sortOrder };
    if (e.id === other.id) return { ...e, sortOrder: entry.sortOrder };
    return e;
  });
}

// -- header stats, token counts, and typed keywords -------------------------------------------------------------

const tokenMemo = new WeakMap<LorebookEntry, number>();
/** One entry's token estimate, remembered by the entry object: an edit makes a new object, so only it is recounted. */
export function entryTokens(entry: LorebookEntry): number {
  let n = tokenMemo.get(entry);
  if (n === undefined) { n = countText(entry.content); tokenMemo.set(entry, n); }
  return n;
}

/** RoleCall's compact count: 1,250 reads "1.3k", under a thousand stays whole. */
export const kfmt = (n: number): string => (n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

/** The header's inline stat line: with books ("1 book, 213 entries") when browsing, without once a book is open. */
export function statLine(stats: { books?: number; entries: number; tokens: number }): string {
  const parts = [stats.books === undefined ? null : `${stats.books} book${stats.books === 1 ? "" : "s"}`, `${stats.entries} entr${stats.entries === 1 ? "y" : "ies"}`, `${kfmt(stats.tokens)} tok`];
  return parts.filter(Boolean).map((p) => `· ${p}`).join(" ");
}

/** The entry list's search: title, content, or any trigger keyword, case-insensitive. */
export const entryMatches = (e: LorebookEntry, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.triggers.some((t) => t.keyword.toLowerCase().includes(q));
};

export type TriggerInput = { ok: true; trigger: Trigger } | { ok: false; error: string };

/** What Enter does in a trigger box: "/pattern/flags" becomes a regex trigger (refused when it will not compile), anything else a plain keyword. */
export function parseTriggerInput(text: string): TriggerInput {
  const keyword = text.trim();
  const literal = /^\/(.+)\/([a-z]*)$/.exec(keyword);
  if (!literal) return { ok: true, trigger: { keyword, isRegex: false } };
  const [, pattern = "", flags = ""] = literal;
  try {
    new RegExp(pattern, flags);
  } catch (e) {
    return { ok: false, error: toErrorMessage(e, "that is not a valid regex") };
  }
  return { ok: true, trigger: { keyword: pattern, isRegex: true, ...(flags ? { flags } : {}) } };
}

export type BoostTarget = { ok: true; id: string } | { ok: false; error: string };

/** RoleCall's resolveBoostTarget (boost-targets.ts): what was typed names one other entry of this book, by id or by exact title; ambiguity is refused, not guessed. */
export function resolveBoostTarget(input: string, candidates: readonly { id: string; title: string }[], selfId: string, existing: readonly string[]): BoostTarget {
  const query = input.trim();
  if (!query) return { ok: false, error: "Type the name of another entry in this lorebook." };
  const byId = candidates.find((c) => c.id === query);
  const matches = byId ? [byId] : candidates.filter((c) => c.title.trim().toLowerCase() === query.toLowerCase());
  if (matches.length === 0) return { ok: false, error: "No entry in this lorebook has that name." };
  if (matches.length > 1) return { ok: false, error: "Several entries share that name. Rename one so the target is unambiguous." };
  const id = matches[0]!.id;
  if (id === selfId) return { ok: false, error: "An entry cannot boost itself." };
  if (existing.includes(id)) return { ok: false, error: "That entry is already in the boost list." };
  return { ok: true, id };
}

/** The group names a book already uses, for the Group box's suggestions. */
export const groupNamesOf = (entries: readonly LorebookEntry[]): string[] => [...new Set(entries.flatMap((e) => (e.groupName ? [e.groupName] : [])))].sort();
