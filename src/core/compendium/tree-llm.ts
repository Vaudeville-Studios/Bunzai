/**
 * What the model is asked to do when a tree is built, and how its answer is read (RoleCall `lib/lorebook/tv-tree-llm.ts:15-110,
 * 641-700`, adapted from a forced tool call to one JSON answer, F13): the granularity presets, the RoleCall categorize prompt,
 * the second-pass assignment against a fixed category list, the person's constraints as a hard-rules block, and the strict parse of
 * each answer into known shapes. An answer is read once here; an entry number out of range, a listed-twice entry or a path that
 * was not offered is dropped and never invented, and an answer with no categories is reported, not turned into an empty tree. Pure.
 */
import type { LorebookEntry } from "../../entities/lorebook/schema";
import type { ChatCompendiumTreeBuild, ChatCompendiumTreeConstraints } from "../../stage/contracts/chat-settings-types";
import { isRecord, optStr } from "../guards";
import { extractObject } from "../model-json";
import type { CompendiumEntry } from "./read";

export interface GranularityPreset { targetCategories: string; maxEntries: number; label: string }

const PRESETS: Record<1 | 2 | 3 | 4, GranularityPreset> = {
  1: { targetCategories: "3-5", maxEntries: 20, label: "Minimal" },
  2: { targetCategories: "5-8", maxEntries: 12, label: "Moderate" },
  3: { targetCategories: "8-15", maxEntries: 8, label: "Detailed" },
  4: { targetCategories: "12-20", maxEntries: 5, label: "Extensive" },
};

/** RoleCall's presets; Auto (0) scales with the book (`:55-69`). */
export function resolvePreset(level: NonNullable<ChatCompendiumTreeBuild["granularity"]>, count: number): GranularityPreset {
  return PRESETS[level !== 0 ? level : count >= 3_000 ? 4 : count >= 1_000 ? 3 : count >= 200 ? 2 : 1];
}

/** Rough tokens one entry costs at each detail level, and the most one call may carry (`:2205-2214`). */
export const DETAIL_TOKENS = { names: 30, lite: 120, full: 2_000 } as const;
export const TOKEN_BUDGET = 150_000;

const keywordsOf = (raw: LorebookEntry): string[] => raw.triggers.filter((t) => !t.isRegex && t.keyword.trim() !== "").map((t) => t.keyword.trim());

/** One entry as the model sees it, numbered from 0: names only; with keywords and a short teaser; or with a content preview. */
export function entryLine(e: CompendiumEntry, raw: LorebookEntry, index: number, detail: NonNullable<ChatCompendiumTreeBuild["detail"]>): string {
  if (detail === "names") return `${index}. ${e.name}`;
  const keys = keywordsOf(raw);
  const head = `${index}. ${e.name}${keys.length > 0 ? ` [keywords: ${keys.slice(0, 8).join(", ")}]` : ""}`;
  const body = detail === "full" ? raw.content.replace(/\s+/g, " ").slice(0, 400) : (e.tagline || raw.content.replace(/\s+/g, " ")).slice(0, 80);
  return body ? `${head}: ${body}` : head;
}

/** The person's choices as hard rules the model must keep (RoleCall `constraint-helpers.ts` `formatConstraintBlock`); `names` gives a branch or entry its words. */
export function constraintBlock(c: ChatCompendiumTreeConstraints, names: ReadonlyMap<string, string>): string {
  const list = (ids: readonly string[] | undefined) => (ids ?? []).map((id) => `  - ${names.get(id) ?? id}`);
  const parts: string[] = [];
  const add = (head: string, ids: readonly string[] | undefined) => { const lines = list(ids); if (lines.length > 0) parts.push(head, ...lines, ""); };
  add("LOCKED (do not modify; leave the contents as they are):", c.locked);
  add("FORBIDDEN (never create it; put its entries in other categories, even a category of one for an outlier):", c.forbidden);
  add("REORGANIZE (one time only; redistribute the entries inside these into better categories on this build):", c.reorganize);
  return parts.length === 0 ? "" : `\n\n## USER CONSTRAINTS - HARD RULES\n\nThese user-set constraints MUST be respected. They override any heuristic you prefer. Breaking one is a critical failure.\n\n${parts.join("\n")}`.trimEnd();
}

const language = (name: string): string => (name.trim() ? `\n\nWrite every category name and summary in ${name.trim()}.` : "");

export function categorizeMessages(input: { preset: GranularityPreset; lines: readonly string[]; block: string; language: string }): { system: string; user: string } {
  const { preset } = input;
  const system = `You are organizing a lorebook into a hierarchical tree for efficient retrieval by an AI during roleplay.

Read every entry carefully - use titles, keywords, AND content to understand what each entry is about.

Rules:
- Create ${preset.targetCategories} top-level categories that reflect the actual subject matter
- Each category SHOULD have sub-categories ("children") where natural groupings exist
- Aim for no more than ${preset.maxEntries} entries per leaf node - use deeper hierarchy to achieve this
- Common categories: Characters, Locations, Factions, Items, Magic/Abilities, Lore/History, Creatures, Events, World Rules, Relationships - but adapt to the actual content
- Every entry must appear exactly once
- Category names should be concise (1-3 words)

Respond with ONLY valid JSON in this exact format:
{
  "summary": "1-3 sentences describing this lorebook's world, referencing specific characters, places, and concepts by name.",
  "categories": [
    { "name": "Category Name", "summary": "Brief description of what this category covers", "entries": [0, 3],
      "children": [ { "name": "Sub-Category", "summary": "Description", "entries": [7, 12], "children": [] } ] }
  ]
}

The "entries" arrays contain INDEX numbers from the input list. Entries can be at any level - top-level category or nested children.
The "summary" fields MUST reference specific names, places, and concepts - never write generic descriptions.
Create sub-categories ("children") wherever entries naturally cluster by sub-topic.${input.block}${language(input.language)}`;
  return { system, user: `Here are the lorebook entries to organize into a hierarchical tree:\n\n${input.lines.join("\n")}` };
}

/** Pass two of a big book: place numbered entries into a category list that is already fixed. */
export function assignMessages(input: { paths: readonly string[]; lines: readonly string[]; language: string }): { system: string; user: string } {
  const system = `You are filing lorebook entries into a category tree that is already built. Do not add, rename or remove categories.

CATEGORY PATHS (copy one verbatim for each entry):
${input.paths.map((p) => `- ${p}`).join("\n")}

Rules:
- Give every entry exactly one path, the deepest one that fits.
- "path" must be one of the paths above, copied exactly.

Respond with ONLY valid JSON: {"assignments":[{"entry":0,"path":"Characters/Allies"}]}${language(input.language)}`;
  return { system, user: `Entries to file:\n\n${input.lines.join("\n")}` };
}

/** The one repair request, as filing's: the same task, the answer that did not parse, and why. */
export const repairTree = (first: { system: string; user: string }, answer: string, error: string): { system: string; user: string } =>
  ({ system: first.system, user: `${first.user}\n\nYour previous answer could not be used (${error}):\n\n${answer.slice(0, 2000)}\n\nAnswer again with only the JSON object.` });

export interface RawCategory { name: string; summary: string; entries: number[]; children: RawCategory[] }
export type CategoryParse = { ok: true; summary: string; categories: RawCategory[] } | { ok: false; error: string };

const MAX_DEPTH = 6;

function readCategory(raw: unknown, count: number, seen: Set<number>, depth: number): RawCategory | string {
  if (!isRecord(raw)) return "a category is not an object";
  const name = optStr(raw["name"])?.trim();
  if (!name) return "a category has no name";
  if (depth > MAX_DEPTH) return `categories nest deeper than ${MAX_DEPTH} levels`;
  const entries: number[] = [];
  for (const n of Array.isArray(raw["entries"]) ? raw["entries"] : []) {
    if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n < count && !seen.has(n)) { seen.add(n); entries.push(n); }
  }
  const children: RawCategory[] = [];
  for (const c of Array.isArray(raw["children"]) ? raw["children"] : []) {
    const read = readCategory(c, count, seen, depth + 1);
    if (typeof read === "string") return read;
    children.push(read);
  }
  return { name: name.replaceAll("/", "-").slice(0, 80), summary: (optStr(raw["summary"]) ?? "").slice(0, 400), entries, children };
}

export function parseCategories(text: string, count: number): CategoryParse {
  const answer = extractObject(text);
  if (!isRecord(answer)) return { ok: false, error: "the answer is not a JSON object" };
  const list = answer["categories"];
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'the answer has no "categories" list' };
  const seen = new Set<number>();
  const categories: RawCategory[] = [];
  for (const c of list) {
    const read = readCategory(c, count, seen, 1);
    if (typeof read === "string") return { ok: false, error: read };
    categories.push(read);
  }
  return { ok: true, summary: (optStr(answer["summary"]) ?? "").slice(0, 1_000), categories };
}

export type AssignParse = { ok: true; assigned: Map<number, string> } | { ok: false; error: string };

export function parseAssignments(text: string, count: number, paths: readonly string[]): AssignParse {
  const answer = extractObject(text);
  const list = isRecord(answer) ? answer["assignments"] : undefined;
  if (!Array.isArray(list)) return { ok: false, error: 'the answer has no "assignments" list' };
  const offered = new Set(paths);
  const assigned = new Map<number, string>();
  for (const a of list) {
    if (!isRecord(a)) continue;
    const entry = a["entry"];
    const path = a["path"];
    if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry < count && typeof path === "string" && offered.has(path) && !assigned.has(entry)) assigned.set(entry, path);
  }
  return { ok: true, assigned };
}

/** Every category's path, "Parent/Child", in answer order: what pass two offers. */
export function categoryPaths(categories: readonly RawCategory[], prefix = ""): string[] {
  return categories.flatMap((c) => { const p = prefix ? `${prefix}/${c.name}` : c.name; return [p, ...categoryPaths(c.children, p)]; });
}

/** The categories with these entries moved to the paths the second pass chose; an entry whose path is not there stays where pass one put it. */
export function reassign(categories: readonly RawCategory[], assigned: ReadonlyMap<number, string>): RawCategory[] {
  const moved = new Set(assigned.keys());
  const strip = (cs: readonly RawCategory[]): RawCategory[] => cs.map((c) => ({ ...c, entries: c.entries.filter((n) => !moved.has(n)), children: strip(c.children) }));
  const out = strip(categories);
  const find = (cs: RawCategory[], path: string[]): RawCategory | undefined => { const c = cs.find((x) => x.name === path[0]); return c && path.length > 1 ? find(c.children, path.slice(1)) : c; };
  for (const [n, path] of assigned) find(out, path.split("/"))?.entries.push(n);
  return out;
}
