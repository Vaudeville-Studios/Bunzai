/**
 * The boundary where a model's filing answer becomes known items (04b F13): one JSON object `{ "filings": [{ "type", "book"?,
 * "entry": { ...fields } }] }`, parsed once. RoleCall asks for an 8-round tool loop that dies when a provider drops tools; here the
 * answer is plain text and every item is checked alone against its type's field kinds (`entry-types.ts`), so one bad item is
 * rejected and named while the rest go on. Unknown fields are kept, as in any imported book. The answer as a whole either parses
 * (an empty list is a valid "nothing to file") or is reported as unreadable, which is the only case a repair call is for. Pure.
 */
import { isRecord, type Rec } from "../guards";
import { parseStructured } from "./entry-types";
import { isEntryType, type EntryType } from "./types";
import { extractObject } from "../model-json";

/** The most items one pass accepts, and the most JSON characters one item may carry. */
export const MAX_ITEMS = 12;
export const MAX_ITEM_CHARS = 6_000;
const MAX_DEPTH = 6;

export interface FilingItem {
  /** 1-based position in the model's list, so a rejection and an item name the same thing to the person. */
  position: number;
  type: EntryType;
  /** The library book the model chose, if it named one. */
  bookId?: string;
  /** The entry's identity: its name, a recap's title or a concept's topic. */
  name: string;
  data: Rec;
}

export interface Rejection { position: number; reason: string }

export type FilingParse = { ok: true; items: FilingItem[]; rejected: Rejection[] } | { ok: false; error: string };

/** The field an entry of this type is known by. */
export const identityField = (type: EntryType): "name" | "title" | "topic" => (type === "summary" ? "title" : type === "worldbuilding" ? "topic" : "name");

const jsonSafe = (v: unknown, depth = 0): boolean => {
  if (depth > MAX_DEPTH) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => x !== null && jsonSafe(x, depth + 1));
  return isRecord(v) && Object.values(v).every((x) => jsonSafe(x, depth + 1));
};

/** One item checked alone; `maxChars` bounds its JSON (a Standardize item carries a whole converted entry, so it asks for more). */
export function checkItem(raw: unknown, position: number, allow: readonly EntryType[], maxChars = MAX_ITEM_CHARS): FilingItem | string {
  if (!isRecord(raw)) return "it is not an object";
  if (!isEntryType(raw["type"])) return `its type "${String(raw["type"]).slice(0, 40)}" is not one of the eleven`;
  const type = raw["type"];
  if (!allow.includes(type)) return `filing ${type} entries is switched off`;
  if (raw["book"] !== undefined && (typeof raw["book"] !== "string" || raw["book"] === "")) return "its book must be a book id";
  const entry = raw["entry"];
  if (!isRecord(entry)) return "it has no entry object";
  if (!jsonSafe(entry)) return "its entry holds something that is not plain data";
  if (JSON.stringify(entry).length > maxChars) return `its entry is longer than ${maxChars} characters; file a shorter addition`;
  const field = identityField(type);
  const name = entry[field];
  if (typeof name !== "string" || name.trim() === "") return `it has no ${field}`;
  const { issues } = parseStructured(type, entry);
  if (issues.length > 0) return `${issues.slice(0, 3).map((i) => `${i.field} must be ${i.expected}`).join("; ")}`;
  return { position, type, ...(typeof raw["book"] === "string" ? { bookId: raw["book"] } : {}), name: name.trim(), data: entry };
}

export function parseFilingAnswer(text: string, allow: readonly EntryType[]): FilingParse {
  const answer = extractObject(text);
  if (!isRecord(answer)) return { ok: false, error: "the answer is not a JSON object" };
  const list = answer["filings"];
  if (!Array.isArray(list)) return { ok: false, error: 'the answer has no "filings" list' };
  const items: FilingItem[] = [];
  const rejected: Rejection[] = [];
  list.forEach((raw: unknown, i) => {
    const position = i + 1;
    if (position > MAX_ITEMS) return void (position === MAX_ITEMS + 1 && rejected.push({ position, reason: `only the first ${MAX_ITEMS} items are taken` }));
    const checked = checkItem(raw, position, allow);
    if (typeof checked === "string") rejected.push({ position, reason: checked });
    else items.push(checked);
  });
  return { ok: true, items, rejected };
}
