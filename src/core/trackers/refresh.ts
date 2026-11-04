/**
 * Refresh from chat history for a whole tracker module (RoleCall `app/api/chat/initialize-trackers/route.ts`: `buildAnalysisPrompt` 162-319, the system line at 428): the
 * request the scene's model gets, how its answer becomes a proposed next state, and what that state changes. Pure: studio/scene-tracker-refresh.ts sends it; nothing here
 * writes the scene. The proposal is the module's own state after its own actions (refresh, add, remove), so identity, stacking and the leader rule stay with the module.
 *
 * Differences from RoleCall, each deliberate (14-tracker-refresh-rc-map.md section 4):
 *  - the prompt carries the tracker as it is now, so the model updates it instead of re-initialising it from the tail;
 *  - an answer that cannot be read is an error, never defaults (RoleCall resets HP, combat and corruption on a provider failure);
 *  - rows are matched by name, a row the answer leaves out is marked removed (Undo brings it back), and the person sees all of it before accepting;
 *  - the prompt text drops "still include it with empty/default values" and the Creature Codex line that invents species when none have appeared.
 */
import { extractObject } from "../model-json";
import { isRecord } from "../guards";
import { ITEM_TEMPERATURE, conversationOf, type Line, type Messages, type Read, type Subs } from "./generate";
import type { Shape } from "./shape";

/** An entry of the answer that was left out, and why, so the review sheet can say so. */
export interface Skipped { name: string; reason: string }

/** Where a proposed change gets its ids and time, so a proposal is a pure function of its inputs; `skipped` collects what the answer lost. */
export interface Env { id(): string; now: number; skipped: Skipped[] }

/** One thing a module keeps, for the prompt and the diff: a list entry (`key` is its name) or a single value (`key` empty). `value` holds the fields RoleCall's format names. */
export interface Row { list: string; key: string; label: string; value: unknown }

export interface RefreshSpec {
  /** RoleCall's instruction for the module and the format of the answer, for the sub-features that are on. */
  instruction(subs: Subs): string;
  /** RoleCall's reply budget class: 4000 light, 6000 medium, 8000 heavy. */
  maxTokens: 4000 | 6000 | 8000;
  /** What the module keeps now (live entries only), from its stored data. */
  rows(data: unknown): Row[];
  /** The state after the answer, by the module's own actions, or null when the answer is not the format. Entries it cannot read go to `env.skipped`. */
  next(data: unknown, answer: Record<string, unknown>, env: Env): unknown | null;
}

export const REFRESH_TEMPERATURE = ITEM_TEMPERATURE;
export const REFRESH_SYSTEM = "You are a precise JSON generator. Analyze roleplay conversations and output structured data. Always respond with valid JSON only.";

export const norm = (s: string): string => s.trim().toLowerCase();
export const byName = (x: { name: string }): string => norm(x.name);
export const entry = (list: string, label: string, value: unknown, key = norm(label)): Row => ({ list, key, label, value });
export const single = (list: string, label: string, value: unknown): Row => ({ list, key: "", label, value });

export const NAME_FIELDS = ["name", "title", "subject", "npcName", "partnerName", "characterName", "speciesName"];

/** The name an answer entry goes by (the first of the fields RoleCall's formats use for it), or undefined. */
export function nameOf(x: unknown): string | undefined {
  if (!isRecord(x)) return undefined;
  const v = NAME_FIELDS.map((k) => x[k]).find((n) => typeof n === "string" && n.trim() !== "");
  return typeof v === "string" ? v.trim() : undefined;
}

/**
 * The answer's list under `field` read entry by entry, or null when it is not a list. An entry that cannot be read is left out and noted in `env.skipped`; the rest
 * goes on. While anything was skipped no live entry is removed (see `sync`), because a lost entry must never look like a removal.
 */
export function listOf<M>(answer: Record<string, unknown>, field: string, shape: Shape<M>, env: Env): M[] | null {
  const raw = answer[field];
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((x, at) => {
    const made = shape.coerce(x);
    if (made !== null) return [made];
    env.skipped.push({ name: nameOf(x)?.slice(0, 80) ?? `item ${at + 1}`, reason: "a field it needs is missing or unreadable" });
    return [];
  });
}

/** The made entries lined up with the live ones by key: new, matched, and live ones the answer left out. The first of two made entries with one key wins. */
export function align<T, M>(live: readonly T[], made: readonly M[], liveKey: (x: T) => string, madeKey: (x: M) => string): { add: M[]; update: [T, M][]; drop: T[] } {
  const byKey = new Map<string, M>();
  for (const m of made) if (!byKey.has(madeKey(m))) byKey.set(madeKey(m), m);
  const taken = new Set<string>();
  const update: [T, M][] = [], drop: T[] = [];
  for (const old of live) {
    const k = liveKey(old);
    const m = byKey.get(k);
    if (m && !taken.has(k)) { taken.add(k); update.push([old, m]); } else drop.push(old);
  }
  return { add: [...byKey].filter(([k]) => !taken.has(k)).map(([, m]) => m), update, drop };
}

/** What a module does with a made list: its own refresh, add and (where it can mark one removed) remove actions. */
export interface ListActs<S, T, M> { refresh(s: S, old: T, m: M): S; add(s: S, m: M): S; remove?(s: S, old: T): S }

/** The state with a made list folded in by the module's own actions: matched entries refreshed, new ones added, live ones the answer left out removed (when the module can). */
export function sync<S, T, M>(state: S, live: readonly T[], made: readonly M[], key: (x: T | M) => string, act: ListActs<S, T, M>): S {
  const { add, update, drop } = align(live, made, key, key);
  let s = state;
  for (const [old, m] of update) s = act.refresh(s, old, m);
  for (const m of add) s = act.add(s, m);
  if (act.remove) for (const old of drop) s = act.remove(s, old);
  return s;
}

export interface RefreshAsk {
  characterName: string;
  personaName: string;
  /** The messages to read, oldest first, already the window (this does not slice). */
  transcript: readonly Line[];
  /** The tracker as it is now: `spec.rows` of its stored data. */
  current: readonly Row[];
  subs: Subs;
}

/** The rows as the answer's JSON: a list under its name, a single value under its name. */
export function shownOf(rows: readonly Row[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.key === "") out[r.list] = r.value;
    else ((out[r.list] ??= []) as unknown[]).push(r.value);
  }
  return out;
}

export function refreshMessages(spec: RefreshSpec, ask: RefreshAsk): Messages {
  const conversation = conversationOf(ask.transcript, ask.characterName, ask.personaName);
  return { system: REFRESH_SYSTEM, user: `You are analyzing a roleplay conversation to update a game-like tracking system.

CHARACTER: ${ask.characterName}
PLAYER/PROTAGONIST: ${ask.personaName}

CONVERSATION HISTORY:
${conversation}

---

THE TRACKER NOW:
${JSON.stringify(shownOf(ask.current), null, 2)}

---

Based on this conversation, update the tracker. Be thorough but reasonable - only include information that can be inferred from the text. Keep what is still true, change what the conversation changed, add what it introduced, and leave out only what no longer applies.

${spec.instruction(ask.subs)}

Respond with ONLY a valid JSON object in exactly that format, holding the whole updated tracker. No markdown, no explanation.` };
}

/** The answer read once: a JSON object that becomes the module's next state, checked as the store checks it, or a reason. */
export function parseRefresh(spec: RefreshSpec, data: unknown, base: Pick<Env, "id" | "now">, check: (state: unknown) => unknown | null): (text: string) => Read<{ state: unknown; skipped: Skipped[] }> {
  return (text) => {
    const env: Env = { ...base, skipped: [] };
    const answer = extractObject(text);
    if (!isRecord(answer)) return { ok: false, error: "the answer is not a JSON object" };
    const next = spec.next(data, answer, env);
    if (next === null) return { ok: false, error: "the answer is not in the format the tracker asks for" };
    const kept = check(next);
    return kept === null ? { ok: false, error: "the updated tracker does not fit what the module keeps" } : { ok: true, value: { state: kept, skipped: env.skipped } };
  };
}

export interface Change { list: string; label: string; before?: unknown; after?: unknown }
export interface ModuleDiff { added: Change[]; changed: Change[]; removed: Change[] }

/** What a proposed state changes, by what the module keeps now against what it would keep: one comparison, so the sheet and the saved state cannot disagree. */
export function diffModule(spec: RefreshSpec, before: unknown, after: unknown): ModuleDiff {
  const id = (r: Row): string => `${r.list}\u0000${r.key}`;
  const was = new Map(spec.rows(before).map((r) => [id(r), r]));
  const now = new Map(spec.rows(after).map((r) => [id(r), r]));
  const diff: ModuleDiff = { added: [], changed: [], removed: [] };
  for (const [k, r] of now) {
    const old = was.get(k);
    if (!old) diff.added.push({ list: r.list, label: r.label, after: r.value });
    else if (JSON.stringify(old.value) !== JSON.stringify(r.value)) diff.changed.push({ list: r.list, label: r.label, before: old.value, after: r.value });
  }
  for (const [k, r] of was) if (!now.has(k)) diff.removed.push({ list: r.list, label: r.label, before: r.value });
  return diff;
}
