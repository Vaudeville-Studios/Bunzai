/**
 * The save lifecycle the four small piece editors (tracker, tool, dice, formula) share: the body as a draft over the saved one, dirty and undo
 * from the editor revision, one conditional write through the Workbench's save queue, the conflict bar's two exits, a re-read that reaches a
 * clean editor, and the Workbench guards (save keys, the unsaved mark, autosave). A draft the kind's strict decoder refuses is not savable:
 * autosave waits and the person is told why. A save sends the piece's head with the edited body; with nothing edited, nothing is sent.
 */
import { useCallback, useMemo, useRef } from "react";
import type { AppContext, StudioEntitySummary } from "../../../app-contract";
import { CANONICAL_SCHEMA_VERSION } from "../../../../core/canonical";
import { recOr } from "../../../../core/guards";
import type { ParsedCanonicalEntity } from "../../../../entities/runtime-schema";
import { applyPiecePatch, buildPiecePatch, useEditorHistoryKeys, useEditorRevision, useEditorSave } from "../../../_shared/editor-state";
import { apiStatusIs } from "../../../_shared/api-fetch";
import { toErrorMessage } from "../../../_shared/error-message";
import { partNames } from "../../../../entities/piece-parts";
import { useEditorGuards } from "../use-editor-guards";
import { useReseedOnReread } from "../use-reseed";
import { pieceProblem } from "./piece-problem";
import { historyContainsAssetRef, referencedAssetUploads } from "../../../_shared/asset-upload";
import type { StagedAssetUpload } from "../../../app-contract-editor";

interface PieceAssetLifecycle {
  uploads: StagedAssetUpload[];
  accept(refs: readonly string[]): void;
  unpin(refs: readonly string[]): void;
  discardUnused(refs: readonly string[], currentDraft: unknown, retained?: (grant: StagedAssetUpload) => boolean): Promise<string[]>;
}

export interface PieceSession<B> {
  body: B;
  edit(update: (body: B) => B): void;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  /** Why the draft cannot be saved yet, or null. */
  problem: string | null;
  save(): Promise<boolean>;
  keepMine(): Promise<void>;
  takeTheirs(): Promise<void>;
}

export function usePieceEditor<B extends { name: string }>({ kind, entity, revision, ctx, piece, check, assetUploads }: {
  kind: ParsedCanonicalEntity["kind"]; entity: unknown; revision: string; ctx: AppContext; piece: StudioEntitySummary;
  /** A further reason, beyond the decoder's, the draft cannot be saved (a prompt line whose macros fail), in plain words, or null. */
  check?: (body: B) => string | null;
  /** Optional staged media owner for piece editors whose body has declared media slots. */
  assetUploads?: PieceAssetLifecycle;
}): PieceSession<B> {
  const revisionRef = useRef(revision);
  // the entity has passed the canonical decoder on its way here
  const initial = useMemo(() => recOr(entity).body as unknown as B, [entity]);
  const { body, baseline, dirty, edit: editRaw, capturePatchState, commit, reseed, canUndo, canRedo, historyHas, undo, redo } = useEditorRevision(initial, { kind, id: piece.id });
  const assetState = useRef(assetUploads);
  assetState.current = assetUploads;
  const historyState = useRef(historyHas);
  historyState.current = historyHas;
  const pruneUploads = useCallback((draft: unknown): void => {
    const owner = assetState.current;
    if (!owner) return;
    const refs = owner.uploads.map((upload) => upload.ref);
    owner.unpin(refs);
    void owner.discardUnused(refs, draft, (upload) => historyState.current((change) => historyContainsAssetRef(change, upload.asset)));
  }, []);
  const edit = useCallback((update: (body: B) => B): void => {
    let next = body;
    editRaw((current) => { next = update(current); return next; });
    pruneUploads(next);
  }, [body, editRaw, pruneUploads]);
  const undoAndPrune = useCallback(() => { const next = undo(); if (next !== undefined) pruneUploads(next); }, [undo, pruneUploads]);
  const redoAndPrune = useCallback(() => { const next = redo(); if (next !== undefined) pruneUploads(next); }, [redo, pruneUploads]);
  useEditorHistoryKeys(canUndo, canRedo, undoAndPrune, redoAndPrune, ctx.setStatus, kind);
  const baseEntity = useMemo(() => ({ ...recOr(entity), schemaVersion: CANONICAL_SCHEMA_VERSION, kind, id: piece.id, body: baseline }) as unknown as ParsedCanonicalEntity, [entity, baseline, kind, piece.id]);
  const bodyOf = (from: unknown): B => recOr(from).body as unknown as B;
  const saveState = useEditorSave({
    hasChanges: () => dirty,
    capture: () => {
      const patchState = capturePatchState();
      return { draft: body, baseline: baseEntity, revision: patchState.revision, patchState };
    },
    expectedRevision: () => revisionRef.current,
    read: async () => {
      const fresh = await ctx.api.getLightEditableEntity(`kind=${kind}&id=${encodeURIComponent(piece.id)}`);
      return { entity: fresh.entity as ParsedCanonicalEntity, revision: fresh.revision };
    },
    buildPatch: (base, submitted) => buildPiecePatch(base, { ...base, body: submitted } as ParsedCanonicalEntity),
    itemNames: partNames,
    applyPatch: applyPiecePatch,
    patch: async (expected, patch, intent) => {
      const used = referencedAssetUploads(patch, assetUploads?.uploads ?? []);
      const saved = await ctx.api.patchEditedEntity(kind, piece.id, expected, patch, used.map((upload) => upload.ref), intent);
      assetUploads?.accept(used.map((upload) => upload.ref));
      return saved;
    },
    commit: (submitted, atRev, savedRevision) => { revisionRef.current = savedRevision; commit(submitted, atRev); },
    commitPartial: (saved, atRev, savedRevision) => { revisionRef.current = savedRevision; commit(bodyOf(saved), atRev); },
    takeTheirs: (fresh, freshRevision) => {
      revisionRef.current = freshRevision;
      const next = bodyOf(fresh);
      reseed(next);
      pruneUploads(next);
    },
    isConflict: (error) => apiStatusIs(error, 409),
    onSave: (submitted, mode) => { pruneUploads(submitted); ctx.setStatus(`${mode === "keepMine" ? "overwrote" : "saved"} ${kind} · ${submitted.name}`); },
    onError: (error, mode) => ctx.setStatus(toErrorMessage(error, mode === "takeTheirs" ? `could not reload the ${kind}` : `could not save the ${kind}`)),
  });
  const { saving, conflict, save: saveWith, keepMine, takeTheirs, invalidate } = saveState;
  useReseedOnReread(revision, dirty, () => { invalidate(); revisionRef.current = revision; reseed(bodyOf(entity)); });

  const problem = useMemo(() => pieceProblem(kind, body) ?? check?.(body) ?? null, [kind, body, check]);
  const doSave = useCallback(async (intent: "manual" | "autosave" = "manual"): Promise<boolean> => {
    if (!dirty) return true;
    if (problem) { ctx.setStatus(problem); return false; }
    return saveWith(intent);
  }, [dirty, problem, ctx, saveWith]);
  // Savable only when the decoder accepts the draft, so autosave never retries a save that cannot succeed and reports it as a disk conflict.
  useEditorGuards(ctx, piece, dirty, doSave, problem === null, saveState.autosave);

  return { body, edit, dirty, saving, conflict, problem, save: () => doSave(), keepMine, takeTheirs };
}
