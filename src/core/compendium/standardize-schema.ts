/**
 * The boundary where a Standardize answer becomes known items (04b F13): one JSON object `{ "entries": [{ "source": n, "items":
 * [{ "type", "entry": { ...fields } }] }] }`, parsed once. Each item is checked alone against its type (`checkItem`, the filing
 * path's own), so one bad item is rejected and named while the rest of its source goes on. An answer that is cut off, or has one
 * unreadable element, still gives every complete source object: the elements are read one at a time. Only an answer with nothing
 * readable at all is reported unreadable, which is the one case a repair call is for. Pure.
 */
import { isRecord } from "../guards";
import { extractObject } from "../model-json";
import { checkItem, MAX_ITEMS, type FilingItem, type Rejection } from "./filing-schema";
import type { EntryType } from "./types";

/** A converted entry carries all the source's facts, so it may be longer than a filed addition. */
export const STANDARDIZE_ITEM_CHARS = 30_000;

export interface SourceAnswer { number: number; items: FilingItem[]; rejected: Rejection[] }
export type StandardizeParse = { ok: true; answers: SourceAnswer[]; stray: string[] } | { ok: false; error: string };

/** The complete top-level `{...}` elements of the array that follows `"entries"`, each parsed alone; an element that does not parse is skipped. */
function elementsOf(text: string): unknown[] {
  const start = text.indexOf("[", text.indexOf('"entries"'));
  if (start < 0) return [];
  const out: unknown[] = [];
  let depth = 0;
  let from = -1;
  let inString = false;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i]!;
    if (inString) { if (c === "\\") i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "{") { if (depth++ === 0) from = i; }
    else if (c === "}" && --depth === 0) {
      try { out.push(JSON.parse(text.slice(from, i + 1))); } catch { /* skip this element */ }
    } else if (c === "]" && depth === 0) break;
  }
  return out;
}

export function parseStandardizeAnswer(text: string, count: number, allow: readonly EntryType[]): StandardizeParse {
  const whole = extractObject(text);
  const list = isRecord(whole) && Array.isArray(whole["entries"]) ? (whole["entries"] as unknown[]) : elementsOf(text);
  if (list.length === 0) return { ok: false, error: isRecord(whole) ? 'the answer has no "entries" list' : "the answer is not a JSON object" };
  const bySource = new Map<number, SourceAnswer>();
  const stray: string[] = [];
  for (const element of list) {
    const number = isRecord(element) ? element["source"] : undefined;
    if (!isRecord(element) || typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > count) {
      stray.push(`an answer for a source that is not in this batch (${isRecord(element) ? String(element["source"]).slice(0, 20) : "not an object"})`);
      continue;
    }
    const answer = bySource.get(number) ?? { number, items: [], rejected: [] };
    bySource.set(number, answer);
    const raw = Array.isArray(element["items"]) ? (element["items"] as unknown[]) : [];
    if (raw.length === 0) answer.rejected.push({ position: 1, reason: "it came back with no items" });
    raw.forEach((item, i) => {
      const position = answer.items.length + answer.rejected.length + 1;
      if (i >= MAX_ITEMS) return void (i === MAX_ITEMS && answer.rejected.push({ position, reason: `only the first ${MAX_ITEMS} items are taken` }));
      const checked = checkItem(item, position, allow, STANDARDIZE_ITEM_CHARS);
      if (typeof checked === "string") answer.rejected.push({ position, reason: checked }); else answer.items.push(checked);
    });
  }
  return { ok: true, answers: [...bySource.values()], stray };
}
