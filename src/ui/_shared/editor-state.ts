/**
 * Kind-agnostic editor state helpers: immutable-draft dirty tracking
 * and an id -> index map, both extracted once so every editor that owns a "body vs. baseline, is it
 * dirty" pair stops paying for its own whole-document compare on every render and its own per-row
 * `findIndex` on every row. `deepEqual` moved here from `workbench/editor-core.ts` (which re-exports
 * it unchanged - every existing caller keeps working) because it is no longer workbench-only: the
 * Prompting wing (`apps/scenes`) needs the id-index half and would otherwise have had to reach into
 * a Workbench-private file to get it.
 *
 * USED by Workbench save paths for touched-value dirtiness, bounded undo, and serialized saves.
 * Structural equality is limited to broad structural edits and their save receipts.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useEffect } from "react";
import { CANONICAL_SCHEMA_VERSION } from "../../core/canonical";
import type { ParsedCanonicalEntity } from "../../entities/runtime-schema";
import type { PiecePatch, SaveIntent } from "../../stage/contracts/content-store";
import { AUTOSAVE_TRIES } from "./autosave-budget";
import { isTypingTarget } from "./typing-target";
import { BoundedEditorHistory, EditorMutationLedger, type EditorHistoryChange, type EditorTouch } from "./editor-mutation";
export { applyEditorHistoryChange, BoundedEditorHistory, editorHistoryChanges, EditorMutationLedger, OccurrenceIndex, type EditorHistoryChange, type EditorTouch } from "./editor-mutation";
import { applyPiecePatch, buildPiecePatch, buildTouchedPatch, deepEqual, splitPiecePatch } from "./editor-patch";
export { applyPiecePatch, buildPiecePatch, buildTouchedPatch, deepEqual } from "./editor-patch";

/** Serializes saves and overwrites. The generation advances on reseed or unmount, so a prior
 * request can finish remotely without committing its baseline or conflict UI into a new piece. */
export class EditorSaveQueue {
  #tail: Promise<void> = Promise.resolve();
  #generation = 0;
  #paused = false;

  invalidate(): number { this.#paused = false; return ++this.#generation; }
  pause(): number { this.#paused = true; return ++this.#generation; }
  resume(generation: number): boolean {
    if (!this.current(generation)) return false;
    this.#paused = false;
    this.invalidate();
    return true;
  }
  idle(): Promise<void> { return this.#tail; }
  current(generation: number): boolean { return generation === this.#generation; }

  run<T>(operation: (isCurrent: () => boolean) => Promise<T>): Promise<T | undefined> {
    if (this.#paused) return Promise.resolve(undefined);
    const generation = this.#generation;
    const result = this.#tail.then(async () => {
      if (!this.current(generation)) return undefined;
      return operation(() => this.current(generation));
    });
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export interface EditorSaveAdapter<Draft, Entity> {
  hasChanges(): boolean;
  capture(): { draft: Draft; baseline: Entity; revision: number; patchState?: { structural: boolean; items: Record<string, unknown>; release?(): void; overwrite?(): void } };
  expectedRevision(): string;
  read(): Promise<{ entity: Entity; revision: string }>;
  nativeState?(entity: Entity): unknown;
  onAcceptedNative?(native: unknown): void;
  buildPatch(baseline: Entity, draft: Draft, native?: unknown, patchState?: { structural: boolean; items: Record<string, unknown> }): PiecePatch;
  itemNames(baseline: Entity): readonly string[];
  applyPatch(baseline: Entity, patch: PiecePatch): Entity;
  advanceNative?(native: unknown, patch: PiecePatch): unknown;
  patch(revision: string, patch: PiecePatch, intent: SaveIntent): Promise<{ revision: string }>;
  commit(draft: Draft, atRevision: number, savedRevision: string): void;
  commitPartial(entity: Entity, atRevision: number, savedRevision: string): void;
  takeTheirs?(entity: Entity, revision: string): void;
  isConflict(error: unknown): boolean;
  onSave?(draft: Draft, mode: "save" | "keepMine"): void;
  onError(error: unknown, mode: "save" | "keepMine" | "takeTheirs"): void;
}

/** The one Workbench save lifecycle: capture, delta, conditional write, conflict resolution, and
 * single-flight serialization. Adapters own only how their draft maps to a canonical baseline. */
export function useEditorSave<Draft, Entity>(adapter: EditorSaveAdapter<Draft, Entity>): {
  saving: boolean;
  conflict: boolean;
  autosave: { stalled: boolean; attempts: number; retry(): void };
  save(intent?: SaveIntent): Promise<boolean>;
  keepMine(): Promise<void>;
  takeTheirs(): Promise<void>;
  clearConflict(): void;
  invalidate(): void;
  reseed(entity: Entity, revision: string): void;
} {
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const queue = useRef(new EditorSaveQueue());
  const accepted = useRef<{ entity: Entity; revision: string; native?: unknown } | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [autosaveFailures, setAutosaveFailures] = useState(0);
  useEffect(() => () => { queue.current.invalidate(); }, []);

  const save = useCallback(async (intent: SaveIntent = "manual"): Promise<boolean> => {
    if (!adapterRef.current.hasChanges()) return true;
    const snapshot = adapterRef.current.capture();
    const result = await queue.current.run(async (isCurrent) => {
      const current = adapterRef.current;
      if (!current.hasChanges()) return true;
      const prior = accepted.current ??= {
        entity: snapshot.baseline, revision: current.expectedRevision(), native: current.nativeState?.(snapshot.baseline),
      };
      current.onAcceptedNative?.(prior.native);
      setSaving(true);
      let partial: { entity: Entity; revision: string } | null = null;
      try {
        let entity = prior.entity;
        let revision = prior.revision;
        let native = prior.native;
        const patch = current.buildPatch(prior.entity, snapshot.draft, native, snapshot.patchState);
        for (const part of splitPiecePatch(patch, patch.order ? current.itemNames(prior.entity) : [])) {
          const saved = await current.patch(revision, part, intent);
          if (!isCurrent()) return false;
          entity = current.applyPatch(entity, part);
          revision = saved.revision;
          const previousNative = native;
          native = current.advanceNative?.(native, part) ?? native;
          accepted.current = { entity, revision, native };
          partial = { entity, revision };
          if (native !== previousNative) current.onAcceptedNative?.(native);
        }
        current.commit(snapshot.draft, snapshot.revision, revision);
        setConflict(false);
        setAutosaveFailures(0);
        current.onSave?.(snapshot.draft, "save");
        return true;
      } catch (error) {
        if (isCurrent() && partial) current.commitPartial(partial.entity, snapshot.revision, partial.revision);
        if (isCurrent()) setAutosaveFailures((n) => Math.min(n + 1, AUTOSAVE_TRIES));
        if (isCurrent() && adapterRef.current.isConflict(error)) setConflict(true);
        if (isCurrent()) adapterRef.current.onError(error, "save");
        return false;
      } finally {
        if (isCurrent()) {
          setSaving(false);
        }
      }
    }).finally(() => snapshot.patchState?.release?.());
    return result ?? false;
  }, []);

  const keepMine = useCallback(async (): Promise<void> => {
    const snapshot = adapterRef.current.capture();
    await queue.current.run(async (isCurrent) => {
      const current = adapterRef.current;
      setSaving(true);
      let partial: { entity: Entity; revision: string } | null = null;
      try {
        const fresh = await current.read();
        if (!isCurrent()) return;
        let entity = fresh.entity;
        let revision = fresh.revision;
        let native = current.nativeState?.(fresh.entity);
        snapshot.patchState?.overwrite?.();
        current.commitPartial(entity, snapshot.revision, revision);
        accepted.current = { entity, revision, native };
        current.onAcceptedNative?.(native);
        const patch = current.buildPatch(fresh.entity, snapshot.draft, native, { structural: true, items: {} });
        for (const part of splitPiecePatch(patch, patch.order ? current.itemNames(fresh.entity) : [])) {
          const saved = await current.patch(revision, part, "manual");
          if (!isCurrent()) return;
          entity = current.applyPatch(entity, part);
          revision = saved.revision;
          const previousNative = native;
          native = current.advanceNative?.(native, part) ?? native;
          accepted.current = { entity, revision, native };
          partial = { entity, revision };
          if (native !== previousNative) current.onAcceptedNative?.(native);
        }
        current.commit(snapshot.draft, snapshot.revision, revision);
        setConflict(false);
        setAutosaveFailures(0);
        current.onSave?.(snapshot.draft, "keepMine");
      } catch (error) {
        if (isCurrent()) {
          if (partial) current.commitPartial(partial.entity, snapshot.revision, partial.revision);
          if (current.isConflict(error)) setConflict(true);
          current.onError(error, "keepMine");
        }
      } finally {
        if (isCurrent()) {
          setSaving(false);
        }
      }
    }).finally(() => snapshot.patchState?.release?.());
  }, []);

  const takeTheirs = useCallback(async (): Promise<void> => {
    const generation = queue.current.pause();
    setConflict(false);
    setSaving(true);
    try {
      await queue.current.idle();
      const fresh = await adapterRef.current.read();
      if (!queue.current.current(generation)) return;
      accepted.current = { ...fresh, native: adapterRef.current.nativeState?.(fresh.entity) };
      adapterRef.current.onAcceptedNative?.(accepted.current.native);
      adapterRef.current.takeTheirs?.(fresh.entity, fresh.revision);
      setConflict(false);
      setAutosaveFailures(0);
    } catch (error) {
      if (queue.current.current(generation)) adapterRef.current.onError(error, "takeTheirs");
    } finally {
      if (queue.current.resume(generation)) setSaving(false);
    }
  }, []);

  const clearConflict = useCallback((): void => setConflict(false), []);
  const invalidate = useCallback((): void => {
    queue.current.invalidate();
    accepted.current = null;
    setAutosaveFailures(0);
    setSaving(false);
    setConflict(false);
  }, []);
  const reseed = useCallback((entity: Entity, revision: string): void => {
    queue.current.invalidate();
    const current = adapterRef.current;
    accepted.current = { entity, revision, native: current.nativeState?.(entity) };
    current.onAcceptedNative?.(accepted.current.native);
    current.takeTheirs?.(entity, revision);
    setAutosaveFailures(0);
    setSaving(false);
    setConflict(false);
  }, []);
  const retryAutosave = useCallback((): void => setAutosaveFailures(0), []);
  return {
    saving, conflict, save, keepMine, takeTheirs, clearConflict, invalidate, reseed,
    autosave: { stalled: autosaveFailures >= AUTOSAVE_TRIES, attempts: autosaveFailures, retry: retryAutosave },
  };
}

export interface EditorRevision<T> {
  body: T;
  baseline: T;
  /** Mutation-time dirty flag; touched edits compare only the changed value against baseline. */
  dirty: boolean;
  /** Every real edit routes through here - it is what makes the revision counter true to its name. */
  edit(updater: (current: T) => T, touch?: EditorTouch<T>): void;
  /** A fresh read (open, or a reload from underneath) becomes both the new baseline and body. */
  reseed(fresh: T): void;
  /** Give up local edits and mark the new revision saved. */
  discard(): void;
  /** The revision to hand back to `commit` once an in-flight async save resolves. Call this BEFORE
   * the `await`, not after - a save can take seconds, and anything typed while it is in flight must still count as unsaved. */
  captureRevision(): number;
  capturePatchState(): { revision: number; structural: boolean; items: Record<string, unknown>; release(): void; overwrite(): void };
  releaseSubmission(revision: number): void;
  /**
   * A save/overwrite landed. `submitted` MUST be the exact body value that was sent (no clone -
   * every session op is immutable, so the snapshot captured before the `await` is already safe to
   * reuse as the new baseline by reference), and `atRev` is what `captureRevision()` returned right
   * before that same `await`.
   */
  commit(submitted: T, atRev: number): void;
  canUndo: boolean;
  canRedo: boolean;
  historyHas(predicate: (change: EditorHistoryChange<T>) => boolean): boolean;
  undo(): T | undefined;
  redo(): T | undefined;
}

/**
 * One editor body's dirty tracking. `initial` seeds BOTH body and baseline with the same reference
 * (a fresh read has nothing to compare against yet, same reasoning as `reseed`).
 */
export function useEditorRevision<T>(
  initial: T,
  history?: { kind: ParsedCanonicalEntity["kind"]; id: string },
): EditorRevision<T> {
  const historyKind = history?.kind, historyId = history?.id;
  const [baseline, setBaseline] = useState(initial);
  const [body, setBody] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const ledgerRef = useRef<EditorMutationLedger<T> | null>(null);
  ledgerRef.current ??= new EditorMutationLedger(initial);
  const ledger = ledgerRef.current;
  const legacySubmissions = useRef(new Map<number, ((current: T) => void)[]>());

  const edit = useCallback((updater: (current: T) => T, touch?: EditorTouch<T>): void => {
    const current = bodyRef.current;
    const next = updater(current);
    const changed = touch
      ? !deepEqual(touch.read(current), touch.read(next))
      : next !== current && !deepEqual(current, next);
    if (changed) ledger.track(next, touch, revisionRef.current + 1);
    setDirty(ledger.dirty);
    if (historyKind !== undefined && historyId !== undefined && changed) {
      if (touch?.write) ledger.history.record(
        { touch, value: touch.read(current) }, { touch, value: touch.read(next) },
      );
      else {
        const before = { schemaVersion: CANONICAL_SCHEMA_VERSION, kind: historyKind, id: historyId, body: current } as unknown as ParsedCanonicalEntity;
        const after = { ...before, body: next } as unknown as ParsedCanonicalEntity;
        const inverse = touch ? buildTouchedPatch(before, touch.items?.(current)) : buildPiecePatch(after, before);
        const forward = touch ? buildTouchedPatch(after, touch.items?.(next)) : buildPiecePatch(before, after);
        ledger.history.record({ patch: inverse, touch }, { patch: forward, touch });
      }
    }
    bodyRef.current = next;
    setBody(next);
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  }, [historyKind, historyId, ledger]);

  // reseed and discard move body too, so they advance the revision like an edit: a save captured before
  // them can then never commit its way back to "clean" while the screen shows something else.
  const reseed = useCallback((fresh: T): void => {
    setBaseline(fresh);
    baselineRef.current = fresh;
    ledger.reseed(fresh);
    legacySubmissions.current.clear();
    setDirty(false);
    setBody(fresh);
    bodyRef.current = fresh;
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  }, [ledger]);

  const discard = useCallback((): void => {
    setBody(baseline);
    bodyRef.current = baseline;
    ledger.reseed(baseline);
    legacySubmissions.current.clear();
    setDirty(false);
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  }, [baseline, ledger]);

  const captureRevision = useCallback((): number => {
    const revision = revisionRef.current;
    const releases = legacySubmissions.current.get(revision) ?? [];
    releases.push(ledger.beginSubmit(revision));
    legacySubmissions.current.set(revision, releases);
    return revisionRef.current;
  }, [ledger]);
  const releaseSubmission = useCallback((revision: number): void => {
    const releases = legacySubmissions.current.get(revision);
    legacySubmissions.current.delete(revision);
    for (const release of releases ?? []) release(bodyRef.current);
    setDirty(ledger.dirty);
  }, [ledger]);
  const capturePatchState = useCallback(() => {
    const revision = revisionRef.current;
    const release = ledger.beginSubmit(revision);
    const structural = ledger.structural;
    return { revision, get structural() {
      if (ledger.structural) release.promote();
      return structural || ledger.structural;
    }, items: ledger.partItems(bodyRef.current),
      overwrite: () => { ledger.markOverwrite(revision); setDirty(ledger.dirty); },
      release: () => { release(bodyRef.current); setDirty(ledger.dirty); },
    };
  }, [ledger]);

  const commit = useCallback((submitted: T, atRev: number): void => {
    setBaseline(submitted);
    baselineRef.current = submitted;
    ledger.accept(submitted, bodyRef.current, atRev);
    // discard/reseed clear the ledger, but they cannot cancel a save already on the wire. If that
    // older receipt arrives afterwards, restore dirty provenance for the newer screen body.
    if (revisionRef.current > atRev && !deepEqual(bodyRef.current, submitted)) {
      ledger.track(bodyRef.current, undefined, revisionRef.current, true);
    }
    setDirty(ledger.dirty);
  }, [ledger]);

  const updateDirty = useCallback((next: T, touch?: EditorTouch<T>): void => {
    ledger.track(next, touch, revisionRef.current + 1, true);
    setDirty(ledger.dirty);
  }, [ledger]);

  const undo = useCallback((): T | undefined => {
    const entry = ledger.history.undo();
    if (!entry || historyKind === undefined || historyId === undefined) return undefined;
    const current = { schemaVersion: CANONICAL_SCHEMA_VERSION, kind: historyKind, id: historyId, body: bodyRef.current } as unknown as ParsedCanonicalEntity;
    const next = entry.touch?.write ? entry.touch.write(bodyRef.current, entry.value) :
      entry.patch ? applyPiecePatch(current, entry.patch).body as unknown as T : bodyRef.current;
    updateDirty(next, entry.touch);
    bodyRef.current = next;
    setBody(next);
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    return next;
  }, [historyKind, historyId, updateDirty, ledger]);

  const redo = useCallback((): T | undefined => {
    const entry = ledger.history.redo();
    if (!entry || historyKind === undefined || historyId === undefined) return undefined;
    const current = { schemaVersion: CANONICAL_SCHEMA_VERSION, kind: historyKind, id: historyId, body: bodyRef.current } as unknown as ParsedCanonicalEntity;
    const next = entry.touch?.write ? entry.touch.write(bodyRef.current, entry.value) :
      entry.patch ? applyPiecePatch(current, entry.patch).body as unknown as T : bodyRef.current;
    updateDirty(next, entry.touch);
    bodyRef.current = next;
    setBody(next);
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    return next;
  }, [historyKind, historyId, updateDirty, ledger]);

  return {
    body, baseline, dirty, edit, reseed, discard, captureRevision, capturePatchState, releaseSubmission, commit,
    canUndo: Boolean(history) && ledger.history.canUndo,
    canRedo: Boolean(history) && ledger.history.canRedo,
    historyHas: (predicate: (change: EditorHistoryChange<T>) => boolean) => ledger.history.some(predicate),
    undo, redo,
  };
}

/** Shared editor-level undo shortcut; text fields keep their native Ctrl+Z editing behavior. */
export function useEditorHistoryKeys(
  canUndo: boolean,
  canRedo: boolean,
  undo: () => void,
  redo: () => void,
  status: (message: string) => void,
  label: string,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const redoAction = key === "y" || (key === "z" && event.shiftKey);
      if (key !== "z" && key !== "y") return;
      if (isTypingTarget(event.target)) return;
      if (redoAction ? !canRedo : !canUndo) return;
      event.preventDefault();
      if (redoAction) redo(); else undo();
      status(`${redoAction ? "redid" : "undid"} last ${label} edit`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUndo, canRedo, undo, redo, status, label]);
}

/**
 * `id -> index` in `items`, rebuilt once per `items` reference instead of once per ROW: replaces
 * the `blocks.findIndex((x) => x.id === b.id)` shape (an O(n) scan inside a `.map`, so O(n^2) over a
 * full render) with one O(n) pass shared by every row. `getId` should be a stable reference (a
 * module-level function, or memoized by the caller) - a fresh one every render defeats the memo.
 */
export function useIdIndex<T>(items: readonly T[], getId: (item: T) => string): ReadonlyMap<string, number> {
  return useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, i) => map.set(getId(item), i));
    return map;
  }, [items, getId]);
}
