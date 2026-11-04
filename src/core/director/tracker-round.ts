/**
 * The Story Director's tracker round (plan 16; RoleCall `runDM.ts` phase 3b, 1074-1131): after a reply, one request for the legacy trackers that are on and due, answered as an UPDATE
 * of what each keeps. Pure: studio/scene-director-trackers.ts sends it and writes; nothing here touches the scene. It reuses the refresh code's module specs (core/trackers/refresh.ts), so a
 * module's identity, stacking and leader rules stay with the module.
 *
 * Differences from RoleCall and from Refresh, each deliberate (plans 13 and 16):
 *  - it runs on the exchange that just happened (RoleCall's runs before the reply, so it tracks the previous reply's prose, map 13 #15);
 *  - an answer never removes by omission: entries it leaves out stay, and a name in `remove` takes an entry out the way the module takes one out (a mark, never a delete);
 *  - an answer that cannot be read, or does not fit the module, changes nothing and says why.
 */
import { extractObject } from "../model-json";
import { deepEq, isRecord } from "../guards";
import { PROMPT_ORDER, isStoryboard, refreshSpecOf } from "../trackers";
import { conversationOf, type Read, type Subs } from "../trackers/generate";
import { NAME_FIELDS, REFRESH_SYSTEM, diffModule, nameOf, norm, shownOf, type Env, type ModuleDiff, type RefreshSpec, type Row, type Skipped } from "../trackers/refresh";
import type { NarratorDirective } from "../../stage/contracts/director-types";
import { TRACKER_PROP_PREFIX, type ChatTrackers, type TrackerModule } from "../../stage/contracts/chat-tracker-types";

export interface DueAsk { entries: ChatTrackers; on: readonly string[]; autoUpdate: boolean; every: number; turn: number }

/**
 * The trackers due this turn: Prop on, and a frequency above 0 that divides the Director's stored turn counter (RoleCall: `userTurnCount % frequency`, the worker's frequency being the
 * tracker's own override else the scene's Default AI Awareness). Storyboards are not here: their rounds are a separate slice.
 */
export function dueTrackers(ask: DueAsk): TrackerModule[] {
  if (!ask.autoUpdate || ask.turn < 1) return [];
  return PROMPT_ORDER.filter((module) => {
    if (isStoryboard(module) || !refreshSpecOf(module) || !ask.on.includes(`${TRACKER_PROP_PREFIX}${module}`)) return false;
    const own = ask.entries[module]?.auto;
    return own?.on !== false && ask.turn % (own?.every ?? ask.every) === 0;
  });
}

/** The due trackers split into the calls Calls per reply allows (planning is not among them), shared out evenly in order. */
export function batchesOf<T>(modules: readonly T[], callsPerReply: number): T[][] {
  const calls = Math.min(Math.max(callsPerReply, 0), modules.length);
  if (calls === 0) return [];
  const size = Math.ceil(modules.length / calls);
  return Array.from({ length: Math.ceil(modules.length / size) }, (_, i) => modules.slice(i * size, (i + 1) * size));
}

/** The most characters of one side of the exchange the request carries. */
const SIDE_MAX = 6_000;

export interface RoundModule { module: TrackerModule; data: unknown; subs: Subs }
export interface RoundAsk { characterName: string; personaName: string; userMessage: string; reply: string; directive?: string; modules: readonly RoundModule[] }

/** The request: RoleCall's per-module instructions as ported for Refresh, framed as an update from the latest exchange (the tracker is shown as it is; the exchange is not a re-read of the chat). */
export function roundMessages(ask: RoundAsk): { system: string; user: string } {
  const exchange = conversationOf([{ role: "user", content: ask.userMessage.slice(0, SIDE_MAX) }, { role: "assistant", content: ask.reply.slice(0, SIDE_MAX) }], ask.characterName, ask.personaName);
  const blocks = ask.modules.map(({ module, data, subs }) => {
    const spec = refreshSpecOf(module)!;
    return `## ${module}\nNow:\n${JSON.stringify(shownOf(spec.rows(data)), null, 2)}\n\nWhat it keeps and the format:\n${spec.instruction(subs)}`;
  });
  return {
    system: REFRESH_SYSTEM,
    user: `You are updating a roleplay's game-like trackers after one exchange.

CHARACTER: ${ask.characterName}
PLAYER/PROTAGONIST: ${ask.personaName}

THE LATEST EXCHANGE:
${exchange}
${ask.directive ? `\nWHAT THE STORY DIRECTOR PLANNED FOR THIS TURN:\n${ask.directive}\n` : ""}
---

THE TRACKERS TO UPDATE:

${blocks.join("\n\n")}

---

Update every tracker above that this exchange actually moved: HP/MP/AP changes, items picked up or used, knowledge revealed, party changes, status effects applied or cleared. Default to filling, not skipping; most engaged turns move at least one tracker. Leave out a tracker the exchange did not move. NEVER send a field as null; omit it instead.

Answer with ONLY a valid JSON object keyed by tracker name, for example {"inventory": {...}, "resources": {...}}. Under each name, use that tracker's format but give only the entries that changed or are new, and only the values that changed; everything you leave out stays exactly as it is. To take an entry away, name it in a list "remove": ["name"] under that tracker. No markdown, no explanation.`,
  };
}

/** The answer read once: a JSON object keyed by tracker, or the reason it is not one. */
export function readRound(text: string): Read<Record<string, unknown>> {
  const answer = extractObject(text);
  return isRecord(answer) ? { ok: true, value: answer } : { ok: false, error: "the answer is not a JSON object" };
}

export type Merged = { ok: true; state: unknown; diff: ModuleDiff; skipped: Skipped[] } | { ok: false; error: string };

const id = (r: Row): string => `${r.list}\u0000${r.key}`;

/** `sent` laid over `current`, all the way down: an object patches only the fields it names (null names nothing), anything else, an array included, replaces. */
function patch(current: unknown, sent: unknown): unknown {
  if (!isRecord(current) || !isRecord(sent)) return sent;
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(sent)) if (v !== null) out[k] = patch(current[k], v);
  return out;
}

/** The names a part's `remove` lists, lower-cased; null when it is not a list of text. */
function removals(part: Record<string, unknown>): Set<string> | null {
  const raw = part["remove"];
  if (raw === undefined) return new Set();
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return null;
  return new Set((raw as string[]).map(norm));
}

/**
 * One module's part of the answer as that module's next state. The module's own `next` reads an answer as the WHOLE tracker (an entry it leaves out is removed), so the part is first
 * completed with what the module keeps now, then asked twice: once to see which entries the part's omission would have removed, and again with those entries put back unless the answer named
 * them in `remove`. Single values the part leaves out keep their value, and a nested one (needs) is merged, so no omission removes anything. The state is checked as the store checks it.
 */
export function mergeUpdate(spec: RefreshSpec, data: unknown, part: Record<string, unknown>, base: Pick<Env, "id" | "now">, check: (state: unknown) => unknown | null): Merged {
  const named = removals(part);
  if (!named) return { ok: false, error: "remove must be a list of names" };
  const { remove: _remove, ...given } = part;
  const rows = spec.rows(data);
  const answer: Record<string, unknown> = { ...given };
  for (const r of rows) {
    if (r.key !== "") continue;
    const sent = answer[r.list];
    answer[r.list] = sent === undefined ? r.value : patch(r.value, sent);
  }
  // An entry named with some of its fields is that entry with those fields changed: matched by name, as the module matches them, and laid over what it holds now.
  for (const list of new Set(rows.filter((r) => r.key !== "").map((r) => r.list))) {
    const sent = answer[list];
    if (!Array.isArray(sent)) continue;
    answer[list] = sent.map((e) => {
      const name = nameOf(e);
      const row = name === undefined ? undefined : rows.find((r) => r.list === list && r.key !== "" && (norm(r.label) === norm(name) || r.key === norm(name)));
      // It is matched by its name, so its name stays what the module holds (the answer may spell the case differently).
      return row && isRecord(e) ? patch(row.value, Object.fromEntries(Object.entries(e).filter(([k]) => !NAME_FIELDS.includes(k)))) : e;
    });
  }
  for (const list of new Set(rows.filter((r) => r.key !== "").map((r) => r.list))) if (answer[list] === undefined) answer[list] = [];
  const first = spec.next(data, structuredClone(answer), { ...base, skipped: [] });
  if (first === null) return { ok: false, error: "the answer is not in the format the tracker asks for" };
  const kept = new Set(spec.rows(first).map(id));
  const lost = rows.filter((r) => r.key !== "" && !kept.has(id(r)) && !named.has(norm(r.label)) && !named.has(r.key));
  for (const r of lost) {
    const list = answer[r.list];
    if (!Array.isArray(list)) return { ok: false, error: "the answer is not in the format the tracker asks for" };
    list.push(r.value);
  }
  const env: Env = { ...base, skipped: [] };
  const next = spec.next(data, answer, env);
  if (next === null) return { ok: false, error: "the answer is not in the format the tracker asks for" };
  const fit = check(next);
  if (fit === null) return { ok: false, error: "the updated tracker does not fit what the module keeps" };
  return { ok: true, state: fit, diff: diffModule(spec, data, fit), skipped: env.skipped };
}

/** One line for the activity feed: what the module's update did. */
export function describeDiff(module: TrackerModule, diff: ModuleDiff): string {
  const parts = [["added", diff.added], ["changed", diff.changed], ["removed", diff.removed]].flatMap(([word, list]) => (list as unknown[]).length > 0 ? [`${(list as unknown[]).length} ${word as string}`] : []);
  return `Updated ${module}: ${parts.join(", ")}`;
}

/** Whether an update changed anything. */
export const changes = (diff: ModuleDiff): boolean => diff.added.length + diff.changed.length + diff.removed.length > 0;

/** The Director's directive for this turn in a few lines, for the tracker request to read (RoleCall passes its directive summary to the same round). */
export function summaryOf(d: NarratorDirective): string {
  return [d.narrativeGoal && `Goal: ${d.narrativeGoal}`, `Mood: ${d.mood}; pacing: ${d.pacing}`, d.endingHook && `Ending hook: ${d.endingHook}`, ...(d.characterBeats ?? []).map((b) => `${b.character}: ${b.beat}`)].filter(Boolean).join("\n");
}
