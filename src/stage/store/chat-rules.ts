/**
 * The input checks every ChatStore implementation applies before touching anything
 * (cases 8 to 11). Shared so the memory and SQLite
 * stores cannot drift: a store that accepted what the other refuses would pass or fail the same
 * contract suite for different reasons.
 */
import { StudioConflictError, StudioValidationError } from "../../studio/errors";

import { deepEq, isPlainObject } from "../../core/guards";
import { checkWhole, fail, isJson, isWhole, onlyKeys } from "./scalar-rules";
import { checkGeneration } from "./generation-rules";
import { SANITY_LIST } from "../../entities/_shared/sanity";
import { checkDeltas } from "./scene-state-rules";
import type { Delta } from "../../core/scene-state/types";
import { promptAttachmentInfoListSchema, type PromptAttachmentInfo } from "../../core/media/prompt-attachment";

export { checkGeneration, fail, isJson };
import type {
  Cast,
  CastSnapshot,
  Chat,
  ChatConnection,
  ChatLore,
  ChatProps,
  Generation,
  JsonObject,
  MessageRole,
  TurnTarget,
  WriteGuard,
} from "../contracts/chat-store";

const ROLES: ReadonlySet<string> = new Set(["user", "assistant", "system"]);

export function checkText(value: unknown, what: string): string {
  if (typeof value !== "string") fail(`${what} must be text`);
  return value;
}

export function checkTitle(value: unknown): string {
  const title = checkText(value, "title").trim();
  if (title.length === 0) fail("title must not be empty");
  return title;
}

export function checkRole(value: unknown): MessageRole {
  if (typeof value !== "string" || !ROLES.has(value)) fail("unknown message role");
  return value as MessageRole;
}

/**
 * Builds a fresh Generation from exactly the fields the contract names, each of its type. Anything
 * else is refused rather than stored, because stores would otherwise keep it differently (SQLite's
 * JSON turns a Map into {}, a Date into a string, NaN into null) and a test on one store would pass
 * while the other quietly changed the data. A field set to undefined is left out.
 */
/** A non-empty list of messages to append, each checked, before anything is written. */
export function checkMessageInputs(inputs: unknown): { role: MessageRole; content: string; generation: Generation | undefined }[] {
  if (!Array.isArray(inputs) || inputs.length === 0) fail("inputs must be a non-empty list");
  return inputs.map((input: { role?: unknown; content?: unknown; generation?: unknown } | undefined) => ({
    role: checkRole(input?.role),
    content: checkText(input?.content, "content"),
    generation: checkGeneration(input?.generation),
  }));
}

/** The version a write was based on, or undefined for an unconditional write. */
export function checkGuard(guard: WriteGuard | undefined): number | undefined {
  const expected = guard?.expectedVersion;
  if (expected === undefined) return undefined;
  return checkWhole(expected, "expectedVersion must be a whole number of at least 1", 1);
}

export function checkSwipeIndex(index: unknown): number {
  return checkWhole(index, "swipe index must be a whole number, zero or more", 0);
}

export function checkPinned(pinned: unknown): boolean {
  if (typeof pinned !== "boolean") fail("pinned must be true or false");
  return pinned;
}

/** setFavorite's on/off (rule 23). */
export function checkOn(value: unknown): boolean {
  if (typeof value !== "boolean") fail("on must be true or false");
  return value;
}

export function checkPage(page: { fromSeq?: number; limit: number } | undefined): { fromSeq: number; limit: number } {
  const limit = checkWhole(page?.limit, "limit must be a whole number of at least 1", 1);
  const fromSeq = checkWhole(page?.fromSeq ?? 1, "fromSeq must be a whole number");
  return { fromSeq, limit };
}

/** A reverse page's exclusive cursor, validated like the forward sequence cursor. */
export function checkBeforePage(page: { beforeSeq?: number; limit: number; liveOnly?: boolean } | undefined): { beforeSeq?: number; limit: number; liveOnly: boolean } {
  const limit = checkWhole(page?.limit, "limit must be a whole number of at least 1", 1);
  const beforeSeq = page?.beforeSeq === undefined ? undefined : checkWhole(page.beforeSeq, "beforeSeq must be a positive whole number", 1);
  const liveOnly = page?.liveOnly ?? false;
  if (typeof liveOnly !== "boolean") fail("liveOnly must be true or false");
  return { ...(beforeSeq === undefined ? {} : { beforeSeq }), limit: Math.min(limit, 60), liveOnly };
}
/** A single lazy macro request is deliberately capped so it cannot become a transcript read. */
export function checkMessageOrdinals(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 60) fail("indices must be an array of at most 60 whole numbers");
  if (value.some((index) => !isWhole(index, 0))) fail("indices must be non-negative whole numbers");
  return [...new Set(value as number[])];
}
/** Exactly a connection id and a model, both non-empty text, or null to forget it (rule 18). */
export function checkConnection(value: unknown): ChatConnection | null {
  if (value === null) return null;
  if (!isPlainObject(value)) fail("connection must be a plain object or null");
  for (const key of Object.keys(value)) if (key !== "id" && key !== "model") fail(`connection has an unknown field: ${key}`);
  const id = checkText(value.id, "connection id");
  const model = checkText(value.model, "connection model");
  if (id.length === 0 || model.length === 0) fail("connection id and model must not be empty");
  return { id, model };
}

const MAX_LORE_IDS = 200;

/** A list of non-empty-string ids, at most `limit`, with no duplicates (rule 20). */
export function checkIdList(value: unknown, what: string, limit: number): string[] {
  if (!Array.isArray(value)) fail(`${what} must be an array`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string" || v.length === 0) fail(`${what} entries must be non-empty text`);
    if (seen.has(v)) fail(`${what} has a duplicate: ${v}`);
    seen.add(v);
    out.push(v);
  }
  // The hostile-input ceiling is not a product limit, and says so; the older lists keep their own words.
  if (out.length > limit) fail(limit === SANITY_LIST ? `${what} is unusually large` : `${what} must hold at most ${limit}`);
  return out;
}

/**
 * Exactly the scene's added and switched-off lorebooks, or null to forget it (rule 20). The store
 * never checks a book id against the library (D18); an id may appear in both lists.
 */
export function checkLore(value: unknown): ChatLore | null {
  if (value === null) return null;
  if (!isPlainObject(value)) fail("lore must be a plain object or null");
  const known = new Set(["added", "off"]);
  for (const key of Object.keys(value)) if (!known.has(key)) fail(`lore has an unknown field: ${key}`);
  const added = checkIdList(value.added, "lore added", MAX_LORE_IDS);
  const off = checkIdList(value.off, "lore off", MAX_LORE_IDS);
  return { added, off };
}

const MAX_PROP_IDS = 50;
const PROP_ID_RE = /^[a-z0-9-]{1,64}$/;

/** Exactly the scene's switched-on Prop ids, or null to forget them (rule 21). Each id is
 * 1 to 64 characters of [a-z0-9-], the Props registry's own id shape. */
export function checkProps(value: unknown): ChatProps | null {
  if (value === null) return null;
  if (!isPlainObject(value)) fail("props must be a plain object or null");
  const known = new Set(["on"]);
  for (const key of Object.keys(value)) if (!known.has(key)) fail(`props has an unknown field: ${key}`);
  const on = checkIdList(value.on, "props on", MAX_PROP_IDS);
  for (const id of on) if (!PROP_ID_RE.test(id)) fail(`props on id is invalid: ${id}`);
  return { on };
}

/** A story folder's name (rule 24): trimmed, non-empty, at most 80 characters. */
export function checkFolderName(value: unknown): string {
  const name = checkText(value, "name").trim();
  if (name.length === 0) fail("folder name must not be empty");
  if (name.length > 80) fail("folder name must be at most 80 characters");
  return name;
}

/** setFolder's target (rule 24): a folder id, or null to clear it. Existence is the store's to check. */
export function checkFolderId(value: unknown): string | null {
  return value === null ? null : checkText(value, "folderId");
}

/** Purge cannot be undone, so a cutoff that is not a real time purges nothing. */
export function checkCutoff(before: unknown): number {
  if (typeof before !== "number" || !Number.isFinite(before)) fail("before must be a finite time");
  return before;
}

/** A snapshot whose members match the cast's exactly, each a JSON object. Returns a private copy. */
export function checkSnapshot(value: unknown, cast: Cast): CastSnapshot {
  if (!isPlainObject(value)) fail("snapshot must be an object");
  const members = ["character", "persona"] as const;
  for (const key of Object.keys(value)) {
    if (!(members as readonly string[]).includes(key)) fail(`snapshot has an unknown member: ${key}`);
  }
  const out: Record<string, JsonObject> = {};
  for (const member of members) {
    const inCast = cast[member] !== undefined;
    const body = value[member];
    if (inCast !== (body !== undefined)) fail(`snapshot and cast disagree about the ${member}`);
    if (body === undefined) continue;
    if (!isPlainObject(body) || !isJson(body)) fail(`snapshot ${member} must be a JSON object`);
    out[member] = structuredClone(body) as JsonObject;
  }
  return out as unknown as CastSnapshot;
}

export function checkCast(value: unknown): Cast {
  const ref = (r: unknown, what: string) => {
    const o = r as { id?: unknown; version?: unknown; name?: unknown; hasArt?: unknown; accent?: unknown } | null;
    if (typeof o !== "object" || o === null) fail(`${what} must be a reference`);
    if (typeof o.id !== "string" || o.id.length === 0) fail(`${what} needs an id`);
    if (!isWhole(o.version, 1)) fail(`${what} needs a version`);
    if (o.name !== undefined && typeof o.name !== "string") fail(`${what} name must be text`);
    if (o.hasArt !== undefined && typeof o.hasArt !== "boolean") fail(`${what} hasArt must be true or false`);
    // A signature color is a #rrggbb hex, the one shape every accent writer produces; anything else
    // (a CSS fragment) is refused at the boundary, never stored and handed to an inline style.
    if (o.accent !== undefined && (typeof o.accent !== "string" || !/^#[0-9a-f]{6}$/i.test(o.accent))) fail(`${what} accent must be a #rrggbb color`);
    return {
      id: o.id, version: o.version,
      ...(o.name === undefined ? {} : { name: o.name }),
      ...(o.hasArt === undefined ? {} : { hasArt: o.hasArt }),
      ...(o.accent === undefined ? {} : { accent: o.accent }),
    };
  };
  const c = value as { character?: unknown; persona?: unknown } | null;
  if (typeof c !== "object" || c === null) fail("cast must be an object");
  // A misspelt or removed member (cast.preset, spec rule 19) is refused, never silently dropped.
  for (const key of Object.keys(c)) if (key !== "character" && key !== "persona") fail(`cast has an unknown member: ${key}`);
  return {
    character: ref(c.character, "character"),
    ...(c.persona === undefined ? {} : { persona: ref(c.persona, "persona") }),
  };
}

export type CutScope = "one" | "from";

export function checkScope(scope: unknown): CutScope {
  if (scope !== "one" && scope !== "from") fail('scope must be "one" or "from"');
  return scope;
}

/**
 * A newer cast for the same chat (spec rule 13): the same character, checked like createChat's. Returns
 * null when it is the cast and snapshot the chat already has, so the caller changes nothing.
 */
export function checkRecast(
  input: { cast?: unknown; snapshot?: unknown } | undefined,
  current: { cast: Cast; snapshot: CastSnapshot },
): { cast: Cast; snapshot: CastSnapshot } | null {
  const cast = checkCast(input?.cast);
  const snapshot = checkSnapshot(input?.snapshot, cast);
  if (cast.character.id !== current.cast.character.id) fail("a chat can only move to a newer copy of its own character");
  const same = deepEq(cast, current.cast) && deepEq(snapshot, current.snapshot);
  return same ? null : { cast, snapshot };
}

export const MAIN_UNDELETABLE = "the original take cannot be deleted";

/** A revert that names the version it expects to leave refuses a chat on any other (rule 13). */
export function requireCastVersion(chat: Chat, expected: number | undefined): void {
  if (expected !== undefined && chat.cast.character.version !== expected) {
    throw new StudioConflictError("the scene is on version " + chat.cast.character.version + ", not " + expected);
  }
}

/** Every guarded write across the memory and SQLite stores reports the same stale-branch conflict. */
export function requireVersion(actual: number, expected: number | undefined): void {
  if (expected !== undefined && actual !== expected) {
    throw new StudioConflictError("branch is at version " + actual + ", not " + expected);
  }
}


/** A trace (rule 15): absent, or a JSON object. Returns a private copy. */
export function checkTrace(value: unknown): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || !isJson(value)) fail("trace must be a JSON object");
  return structuredClone(value) as JsonObject;
}

/** What a turn is for (rule 16). */
export function checkTurnTarget(value: unknown): TurnTarget {
  const target = onlyKeys(value, ["kind", "messageId"], "turn target");
  if (target.kind === "reply" && target.messageId === undefined) return { kind: "reply" };
  if (target.kind === "swipe" || target.kind === "continue") return { kind: target.kind, messageId: checkText(target.messageId, "messageId") };
  return fail("turn kind must be reply, swipe or continue");
}

/** A checkpoint's progress (rule 16). */
export function checkProgress(value: unknown): { content: string; trace: JsonObject | undefined; providerRequestId: string | undefined; deltas: Delta[] | undefined } {
  const p = onlyKeys(value, ["content", "trace", "providerRequestId", "deltas"], "progress");
  const providerRequestId = p.providerRequestId === undefined ? undefined : checkText(p.providerRequestId, "providerRequestId");
  return { content: checkText(p.content, "content"), trace: checkTrace(p.trace), providerRequestId, deltas: p.deltas === undefined ? undefined : checkDeltas(p.deltas, "turn") };
}

/** The take's latest request text (rule 22): absent, or exactly a list of texts, one per stored
 * trace block. Empty is allowed (a reply whose trace has no blocks). */
export function checkTurnRequest(value: unknown): { texts: string[]; files?: PromptAttachmentInfo[] } | undefined {
  if (value === undefined) return undefined;
  const r = onlyKeys(value, ["texts", "files"], "request");
  if (!Array.isArray(r.texts)) fail("request texts must be a list");
  const request = { texts: r.texts.map((t) => checkText(t, "request text")) };
  if (r.files === undefined) return request;
  const files = promptAttachmentInfoListSchema.safeParse(r.files);
  if (!files.success || files.data.some((file) => file.message >= request.texts.length)) fail("request files are invalid");
  return { ...request, files: files.data };
}

/** A turn's result (rule 16, plus rule 22's request). */
export function checkTurnResult(value: unknown): { content: string; generation: Generation | undefined; trace: JsonObject | undefined; request: { texts: string[]; files?: PromptAttachmentInfo[] } | undefined } {
  const r = onlyKeys(value, ["content", "generation", "trace", "request"], "turn result");
  return { content: checkText(r.content, "content"), generation: checkGeneration(r.generation), trace: checkTrace(r.trace), request: checkTurnRequest(r.request) };
}
