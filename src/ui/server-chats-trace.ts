/**
 * `GET /api/chats/trace`: joins a reply's stored
 * trace with the branch's latest request text (ChatStore rule 22) and the scene's current lorebooks
 * (resolveBooks) into the `SceneTrace` contract (app-contract-scenes.ts). Split out of server-chats.ts
 * for the file-size cap; mirrors the lore route's auth and error style. The browser Studio already
 * refuses every `/api/chats/*` route by prefix (src/pocket/runtime.ts); nothing there changes.
 */
import { bodyOf, isRecord, str, recOr } from "../core/guards";
import { DEFAULT_LORE_SHARE } from "../core/assembly/types";
import { loreWakeGraph, type LoreBookInput, type LorePosition } from "../core/lore/engine";
import type { CharacterBody } from "../entities/character/schema";
import { playedBody } from "../entities/character/variant";
import type { LorebookEntry } from "../entities/lorebook/schema";
import type { PersonaBody } from "../entities/persona/schema";
import type { Chat, ChatStore, JsonObject, Message } from "../stage/contracts/chat-store";
import { resolveBooks, type ReadLorebook } from "../studio/scene-lore";
import { splitEntryKey } from "../studio/scene-turn";
import type { ReadPreset } from "../studio/scene-turn-load";
import type { SceneTrace, TraceBlockView, TraceCategory, TraceLoreHit, TraceLoreMiss, TraceTurn } from "./app-contract-scenes";
import { err, json } from "./server-security";
import { buildRecall } from "./server-chats-trace-recall";
import { buildTools } from "./server-chats-trace-tools";
import { macrosOf, routeOfTrace, variablesOf } from "./server-chats-trace-report";
import { WHOLE_BRANCH } from "../studio/scene-branch";
import { plural } from "../core/text";
import { readBookRun } from "../core/promptbook-run";
import type { PromptAttachmentInfo } from "../core/media/prompt-attachment";

const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);

/**
 * The caller (server-chats.ts) already matched the path; this always answers the route. `readPreset`
 * is optional only so the many direct-route tests that don't care about preset naming (th-t4-gaps 4)
 * don't all need one; the real server always passes it (it already builds one for the turn route).
 */
export async function handleTraceRoute(url: URL, chats: ChatStore, readLorebook: ReadLorebook, readPreset?: ReadPreset): Promise<Response> {
  const chat = await chats.getChat(url.searchParams.get("chatId") ?? "");
  if (!chat) return err("that scene is gone", 404);
  const messageId = url.searchParams.get("messageId");

  const page = await chats.readMessages(chat.activeBranchId, { limit: WHOLE_BRANCH });
  const live = page.messages.filter((m) => !m.cut);
  const target = await resolveReply(chats, live, messageId);
  if (target === "not-found") return err("that message is gone", 404);
  if (target === null) return json(null);

  const { message, swipeId, trace } = target;
  const request = await chats.lastRequest(chat.activeBranchId);
  const take = await takeNameOf(chats, chat);
  const presetName = chat.preset && readPreset ? (await readPreset(chat.preset.id, chat.preset.kind).catch(() => null))?.name : undefined;
  const scene = await buildTrace(chats, readLorebook, chat, live, message, swipeId, trace, request, take, presetName);
  return json(scene);
}

/**
 * The active take's name, exactly the way the scene's take pill reads it (scene-page.tsx): the
 * original branch (no parent) is always "Director's Cut", never its own stored name.
 */
async function takeNameOf(chats: ChatStore, chat: Chat): Promise<string> {
  const branch = (await chats.listBranches(chat.id)).find((b) => b.id === chat.activeBranchId);
  return branch && branch.parentBranchId !== null ? branch.name : "Director's Cut";
}

type Resolved = { message: Message; swipeId: string; trace: JsonObject };

/**
 * Find the reply (th-t3 plan step 3): without `messageId`, the active take's last assistant message
 * (the greeting counts); with one, that exact message. Either way, a message with no stored trace is
 * "no reply": `null` when it was the default pick, `"not-found"` when the caller named a message that
 * turns out not to be a real, traced reply (never assistant, absent, or an untraced one like the
 * greeting) - distinct from the "no reply yet" case a bare take answers.
 */
async function resolveReply(chats: ChatStore, live: readonly Message[], messageId: string | null): Promise<Resolved | null | "not-found"> {
  if (messageId) {
    const message = live.find((m) => m.id === messageId);
    if (!message || message.role !== "assistant") return "not-found";
    const swipe = message.swipes[message.current]!;
    const trace = await chats.swipeTrace(message.id, swipe.id);
    return trace ? { message, swipeId: swipe.id, trace } : "not-found";
  }
  const last = [...live].reverse().find((m) => m.role === "assistant");
  if (!last) return null;
  const swipe = last.swipes[last.current]!;
  const trace = await chats.swipeTrace(last.id, swipe.id);
  return trace ? { message: last, swipeId: swipe.id, trace } : null;
}

async function buildTrace(
  chats: ChatStore,
  readLorebook: ReadLorebook,
  chat: Chat,
  live: readonly Message[],
  message: Message,
  swipeId: string,
  trace: JsonObject,
  request: { messageId: string; swipeId: string; texts: string[]; files?: PromptAttachmentInfo[] } | null,
  take: string,
  presetName: string | undefined,
): Promise<SceneTrace> {
  // 1-based position among the take's live messages, greeting included: the only numbering the scene
  // has, shared by "Message N" block labels and the "Earlier replies" list.
  const numberOf = new Map(live.map((m, i) => [m.id, i + 1]));

  const rawBlocks = Array.isArray(trace["blocks"]) ? (trace["blocks"] as unknown[]).filter(isRecord) : [];
  const rawAvailable = request !== null && request.messageId === message.id && request.swipeId === swipeId && request.texts.length === rawBlocks.length;

  const loreTrace = isRecord(trace["lore"]) ? trace["lore"] : null;
  const injected = Array.isArray(loreTrace?.["injected"]) ? (loreTrace["injected"] as unknown[]).filter(isRecord) : [];
  const loreTitle = new Map(injected.map((h) => [str(h["entryKey"]), str(h["title"])]));
  const summaries = isRecord(trace["summaries"]) ? trace["summaries"] : null;
  const recapTitle = new Map((Array.isArray(summaries?.["injected"]) ? (summaries["injected"] as unknown[]).filter(isRecord) : []).map((h) => [str(h["entryKey"]), str(h["title"])]));

  const blocks: TraceBlockView[] = rawBlocks.map((b, i) => {
    const source = recOr(b["source"]);
    return {
      kind: str(source["kind"]),
      label: labelOf(source, numberOf, loreTitle, recapTitle),
      role: (str(b["role"]) || "system") as TraceBlockView["role"],
      tokens: num(b["tokens"]),
      category: categoryOf(str(source["kind"]), typeof source["id"] === "string" ? source["id"] : undefined),
      ...(rawAvailable ? { text: request!.texts[i] } : {}),
    };
  });

  // The numbers (as the scene shows them) of the messages recaps replaced; a fork's copy of a message has none.
  const hidden = isRecord(trace["chatSummary"]) && Array.isArray(trace["chatSummary"]["hidden"]) ? (trace["chatSummary"]["hidden"] as unknown[]) : [];
  const summarized = [...(Array.isArray(summaries?.["dropped"]) ? (summaries["dropped"] as unknown[]) : []), ...hidden].flatMap((id) => numberOf.get(str(id)) ?? []);

  const window = recOr(trace["window"]);
  const windowView = { context: num(window["context"]), reply: num(window["reply"]), stated: window["stated"] === true };
  const budget = recOr(trace["budget"]);
  const trimmed = Array.isArray(budget["trimmed"]) ? budget["trimmed"].length : 0;

  let lore: SceneTrace["lore"] = null;
  let recall: SceneTrace["recall"] = null;
  const recallTrace = isRecord(trace["recall"]) ? trace["recall"] : null;
  if (loreTrace || recallTrace) {
    const snapshot = await chats.castSnapshot(chat.id);
    const character = playedBody(bodyOf(snapshot?.character) as unknown as CharacterBody, chat.variantId);
    const persona = snapshot?.persona ? (bodyOf(snapshot.persona) as unknown as PersonaBody) : undefined;
    if (loreTrace) lore = await buildLore(readLorebook, character, persona, chat, loreTrace, windowView.context);
    if (recallTrace) recall = { ...(await buildRecall(readLorebook, character, persona, chat, recallTrace)), at: message.swipes.find((x) => x.id === swipeId)?.createdAt ?? message.createdAt };
  }

  const replies = [...live]
    .filter((m) => m.role === "assistant")
    .reverse()
    .map((m) => ({ messageId: m.id, swipeId: m.swipes[m.current]!.id, number: numberOf.get(m.id)! }));

  const requestRec = recOr(trace["request"]);
  const book = readBookRun(trace["book"]);
  return {
    ...(book ? { book } : {}),
    reply: { messageId: message.id, swipeId, number: numberOf.get(message.id)!, model: str(requestRec["model"]), take },
    blocks,
    ...(request?.messageId === message.id && request.swipeId === swipeId && request.files?.length ? { files: request.files } : {}),
    window: windowView,
    trimmed,
    ...(summarized.length > 0 ? { summarized } : {}),
    ...(presetName ? { presetName } : {}),
    lore,
    recall,
    tools: buildTools(trace["tools"], str(requestRec["model"]), message.swipes.find((x) => x.id === swipeId)?.createdAt ?? message.createdAt),
    turn: turnOf(trace, message.swipes.find((x) => x.id === swipeId) ?? message.swipes[message.current]!),
    ...(macrosOf(trace["macros"]) ? { macros: macrosOf(trace["macros"])! } : {}),
    ...(variablesOf(trace["variables"]) ? { variables: variablesOf(trace["variables"])! } : {}),
    ...(routeOfTrace(trace["route"]) ? { route: routeOfTrace(trace["route"])! } : {}),
    rawAvailable,
    replies,
  };
}

/** The reply's call: the generation it stored (which sums tool rounds), else the provider's report in the trace; the turn's own estimate when neither exists. */
function turnOf(trace: JsonObject, swipe: Message["swipes"][number]): TraceTurn {
  const g = swipe.generation;
  const usage = recOr(trace["usage"]);
  const sent = g?.promptTokens ?? (typeof usage["promptTotal"] === "number" ? usage["promptTotal"] : undefined);
  const back = g?.completionTokens ?? (typeof usage["output"] === "number" ? usage["output"] : undefined);
  const estimate = recOr(trace["estimate"])["mid"];
  return {
    ...(sent !== undefined ? { sent } : {}),
    ...(back !== undefined ? { back } : {}),
    exact: sent !== undefined || back !== undefined,
    ...(typeof estimate === "number" ? { estimate } : {}),
    ...(g?.generationMs !== undefined ? { ms: g.generationMs } : {}),
    ...(g?.finishReason ? { finish: g.finishReason } : {}),
    ...(g?.reasoningMs !== undefined ? { reasoningMs: g.reasoningMs } : {}),
    ...(g?.tagThinkingMs !== undefined ? { tagThinkingMs: g.tagThinkingMs } : {}),
    at: swipe.createdAt,
  };
}

const CHARACTER_IDS = new Set(["charDescription", "charPersonality", "scenario", "dialogueExamples"]);
const PERSONA_IDS = new Set(["personaDescription", "personaInjection"]);
const LORE_IDS = new Set(["worldInfoBefore", "loreInjection"]);
/** The chat summary's block stands in for the history it covers, as a recap does. */
const SUMMARY_IDS = new Set(["summaryInjection", "summary", "chatSummary"]);

/** Th-t3 plan step 3's category map. Everything reachable is named; `other` guards a trace whose
 * source kind this version does not recognize (an older or newer shape). */
function categoryOf(kind: string, id: string | undefined): TraceCategory {
  if (kind === "prompt") {
    if (id && CHARACTER_IDS.has(id)) return "character";
    if (id && PERSONA_IDS.has(id)) return "persona";
    if (id && LORE_IDS.has(id)) return "lore";
    if (id && SUMMARY_IDS.has(id)) return "history";
    return "preset";
  }
  // A recap stands in for the history it replaced, so it is counted with it.
  if (kind === "greeting" || kind === "history" || kind === "summary") return "history";
  if (kind === "current") return "current";
  // The card's own depth notes; a lore depth block is kind "lore" already (lore-place.ts).
  if (kind === "depth") return "character";
  // Recall counts against the lore share, so it is Lore on the Tokens sheet (core/assembly/recall-place.ts).
  if (kind === "lore" || kind === "recall") return "lore";
  // The tracker Props' state (core/assembly/trackers.ts) is its own line on the Tokens sheet.
  if (kind === "trackers" || kind === "storyboards") return "trackers";
  return "other";
}

function labelOf(source: Record<string, unknown>, numberOf: ReadonlyMap<string, number>, loreTitle: ReadonlyMap<string, string>, recapTitle: ReadonlyMap<string, string>): string {
  const kind = str(source["kind"]);
  if (kind === "prompt") return str(source["name"]) || "Prompt";
  if (kind === "greeting") return "Greeting";
  if (kind === "history" || kind === "current") {
    const n = numberOf.get(str(source["messageId"]));
    // A forked take's older blocks name messages the fork replaced with copies (new ids); no number
    // survives the fork, so the label falls back to plain "Message".
    return n === undefined ? "Message" : `Message ${n}`;
  }
  if (kind === "depth") return `Depth note (${typeof source["depth"] === "number" ? source["depth"] : "?"})`;
  if (kind === "note") return "Scene note";
  if (kind === "guide") return "Guide";
  if (kind === "guided-draft") return "Guided re-roll: rejected draft";
  if (kind === "guided-directive") return "Guided re-roll: directive";
  if (kind === "recall") return "Recalled knowledge";
  if (kind === "trackers") return "Trackers";
  if (kind === "director") return "Story Director";
  if (kind === "storyboards") return "Storyboards";
  if (kind === "skills") return "Skills";
  if (kind === "summary") return `Summary: ${recapTitle.get(str(source["entryKey"])) ?? str(source["entryKey"])}`;
  if (kind === "tool") return `Tool answer: ${str(source["id"]) || "tool"}`;
  if (kind === "lore") {
    const key = str(source["entryKey"]);
    return loreTitle.get(key) ?? key;
  }
  return kind || "Block";
}

function placeLabel(position: LorePosition): string {
  switch (position.kind) {
    case "world":
      return "World";
    case "character":
      return "Character";
    case "scene":
      return "Scene";
    case "before_example":
      return "Before examples";
    case "after_example":
      return "After examples";
    case "depth":
      return `@ Depth ${position.depth}`;
    case "append":
      return `Append @ ${position.depth}`;
    case "prepend_top":
      return "Pin top";
    case "append_bottom":
      return "Pin bottom";
  }
}

/** An entry's position, the same reading engine.ts's toLorePosition gives (not exported from
 * core/lore/engine's public surface, so read straight off the schema fields instead). */
function positionOf(entry: LorebookEntry): LorePosition {
  if (entry.position === "depth") return { kind: "depth", depth: entry.depth, role: entry.role };
  if (entry.position === "append") return { kind: "append", depth: entry.depth };
  return { kind: entry.position };
}

/** Reasons excluded from `missed` (th-t3 plan step 3): too routine to explain. */
const MISSED_EXCLUDED = new Set(["no-key-match", "disabled", "empty-keys"]);

/**
 * One plain line for a miss (th-t3 plan step 3): the contract's three given examples are the pattern
 * (a short cause, then its numbers); every other reachable LoreSkip gets its own line here, not
 * reused from the Workbench's `reason-text.ts` (UI-layer code with its own wording for a different
 * surface - noted as intentional duplication in the plan's report, not a shared seam to extract).
 */
function whyFor(reason: string, matched: readonly string[], tokens: number, detail: Record<string, unknown> | undefined): string {
  const d = (k: string): number | undefined => (typeof detail?.[k] === "number" ? (detail[k] as number) : undefined);
  const matchedPrefix = matched.length > 0 ? `matched "${matched.join(", ")}", ` : "";
  switch (reason) {
    case "secondary-logic":
      return "secondary keys did not match";
    case "chance": {
      const rolled = d("rolled");
      const needed = d("needed") ?? 0;
      return rolled === undefined ? `chance: needed ${needed}` : `chance: rolled ${rolled}, needed ${needed}`;
    }
    case "cooldown": {
      const remaining = d("remaining");
      return remaining === undefined ? "cooling down" : `cooling down: ${plural(remaining, "turn")} left`;
    }
    case "delay": {
      const remaining = d("remaining");
      return remaining === undefined ? "waiting for more messages" : `waiting: ${plural(remaining, "message")} left`;
    }
    case "frequency":
      return "frequency: still in its own window";
    case "budget-cut": {
      const cost = d("cost") ?? tokens;
      const left = d("left");
      return `${matchedPrefix}over budget: ${cost} tok${left === undefined ? "" : `, ${left} left`}`;
    }
    case "exclude-recursion":
      return "cannot be woken by recursion";
    case "delay-until-recursion": {
      const remaining = d("remaining");
      return `waits for recursion level ${remaining ?? "?"}`;
    }
    case "character-filter":
      return "not for this character";
    case "group-lost":
      return `${matchedPrefix}lost its inclusion group`;
    default:
      return reason;
  }
}

/**
 * The lore side of the trace (th-t3 plan step 3): titles, book names, and the recursion wake graph
 * come from the scene's books now, not as they were when this reply was generated - a trace older
 * than this feature, or one naming a book or entry since deleted, falls back to the id.
 */
async function buildLore(
  readLorebook: ReadLorebook,
  character: CharacterBody,
  persona: PersonaBody | undefined,
  chat: Chat,
  loreTrace: Record<string, unknown>,
  windowContext: number,
): Promise<SceneTrace["lore"]> {
  const resolved = await resolveBooks(character, persona, chat.lore, readLorebook);
  const books = resolved.flatMap((r) => (r.book ? [r.book as LoreBookInput] : []));
  const bookById = new Map(books.map((b) => [b.id, b]));
  const bookName = (bookId: string) => bookById.get(bookId)?.name ?? bookId;
  const entryOf = (bookId: string, entryId: string) => bookById.get(bookId)?.body.entries.find((e) => e.id === entryId);
  const titleOf = (bookId: string, entryId: string) => entryOf(bookId, entryId)?.title ?? entryId;

  const verdicts = Array.isArray(loreTrace["verdicts"]) ? (loreTrace["verdicts"] as unknown[]).filter(isRecord) : [];
  const verdictByKey = new Map(verdicts.map((v) => [str(v["entryKey"]), v]));

  const toHit = (h: Record<string, unknown>): TraceLoreHit => {
    const entryKey = str(h["entryKey"]);
    const { bookId, entryId } = splitEntryKey(entryKey);
    const verdict = verdictByKey.get(entryKey);
    const storedPosition = h["position"];
    const position: LorePosition = isRecord(storedPosition)
      ? (storedPosition as unknown as LorePosition)
      : (() => {
          const entry = entryOf(bookId, entryId);
          return entry ? positionOf(entry) : { kind: "world" as const };
        })();
    const reason = (str(h["reason"]) || "key") as TraceLoreHit["reason"];
    // th-t4-gaps 1/2: the fired verdict's own detail carries a real chance roll's rolled/needed, and a
    // fired sticky entry's remaining forced-fire turns; both are additive engine.ts instrumentation.
    const detail = verdict && isRecord(verdict["detail"]) ? verdict["detail"] : undefined;
    const rolled = typeof detail?.["rolled"] === "number" ? detail["rolled"] : undefined;
    const needed = typeof detail?.["needed"] === "number" ? detail["needed"] : undefined;
    const remaining = typeof detail?.["remaining"] === "number" ? detail["remaining"] : undefined;
    return {
      bookId,
      entryId,
      bookName: bookName(bookId),
      title: str(h["title"]) || titleOf(bookId, entryId),
      reason,
      matched: Array.isArray(h["matched"]) ? h["matched"].map(String) : [],
      tokens: num(h["tokens"]),
      place: placeLabel(position),
      loop: verdict ? num(verdict["loop"]) : 0,
      ...(rolled !== undefined && needed !== undefined ? { roll: { rolled, needed } } : {}),
      ...(reason === "sticky" && remaining !== undefined ? { stickyLeft: remaining } : {}),
    };
  };

  const injectedRaw = Array.isArray(loreTrace["injected"]) ? (loreTrace["injected"] as unknown[]).filter(isRecord) : [];
  const cutRaw = Array.isArray(loreTrace["cut"]) ? (loreTrace["cut"] as unknown[]).filter(isRecord) : [];
  const injected = injectedRaw.map(toHit);
  const cut = cutRaw.map(toHit);

  const missed: TraceLoreMiss[] = verdicts
    .filter((v) => v["fired"] !== true && !MISSED_EXCLUDED.has(str(v["reason"])))
    .map((v) => {
      const entryKey = str(v["entryKey"]);
      const { bookId, entryId } = splitEntryKey(entryKey);
      const reason = str(v["reason"]);
      const matched = Array.isArray(v["matched"]) ? v["matched"].map(String) : [];
      const detail = isRecord(v["detail"]) ? v["detail"] : undefined;
      return {
        bookId,
        entryId,
        bookName: bookName(bookId),
        title: titleOf(bookId, entryId),
        reason,
        why: whyFor(reason, matched, num(v["tokens"]), detail),
      };
    });

  // Chains (th-t3 plan step 3): fired entries only, from the trace (works on an old trace too, since
  // `injected` always existed); wake-graph edges are book-local, so both ends are keyed with the
  // book id they share.
  const firedTitle = new Map(injectedRaw.map((h) => [str(h["entryKey"]), str(h["title"])]));
  const firedReason = new Map(injectedRaw.map((h) => [str(h["entryKey"]), str(h["reason"])]));
  const chains = books.flatMap((book) =>
    loreWakeGraph(book)
      .map((e) => ({ from: `${book.id}:${e.from}`, to: `${book.id}:${e.to}`, keyword: e.keyword }))
      .filter((e) => firedTitle.has(e.from) && firedTitle.has(e.to) && firedReason.get(e.to) === "recursion")
      .map((e) => ({ from: firedTitle.get(e.from)!, to: firedTitle.get(e.to)!, keyword: e.keyword })),
  );

  return {
    injected,
    cut,
    missed,
    chains,
    totalTokens: num(loreTrace["totalTokens"]),
    share: Math.floor(windowContext * DEFAULT_LORE_SHARE),
    seed: num(loreTrace["seed"]),
  };
}
