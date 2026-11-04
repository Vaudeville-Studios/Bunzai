/**
 * RECONCILE RECENT SCENE (RoleCall `lib/chat-participants/reconcile.ts`, `app/api/chat/[chatId]/participants/reconcile/route.ts`): the
 * one-off model check that proposes newly introduced named actors from selected recent messages. RoleCall asks for a forced tool call
 * and writes what comes back; Bunzai asks for one JSON answer (at most one repair), validates every candidate with RoleCall's
 * automatic-candidate rules (`lib/character-mind/participant-candidate.ts`), drops names already on the roster by RoleCall's duplicate
 * ladder (`lib/character-mind/resolve-participant.ts`), and only proposes: nothing is stored until the person confirms. Pure.
 */
import { editDistance } from "../text";
import { isRecord, optStr } from "../guards";
import { extractObject } from "../model-json";

export const RECONCILE_CHUNK_CHARS = 12_000;
export const RECONCILE_MAX_PER_CHUNK = 8;
export const RECONCILE_MAX_MESSAGES = 500;
export const RECONCILE_DEFAULT_MESSAGES = 12;

export interface Candidate { name: string; description: string | null }
export interface Proposal { candidates: Candidate[]; /** Candidates the rules refused or the roster already holds, as a count. */ known: number; rejected: number }

export interface Messages { system: string; user: string }

/** The roster as the model sees it: names and kinds only. */
export function reconcileMessages(chunk: string, roster: readonly { name: string; kind: string }[]): Messages {
  const list = roster.slice(0, 80).map((r) => `- ${r.name} (${r.kind})`).join("\n") || "(empty)";
  return {
    system: `You maintain a roleplay participant roster. Identify ONLY newly introduced named people with agency in this response: they speak, act, make a choice, or have an interior reaction. Never add the player, the main card, locations, organizations, creatures without agency, items, titles, groups, or merely mentioned historical people. Existing roster:\n${list}\n\nRespond with ONLY valid JSON: {"participants":[{"display_name":"Name","description":"one short line, or null"}]}. Return {"participants":[]} when no new actor qualifies.`,
    user: `Response to inspect:\n${chunk}`,
  };
}

/** The one repair request: the same task, the answer that did not parse, and why. */
export const repairReconcile = (first: Messages, answer: string, error: string): Messages =>
  ({ system: first.system, user: `${first.user}\n\nYour previous answer could not be used (${error}):\n\n${answer.slice(0, 2000)}\n\nAnswer again with only the JSON object.` });

export type Read = { ok: true; value: { name: string; description: string | null }[] } | { ok: false; error: string };

/** The model's answer, parsed once: an object with a `participants` list; anything else is a reason, never an empty success. */
export function parseReconcile(text: string): Read {
  const answer = extractObject(text);
  const list = isRecord(answer) ? answer["participants"] : undefined;
  if (!Array.isArray(list)) return { ok: false, error: 'the answer has no "participants" list' };
  const out: { name: string; description: string | null }[] = [];
  for (const item of list.slice(0, RECONCILE_MAX_PER_CHUNK)) {
    if (!isRecord(item)) return { ok: false, error: "a participant is not an object" };
    const name = optStr(item["display_name"])?.trim();
    if (!name) return { ok: false, error: "a participant has no display_name" };
    const d = optStr(item["description"])?.trim();
    out.push({ name: name.slice(0, 120), description: d ? d.slice(0, 600) : null });
  }
  return { ok: true, value: out };
}

/** The selected messages cut into chunks of at most `max` characters on blank lines (RoleCall `chunkForReconcile`); every message is read once. */
export function chunkMessages(messages: readonly string[], max = RECONCILE_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const part of messages.join("\n\n").split(/\n\n+/)) {
    if (current && current.length + part.length + 2 > max) { chunks.push(current); current = ""; }
    if (part.length > max) for (let o = 0; o < part.length; o += max) chunks.push(part.slice(o, o + max));
    else current += `${current ? "\n\n" : ""}${part}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

const LEADING_NON_ACTOR_VERBS = new Set(["adapt", "adjust", "advance", "analyze", "capture", "create", "ensure", "find", "follow", "investigate", "picture", "receive", "remember", "restore", "standardize", "track", "update", "use"]);
const NAME_NON_ACTOR_WORDS = new Set(["arc", "artifact", "audience", "awareness", "chapter", "chamber", "choice", "consciousness", "contract", "corridor", "event", "future", "hall", "investigation", "item", "location", "map", "memory", "negotiation", "neutrality", "plot", "power", "quest", "room", "route", "safety", "scene", "setting", "spell", "system", "thread", "timeline", "world"]);
const ACTOR_WORDS = /\b(he|she|they|him|her|his|hers|their|person|man|woman|boy|girl|child|elder|npc|character|actor|student|teacher|mentor|guard|soldier|merchant|captain|doctor|professor|detective|lord|lady|king|queen|prince|princess|deity|spirit|monster|beast|creature|companion|ally|rival|enemy|friend|villain|hero)\b/i;

const words = (v: string): string[] => v.toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, " ").split(/\s+/).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
const significant = (v: string): string[] => words(v).filter((w) => w.length > 2 && w !== "the" && w !== "and");

/** RoleCall's automatic-candidate rules: a reason the name cannot be an NPC, or null. */
export function refuseCandidate(c: Candidate): string | null {
  const name = c.name.trim();
  if (!name) return "missing display name";
  if (name.length > 80) return "name is too long for automatic NPC creation";
  if (/[\r\n]/.test(name)) return "name contains multiple lines";
  if (/[:;|<>{}[\]\\]/.test(name)) return "name looks like a lore title or structured label";
  if (/\s(?:&|\+|\/)\s/.test(name)) return "name appears to contain multiple entities";
  const sig = significant(name);
  if (sig.length > 7) return "name is too broad for a single NPC";
  if (sig[0] && LEADING_NON_ACTOR_VERBS.has(sig[0])) return "name starts like an action or instruction";
  if (!ACTOR_WORDS.test(c.description ?? "") && sig.some((w) => NAME_NON_ACTOR_WORDS.has(w))) return "name looks like a place, event, system, or lore entry";
  return null;
}

/** RoleCall's name key: a trailing "(card)" or "(npc)" tag, spacing and case aside. */
export const canonicalName = (name: string): string => {
  let v = name.trim().replace(/\s+/g, " ");
  while (/\s+\((card|npc)\)$/i.test(v)) v = v.replace(/\s+\((card|npc)\)$/i, "").trim();
  return v.toLowerCase();
};
const tokens = (name: string): string[] => canonicalName(name).split(/[\s\-_,;]+/).map((t) => t.replace(/[^\w]/g, "")).filter((t) => t.length >= 2);
const strictSubset = (a: string[], b: string[]): boolean => { const A = new Set(a); const B = new Set(b); return A.size < B.size && [...A].every((t) => B.has(t)); };

const nearTypo = (a: string, b: string): boolean => {
  const max = Math.max(a.length, b.length);
  if (max < 8) return false;
  const d = editDistance(a, b);
  return d <= 1 || (max >= 12 && d / max <= 0.16);
};

/** Whether two names are one actor by RoleCall's ladder: the same words, a strict token subset either way, or a near typo. */
export function sameActor(a: string, b: string): boolean {
  if (canonicalName(a) === canonicalName(b)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const key = (t: string[]) => [...new Set(t)].sort().join(" ");
  return (ta.length > 1 && key(ta) === key(tb)) || strictSubset(ta, tb) || strictSubset(tb, ta) || nearTypo(canonicalName(a), canonicalName(b)) || nearTypo(key(ta), key(tb));
}

/** What a run proposes: the answers of every chunk, refused by the rules or the roster, and one entry per new name. `roster` is every name on it, retired included, so a retired NPC is never quietly brought back. */
export function propose(answers: readonly (readonly { name: string; description: string | null }[])[], roster: readonly string[]): Proposal {
  const candidates: Candidate[] = [];
  let known = 0;
  let rejected = 0;
  for (const c of answers.flat()) {
    if (refuseCandidate(c)) { rejected++; continue; }
    if (roster.some((n) => sameActor(c.name, n)) || candidates.some((p) => sameActor(c.name, p.name))) { known++; continue; }
    candidates.push({ name: c.name.trim().replace(/\s+/g, " "), description: c.description });
  }
  return { candidates, known, rejected };
}
