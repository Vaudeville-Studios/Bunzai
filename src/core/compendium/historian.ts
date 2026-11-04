/**
 * The Historian's pure side (RoleCall `lib/ai/tv-stream/summary-writer.ts`, `summary-watermark.ts`): which messages a run reads,
 * what it asks the model, and how the answer becomes entries. A run is due when `interval` of the person's turns have passed since
 * the last summary's end (the watermark, read from the summaries in the book, so a retired or undone summary moves it back and the
 * span is covered again); it reads from `overlap` messages before that end so an event across the boundary is bridged, but never
 * more than a token cap in one run (a long backlog is caught up one window per run). Every summary belongs to a plot (a plot the
 * book lacks is made), each plot's "[Arc]" overview is a constant entry that the same run rewrites, and the answer is one JSON
 * object, checked once like filing's. Pure: no store, no model.
 */
import type { LorebookEntry } from "../../entities/lorebook/schema";
import type { ReceiptWrite } from "../../stage/contracts/chat-receipt-types";
import { emptyLoreEntry } from "../lore";
import { isRecord, optStr, type Rec } from "../guards";
import { countText } from "../tokens";
import { ARC_SOURCE, readBook, type CompendiumEntry } from "./read";
import { extractObject } from "../model-json";
import { parseFilingAnswer, type FilingItem, type Rejection } from "./filing-schema";
import { normalizeName } from "./relationships";
import type { EntryType } from "./types";

/** The most tokens of messages one run reads. */
export const WINDOW_TOKENS = 12_000;
const live = (e: CompendiumEntry): boolean => e.enabled && !e.retired;

/** One past the last message index a live summary covers (`turn_range.to`), or -1 when none carries a range. */
export function summaryWatermark(entries: readonly CompendiumEntry[]): number {
  let mark = -1;
  for (const e of entries) {
    const to = isRecord(e.data["turn_range"]) ? (e.data["turn_range"] as Rec)["to"] : undefined;
    if (e.type === "summary" && live(e) && typeof to === "number" && Number.isFinite(to)) mark = Math.max(mark, to);
  }
  return mark;
}

export interface HistoryTail {
  /** Live index of the first message in `messages`. */
  first: number;
  /** The messages up to and including the boundary reply, oldest first. */
  messages: readonly { role: string; text: string }[];
}

export interface Window { start: number; newStart: number; end: number; turns: number }

/** Null when fewer than `interval` of the person's turns follow the watermark. `start`, `newStart` and `end` are live message indices (end exclusive). */
export function historianWindow(tail: HistoryTail, watermark: number, interval: number, overlap: number): Window | null {
  const total = tail.first + tail.messages.length;
  const newStart = Math.min(Math.max(watermark, 0), total);
  const turns = tail.messages.filter((m, i) => m.role === "user" && tail.first + i >= newStart).length;
  if (interval <= 0 || turns < interval) return null;
  const start = Math.max(tail.first, newStart - overlap);
  let end = start;
  let used = 0;
  for (; end < total; end++) {
    used += countText(tail.messages[end - tail.first]!.text);
    if (used > WINDOW_TOKENS && end > start) break;
  }
  return { start, newStart, end, turns };
}

export interface HistorianPromptInput {
  window: Window;
  messages: readonly { role: string; text: string }[];
  /** Plots in the book (name and status) and the recent recap titles per plot, so the model reuses them. */
  digest: string;
  guidance: string;
  language: string;
}

export function historianMessages(input: HistorianPromptInput): { system: string; user: string } {
  const { window: w } = input;
  const overlap = w.start < w.newStart ? `\nMessages ${w.start} to ${w.newStart - 1} are OVERLAP from the previous window (already summarized; they are there so you can bridge events that span the boundary).\nMessages ${w.newStart} to ${w.end - 1} are NEW and need summarizing.\n` : "";
  const guidance = input.guidance.trim() ? `\n\nUSER GUIDANCE (it cannot widen what you may write):\n${input.guidance.trim()}` : "";
  const language = input.language.trim() ? `\n\nWrite every field value in ${input.language.trim()}.` : "";
  const system = `You are a historian and narrative archivist for a roleplay. Review recent events and write clear, organized summaries.

YOUR WINDOW: messages ${w.start} through ${w.end - 1} (${w.end - w.start} messages).${overlap}
${input.digest ? `${input.digest}\n` : "No summaries or plots exist yet.\n"}
What to do:
1. Write summaries of significant events. Every summary MUST belong to a plot: put its plot's exact name in "parent_plot", reusing an existing plot when it fits and naming a new storyline when a new thread begins. Fill title, tagline (one-line hook), summary (past tense), participants, significance (minor, moderate, major or pivotal) and key_moments.
2. For each plot you summarized, write "arcs": that plot's overview, one cohesive chronological narrative of its key events, character developments and progression. It stays in the narrator's context, so keep it comprehensive but concise, and rewrite it whole.
3. Focus on what matters: character development, plot turns, world changes, relationship shifts. Skip filler. If nothing notable happened, answer with empty lists.

ANSWER FORMAT - reply with one JSON object and nothing else:
{"filings":[{"type":"summary","entry":{"title":"...","parent_plot":"Plot Name","summary":"..."}}],"arcs":[{"plot":"Plot Name","overview":"..."}]}
Optionally {"type":"plot","entry":{"name":"Plot Name","status":"active","description":"..."}} describes a new plot. At most 12 filings.${guidance}${language}`;
  const body = input.messages.map((m, i) => `[${w.start + i}] ${m.role}: ${m.text.trim()}`).join("\n\n");
  return { system, user: `Messages ${w.start} to ${w.end - 1}:\n\n${body}\n\nSummarize the new events.` };
}

/** Plots and their recent recaps, as the digest the prompt shows. */
export function historianDigest(entries: readonly CompendiumEntry[]): string {
  const plots = entries.filter((e) => e.type === "plot" && live(e));
  const lines = plots.map((p) => {
    const recaps = entries.filter((e) => e.type === "summary" && live(e) && normalizeName(String(e.data["parent_plot"] ?? "")) === normalizeName(p.name)).slice(-3).map((e) => e.name);
    return `- ${p.name} (${String(p.data["status"] ?? "active")})${recaps.length > 0 ? `; recent recaps: ${recaps.join("; ")}` : ""}`;
  });
  return lines.length === 0 ? "" : `Existing plots (REUSE these names in parent_plot):\n${lines.join("\n")}`;
}

export interface Arc { plot: string; overview: string }
export type HistorianParse = { ok: true; items: FilingItem[]; arcs: Arc[]; rejected: Rejection[] } | { ok: false; error: string };

export function parseHistorian(text: string, allow: readonly EntryType[] = ["summary", "plot"]): HistorianParse {
  const parsed = parseFilingAnswer(text, allow);
  if (!parsed.ok) return parsed;
  const answer = extractObject(text);
  const arcs: Arc[] = [];
  for (const a of isRecord(answer) && Array.isArray(answer["arcs"]) ? answer["arcs"] : []) {
    const plot = isRecord(a) ? optStr(a["plot"])?.trim() : undefined;
    const overview = isRecord(a) ? optStr(a["overview"])?.trim() : undefined;
    if (plot && overview) arcs.push({ plot, overview: overview.slice(0, 6_000) });
  }
  // Every summary belongs to a plot: one without it is rejected alone and named.
  const rejected = [...parsed.rejected];
  const items = parsed.items.filter((i) => {
    if (i.type === "summary" && !optStr(i.data["parent_plot"])?.trim()) { rejected.push({ position: i.position, reason: "every summary must belong to a plot (parent_plot)" }); return false; }
    return true;
  });
  return { ok: true, items, arcs, rejected };
}

/** The items with the run's range stamped on each summary, and a plot made for any plot a summary names that the book and the answer lack. */
export function prepareItems(items: readonly FilingItem[], entries: readonly CompendiumEntry[], w: Window): FilingItem[] {
  const known = new Set([...entries.filter((e) => e.type === "plot" && live(e)).map((e) => normalizeName(e.name)), ...items.filter((i) => i.type === "plot").map((i) => normalizeName(i.name))]);
  const made: FilingItem[] = [];
  const stamped = items.map((i): FilingItem => {
    if (i.type !== "summary") return i;
    const plot = String(i.data["parent_plot"]).trim();
    if (!known.has(normalizeName(plot))) {
      known.add(normalizeName(plot));
      made.push({ position: i.position, type: "plot", name: plot, data: { name: plot, status: "active" } });
    }
    const { create_plot: _, ...rest } = i.data;
    return { ...i, data: { ...rest, parent_plot: plot, turn_range: { from: w.newStart, to: w.end }, messages_covered: w.end - w.newStart } };
  });
  return [...made, ...stamped];
}

export interface ArcStage { entries: LorebookEntry[]; writes: ReceiptWrite[] }

/** Writes each arc's overview: the plot's existing "[Arc]" entry gets its content replaced, else a constant one is created. An arc for a plot no summary of this run names is left out. */
export function stageArcs(entries: readonly LorebookEntry[], arcs: readonly Arc[], plots: ReadonlySet<string>, bookId: string, newId: () => string): ArcStage {
  let work = [...entries];
  const writes: ReceiptWrite[] = [];
  for (const arc of arcs) {
    const key = normalizeName(arc.plot);
    if (!plots.has(key)) continue;
    const found = readBook(work).find((e) => e.arc !== null && live(e) && normalizeName(e.arc) === key);
    if (found) {
      const old = work.find((e) => e.id === found.id)!;
      if (old.content === arc.overview) continue;
      writes.push({ bookId, entryId: old.id, op: "update", fields: { before: { content: old.content }, after: { content: arc.overview } } });
      work = work.map((e) => (e.id === old.id ? { ...e, content: arc.overview } : e));
      continue;
    }
    const id = newId();
    work.push({ ...emptyLoreEntry(id), title: `[Arc] ${arc.plot}`, content: arc.overview, enabled: true, constant: true, metadata: { source: ARC_SOURCE, arc: arc.plot } });
    writes.push({ bookId, entryId: id, op: "create", fields: { before: {}, after: { enabled: true, content: arc.overview } } });
  }
  return { entries: work, writes };
}
