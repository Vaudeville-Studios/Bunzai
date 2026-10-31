/**
 * The composer's text, live, for the wing that forecasts it (RoleCall passes `currentMessage` down; here the composer owns its box and saves it to a pref only after a one-second pause,
 * which is too slow for "updates as you type"). The composer publishes every edit; the wing reads the latest, or the saved draft until the composer has published one.
 * A tiny external store: live text is page-local; the composer owns the existing saved-draft preference.
 */
import { useSyncExternalStore } from "react";

const drafts = new Map<string, string>();
const listeners = new Set<() => void>();

/** The composer's text for a scene, as it stands now. */
export function publishDraft(chatId: string, text: string): void {
  if (drafts.get(chatId) === text) return;
  drafts.set(chatId, text);
  for (const notify of listeners) notify();
}

const subscribe = (notify: () => void): (() => void) => {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
};

/** The latest published text for the scene, else what the caller has saved. */
export function useLiveDraft(chatId: string, saved: () => string): string {
  const live = useSyncExternalStore(subscribe, () => drafts.get(chatId), () => undefined);
  return live ?? saved();
}

/** What the draft looks like after `piece` goes in at the selection: a space is added on a side that would glue words together. Never replaces text unless it is selected. */
export function insertAtCaret(draft: string, piece: string, start: number, end: number): { text: string; caret: number } {
  const from = Math.min(Math.max(start, 0), draft.length);
  const to = Math.min(Math.max(end, from), draft.length);
  const before = draft.slice(0, from);
  const after = draft.slice(to);
  const lead = before !== "" && !/\s$/.test(before) ? " " : "";
  const tail = after !== "" && !/^\s/.test(after) ? " " : "";
  const text = `${before}${lead}${piece}${tail}${after}`;
  return { text, caret: before.length + lead.length + piece.length + tail.length };
}

type Inserter = (piece: string) => boolean;
const inserters = new Map<string, Inserter>();
type Replacer = (text: string) => boolean;
const replacers = new Map<string, Replacer>();
const replacements = new Map<string, { text: string; resolve(applied: boolean): void; timer: ReturnType<typeof setTimeout> }>();
const REPLACE_REQUEST = "bunzai:scene:draft:replace";
const REPLACE_RESULT = "bunzai:scene:draft:replace-result";
let replacementSerial = 0;

const pending = new Map<string, string[]>();

/** The composer of a scene takes inserts while mounted; the returned function stops it. Pieces queued while no composer was open go in now, in order. */
export function registerInserter(chatId: string, take: Inserter): () => void {
  inserters.set(chatId, take);
  const waiting = pending.get(chatId);
  if (waiting) {
    pending.delete(chatId);
    const kept = waiting.filter((piece) => !take(piece));
    if (kept.length > 0) pending.set(chatId, kept);
  }
  return () => { if (inserters.get(chatId) === take) inserters.delete(chatId); };
}

/** Registers the scene composer's replacement door and applies one queued host replacement after mount. */
export function registerDraftReplacer(chatId: string, take: Replacer): () => void {
  replacers.set(chatId, take);
  const target = typeof window !== "undefined" ? window : null;
  const onRequest = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "object" || detail === null || !("requestId" in detail) || !("sceneId" in detail) || !("text" in detail)
      || typeof detail.requestId !== "string" || typeof detail.sceneId !== "string" || typeof detail.text !== "string" || detail.sceneId !== chatId) return;
    let applied = false;
    try { applied = take(detail.text); } catch { applied = false; }
    target?.dispatchEvent(new target.CustomEvent(REPLACE_RESULT, { detail: { requestId: detail.requestId, applied } }));
  };
  target?.addEventListener(REPLACE_REQUEST, onRequest);
  const pending = replacements.get(chatId);
  if (pending) {
    replacements.delete(chatId);
    clearTimeout(pending.timer);
    pending.resolve(take(pending.text));
  }
  return () => {
    target?.removeEventListener(REPLACE_REQUEST, onRequest);
    if (replacers.get(chatId) === take) replacers.delete(chatId);
  };
}

/** Replaces only through the mounted SceneComposer; absence or timeout reports stale to the host ticket. */
export function replaceComposerDraft(chatId: string, text: string, timeoutMs = 10_000): Promise<boolean> {
  const take = replacers.get(chatId);
  if (take) return Promise.resolve(take(text));
  if (replacements.has(chatId) || replacements.size >= 8) return Promise.resolve(false);
  const target = typeof window !== "undefined" ? window : null;
  if (target) return new Promise((resolve) => {
    const requestId = `${Date.now()}-${++replacementSerial}-${crypto.randomUUID()}`;
    const finish = (applied: boolean): void => {
      clearTimeout(timer);
      target.removeEventListener(REPLACE_RESULT, onResult);
      resolve(applied);
    };
    const onResult = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === "object" && detail !== null && "requestId" in detail && "applied" in detail
        && detail.requestId === requestId && typeof detail.applied === "boolean") finish(detail.applied);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    target.addEventListener(REPLACE_RESULT, onResult);
    target.dispatchEvent(new target.CustomEvent(REPLACE_REQUEST, { detail: { requestId, sceneId: chatId, text } }));
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => { replacements.delete(chatId); resolve(false); }, timeoutMs);
    replacements.set(chatId, { text, resolve, timer });
  });
}

/** Asks the scene's composer to put `piece` in its draft (Ping, a suggested action). Returns false when no composer took it; nothing is ever sent. */
export function insertIntoDraft(chatId: string, piece: string): boolean {
  return inserters.get(chatId)?.(piece) ?? false;
}

/** Holds `piece` for the scene's next composer (it goes in the draft when one opens); nothing is sent. */
export function queueForDraft(chatId: string, piece: string): void {
  pending.set(chatId, [...(pending.get(chatId) ?? []), piece]);
}
