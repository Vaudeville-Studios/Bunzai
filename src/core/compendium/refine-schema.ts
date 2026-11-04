/**
 * The boundary where a Refine answer becomes operations (04b F13): one JSON object `{ "merges": [...], "splits": [...] }`, parsed
 * once, each operation checked alone against RoleCall's skips (`tv-tree-llm.ts:1580-1650`: an index out of range, the same entry
 * twice, an empty text, at most five operations with the merges first). An entry takes part in one operation only, where RoleCall lets
 * a kept entry be split too, so no entry gets two writes in one receipt. An answer with neither list is unreadable, and that is the
 * one case a repair call is for; an operation that is skipped is named, never dropped silently. Pure.
 */
import { isRecord } from "../guards";
import { extractObject } from "../model-json";
import { MAX_OPS } from "./refine-prompt";

export type RefineOp =
  | { kind: "merge"; keep: number; remove: number; content: string }
  | { kind: "split"; at: number; remaining: string; remainingTitle?: string; title: string; content: string; keys: string[] };

export type RefineParse = { ok: true; ops: RefineOp[]; notes: string[] } | { ok: false; error: string };

/** A kept, remaining or split-off text is a whole entry, so it may be as long as one. */
const MAX_TEXT = 60_000;
const MAX_KEYS = 20;
const MAX_KEY = 80;

const index = (v: unknown, count: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < count ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= MAX_TEXT ? v.trim() : null);

export function parseRefineAnswer(answer: string, count: number): RefineParse {
  const whole = extractObject(answer);
  if (!isRecord(whole)) return { ok: false, error: "the answer is not a JSON object" };
  if (whole["merges"] === undefined && whole["splits"] === undefined) return { ok: false, error: 'the answer has neither "merges" nor "splits"' };
  const lists = (["merges", "splits"] as const).map((k) => whole[k] ?? []);
  if (!lists.every(Array.isArray)) return { ok: false, error: '"merges" and "splits" must be lists' };
  const [merges, splits] = lists as [unknown[], unknown[]];
  const ops: RefineOp[] = [];
  const notes: string[] = [];
  const used = new Set<number>();
  const take = (what: string, ...at: (number | null)[]): boolean => {
    if (ops.length >= MAX_OPS) { notes.push(`${what} was not taken: only the first ${MAX_OPS} operations are`); return false; }
    if (at.some((i) => i === null)) { notes.push(`${what} names an entry that is not in this branch`); return false; }
    if (at.some((i) => used.has(i!))) { notes.push(`${what} uses an entry that is already part of another operation`); return false; }
    return true;
  };
  merges.forEach((m, n) => {
    const what = `merge ${n + 1}`;
    if (!isRecord(m)) return void notes.push(`${what} is not an object`);
    const keep = index(m["keep_index"], count);
    const remove = index(m["remove_index"], count);
    const content = text(m["merged_content"]);
    if (keep !== null && keep === remove) return void notes.push(`${what} merges an entry into itself`);
    if (content === null) return void notes.push(`${what} has no merged_content`);
    if (!take(what, keep, remove)) return;
    ops.push({ kind: "merge", keep: keep!, remove: remove!, content });
    used.add(keep!).add(remove!);
  });
  splits.forEach((s, n) => {
    const what = `split ${n + 1}`;
    if (!isRecord(s)) return void notes.push(`${what} is not an object`);
    const at = index(s["entry_index"], count);
    const remaining = text(s["remaining_content"]);
    const content = text(s["new_content"]);
    const title = text(s["new_title"]);
    if (remaining === null || content === null || title === null) return void notes.push(`${what} needs remaining_content, new_content and new_title`);
    const retitle = s["remaining_title"] === undefined ? undefined : text(s["remaining_title"]);
    if (retitle === null) return void notes.push(`${what} has an unusable remaining_title`);
    const keys = Array.isArray(s["new_keys"]) ? (s["new_keys"] as unknown[]).flatMap((k) => (typeof k === "string" && k.trim() !== "" ? [k.trim().slice(0, MAX_KEY)] : [])).slice(0, MAX_KEYS) : [];
    if (!take(what, at)) return;
    ops.push({ kind: "split", at: at!, remaining, ...(retitle ? { remainingTitle: retitle } : {}), title, content, keys });
    used.add(at!);
  });
  return { ok: true, ops, notes };
}
