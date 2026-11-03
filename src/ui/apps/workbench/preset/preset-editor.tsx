/**
 * PresetEditorView transcribes design/vs-preset-hybrid.html: EditorEhead (spine + WriteForStrip + Save) over the
 * block manuscript. The settings card, the row expansion, the toolbar and the right rail land in
 * the following P4 slices; this one makes a real, editable preset where the P1 stub was.
 */
import { Tabs } from "../../../components/button";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import type { AppContext, StudioEntitySummary } from "../../../app-contract";
import { useAccentVars } from "../../../_shared/use-scoped-accents";
import { applyPiecePatch, buildPiecePatch, buildTouchedPatch, OccurrenceIndex, useEditorHistoryKeys, useEditorRevision, useEditorSave } from "../../../_shared/editor-state";
import { partNames } from "../../../../entities/piece-parts";
import type { EditorTouch } from "../../../_shared/editor-state";
import { toErrorMessage } from "../../../_shared/error-message";
import { CANONICAL_SCHEMA_VERSION } from "../../../../core/canonical";
import type { PresetBody, PresetPrompt } from "../../../../entities/preset";
import {
  parseWriteFor,
  placementsForProfile,
  platformOwnsField,
  presetWeight,
  promptCounts,
  visiblePrompts,
  PRESET_WRITE_FOR_LABELS,
  PRESET_WRITE_FOR_PROFILES,
  type PresetWriteForProfile,
  type PromptFilterTab,
} from "../../../../core/preset";
import { EditorEhead } from "../../../components/editor-ehead";
import { WriteForStrip } from "../../../components/write-for-strip";
import { BlockList } from "./block-list";
import { ListToolbar } from "./list-toolbar";
import { BulkBar } from "./bulk-bar";
import { SettingsBar } from "./settings-bar";
import { PromptEditPanel } from "./prompt-edit-panel";
import { LiveBuild } from "./live-build";
import { LivePreview } from "./live-preview";
import { SplitPane } from "../../../components/split-pane";
import { Panel } from "../../../components/panel";
import { useReseedOnReread } from "../use-reseed";
import { EditorConflict } from "../editor-conflict";
import { apiStatusIs } from "../../../_shared/api-fetch";
import { historyContainsAssetRef, referencedAssetUploads, useAssetUploads } from "../../../_shared/asset-upload";
import { AUTOSAVE_TRIES, autosaveStoppedNote } from "../autosave-core";
import {
  addBlock,
  addGroup,
  addMarker,
  placedMarkerSlots,
  bulkDelete,
  bulkDuplicate,
  bulkSetEnabled,
  deleteBlock,
  reorderBlock,
  patchBlock,
  setBlockGroup,
  setSampler,
  toggleBlock,
} from "./session";
import s from "./preset.module.css";
import { framed as f, revealAndFocus, useFramed, useRail, useRailLast } from "../framed";
import { EditorLayout } from "../layout/editor-layout";
import { useEditorGuards } from "../use-editor-guards";
import { recOr } from "../../../../core/guards";
import { bodyFieldTouch, bodyFromEntity, editablePreset, flip, groupAncestors, promptTouch } from "./preset-core";
import type { ParsedCanonicalEntity } from "../../../../entities/runtime-schema";

export interface PresetEditorViewProps {
  entity: unknown;
  revision: string;
  ctx: AppContext;
  piece: StudioEntitySummary;
  topRight?: ReactNode;
}

const WRITE_FOR_PREF = "preset.writeFor";
/** Where the divider between the prompt list and the rail sits, remembered per studio. */
const PREF_SPLIT = "preset.split";

/** The rail is the ONE place whole-preset truth lives (the locked wire's ruling), hence the tabs. */
type RailTab = "edit" | "build" | "preview";
const RAIL_TABS: ReadonlyArray<{ id: RailTab; label: string }> = [
  { id: "edit", label: "Edit Prompt" },
  { id: "build", label: "Live Build" },
  { id: "preview", label: "Preview" },
];


export function PresetEditorView({ entity, revision, ctx, piece, topRight }: PresetEditorViewProps): JSX.Element {
  const accentVars = useAccentVars();
  const framed = useFramed();
  // a theme frame opens on the prompts: the list is the main work, Settings is one tab away
  const [section, setSection] = useState("prompts");
  const revisionRef = useRef(revision);
  const initBody = useMemo(() => bodyFromEntity(entity), [entity]);
  const historyConfig = useMemo(() => ({ kind: "preset" as const, id: piece.id }), [piece.id]);
  const { body, baseline, dirty, edit: editRawBody, reseed, capturePatchState, commit, canUndo, canRedo, historyHas, undo: undoBody, redo: redoBody }
    = useEditorRevision(initBody, historyConfig);
  const { uploads, stageAsset, accept, discard, pin, unpin, discardUnused } = useAssetUploads(
    ctx.api.uploadAsset,
    ctx.api.discardAssetUploads,
    (error) => ctx.setStatus(toErrorMessage(error, "could not stage prompt attachment")),
  );
  const uploadState = useRef({ uploads, unpin, discardUnused, historyHas });
  uploadState.current = { uploads, unpin, discardUnused, historyHas };
  const pruneUploads = useCallback((draft: unknown): void => {
    const current = uploadState.current;
    const refs = current.uploads.map((upload) => upload.ref);
    current.unpin(refs);
    void current.discardUnused(refs, draft, (upload) => current.historyHas((change) => historyContainsAssetRef(change, upload.asset)));
  }, []);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const promptIndex = useRef(new OccurrenceIndex<PresetPrompt>());
  const promptIndexReady = useRef(false);
  if (!promptIndexReady.current) {
    promptIndex.current.rebuild(initBody.prompts, (prompt) => prompt.id);
    promptIndexReady.current = true;
  }
  const editPreset = useCallback((update: (current: PresetBody) => PresetBody, touch?: EditorTouch<PresetBody>): void => {
    const current = bodyRef.current;
    const next = update(current);
    editRawBody(() => next, touch);
    bodyRef.current = next;
    if (!touch && next !== current) promptIndex.current.rebuild(next.prompts, (prompt) => prompt.id);
    pruneUploads(next);
  }, [editRawBody, pruneUploads]);
  const reseedPreset = useCallback((fresh: PresetBody): void => {
    reseed(fresh);
    bodyRef.current = fresh;
    promptIndex.current.rebuild(fresh.prompts, (prompt) => prompt.id);
  }, [reseed]);
  const restorePreset = useCallback((restore: () => PresetBody | undefined): void => {
    const fresh = restore();
    if (fresh) {
      bodyRef.current = fresh;
      promptIndex.current.rebuild(fresh.prompts, (prompt) => prompt.id);
      pruneUploads(fresh);
    }
  }, [pruneUploads]);
  const undo = useCallback(() => restorePreset(undoBody), [restorePreset, undoBody]);
  const redo = useCallback(() => restorePreset(redoBody), [restorePreset, redoBody]);
  const [writeFor, setWriteForState] = useState<PresetWriteForProfile>(() =>
    parseWriteFor(ctx.prefs.get(WRITE_FOR_PREF)),
  );
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedChecks, setSelectedChecks] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PromptFilterTab>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [rail, setRail] = useState<RailTab>("edit");
  const railRef = useRef<HTMLElement>(null);
  const railLast = useRailLast();

  /**
   * A re-read reached this editor: take it, unless there are unsaved edits to lose.
   *
   * Without this the reload was invisible - the state initializers above run once, so a fresh
   * entity arrived and the bench went on showing what it mounted with.
   */
  const baseEntity = useMemo(() => {
    const source = recOr(entity);
    return { ...source, schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "preset", id: piece.id, body: baseline } as ParsedCanonicalEntity;
  }, [entity, baseline, piece.id]);
  const saveState = useEditorSave({
    hasChanges: () => dirty,
    capture: () => {
      const patchState = capturePatchState();
      return { draft: body, baseline: baseEntity, revision: patchState.revision, patchState };
    },
    expectedRevision: () => revisionRef.current,
    read: async () => {
      const fresh = await ctx.api.getLightEditableEntity(`kind=preset&id=${encodeURIComponent(piece.id)}`);
      return { entity: editablePreset(fresh.entity, piece.id), revision: fresh.revision };
    },
    buildPatch: (base, submitted, _native, state) => {
      const next = { ...base, body: submitted } as ParsedCanonicalEntity;
      return state && !state.structural ? buildTouchedPatch(next, state.items) : buildPiecePatch(base, next);
    },
    itemNames: partNames,
    applyPatch: applyPiecePatch,
    patch: async (expected, patch, intent) => {
      const used = referencedAssetUploads(patch, uploads);
      const saved = await ctx.api.patchEditedEntity("preset", piece.id, expected, patch, used.map((upload) => upload.ref), intent);
      accept(used.map((upload) => upload.ref));
      return saved;
    },
    commit: (submitted, atRev, savedRevision) => {
      revisionRef.current = savedRevision;
      commit(submitted, atRev);
    },
    commitPartial: (saved, atRev, savedRevision) => {
      revisionRef.current = savedRevision;
      commit(bodyFromEntity(saved), atRev);
    },
    takeTheirs: (fresh, nextRevision) => {
      revisionRef.current = nextRevision;
      reseedPreset(bodyFromEntity(fresh));
      pruneUploads(bodyFromEntity(fresh));
    },
    isConflict: (error) => apiStatusIs(error, 409),
    onSave: (submitted, mode) => {
      pruneUploads(submitted);
      ctx.setStatus(`${mode === "keepMine" ? "overwrote" : "saved"} preset · ${submitted.name}`);
    },
    onError: (error) => ctx.setStatus(toErrorMessage(error, "could not save the preset")),
  });
  const { saving, conflict, save, keepMine, takeTheirs, invalidate } = saveState;

  useReseedOnReread(revision, dirty, () => {
    invalidate();
    reseedPreset(bodyFromEntity(entity));
    revisionRef.current = revision;
  });
  const weight = useMemo(() => presetWeight(body), [body]);
  const stops = useMemo(() => placementsForProfile(writeFor), [writeFor]);
  const selectedBlock = body.prompts.find((p) => p.id === selectedId) ?? null;
  // where the Edit Prompt panel is the last section (long-form, card-stack) it is far from the row you picked: bring it up
  useEffect(() => {
    if (!railLast || selectedId === null) return;
    setRail("edit");
    const frame = requestAnimationFrame(() => revealAndFocus(railRef.current));
    return () => cancelAnimationFrame(frame);
  }, [railLast, selectedId]);
  const revealBlock = useCallback((id: string): void => {
    const ancestors = groupAncestors(body, id);
    setQuery("");
    setTab("all");
    setCollapsedGroups((current) => {
      if (![...ancestors].some((ancestor) => current.has(ancestor))) return current;
      const next = new Set(current);
      for (const ancestor of ancestors) next.delete(ancestor);
      return next;
    });
    setSelectedId(id);
    setRail("edit");
  }, [body]);
  // counts span the WHOLE list so the tab badges hold still while you filter (RC does the same)
  const counts = useMemo(() => promptCounts(body.prompts), [body.prompts]);
  const shown = useMemo(() => visiblePrompts(body.prompts, tab, query), [body.prompts, tab, query]);

  // Every handler BlockList/BlockRow receive is useCallback'd with an empty (or state-setter-only)
  // dependency array and a FUNCTIONAL setState/editBody, never closing over `body` - a row is only
  // as memoizable as its own props are stable (M4: "stable handlers"), and closing over `body` here
  // would hand every row a fresh function identity on every keystroke, defeating BlockRow's memo.
  const toggleExpand = useCallback((id: string): void => setExpandedIds((prev) => flip(prev, id)), []);
  const toggleCheck = useCallback((id: string): void => setSelectedChecks((prev) => flip(prev, id)), []);

  const removeBlock = useCallback((id: string): void => {
    editPreset((b) => deleteBlock(b, id));
    setSelectedId((cur) => (cur === id ? null : cur));
    setSelectedChecks((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [editPreset]);

  const clearChecks = useCallback((): void => setSelectedChecks(new Set()), []);

  // A ref mirror, not a dep: doBulk stays a stable identity while still reading the LATEST checked
  // set (never call another setState from inside a setState updater - React may invoke an updater
  // more than once, and editBody is not idempotent).
  const selectedChecksRef = useRef(selectedChecks);
  selectedChecksRef.current = selectedChecks;

  /** Bulk ops act on the CHECKED set, which can include rows the current filter hides. */
  const doBulk = useCallback((op: (b: PresetBody, ids: ReadonlySet<string>) => PresetBody, clearAfter: boolean): void => {
    const ids = selectedChecksRef.current;
    if (ids.size === 0) return;
    editPreset((b) => op(b, ids));
    if (clearAfter) {
      setSelectedId((cur) => (cur !== null && ids.has(cur) ? null : cur));
      clearChecks();
    }
  }, [editPreset, clearChecks]);

  const setWriteFor = (p: PresetWriteForProfile): void => {
    setWriteForState(p);
    ctx.prefs.set(WRITE_FOR_PREF, p);
  };

  /**
   * The save was refused because the file moved under us. Held here rather than inferred from the
   * status line, because the status line is overwritten by the next thing that happens.
   */
  const doSave = useCallback(async (intent: "manual" | "autosave" = "manual"): Promise<boolean> => {
    if (!body.name.trim()) {
      ctx.setStatus("a name is required before saving");
      return false;
    }
    return save(intent);
  }, [body.name, ctx, save]);

  // savable: a preset with no name cannot be saved at all, so autosave must not try and then report
  // a failure - "this may have changed on disk" is a false alarm when the name field is just empty.
  const autosave = useEditorGuards(ctx, piece, dirty, doSave, body.name.trim().length > 0, saveState.autosave);

  useEditorHistoryKeys(canUndo, canRedo, undo, redo, ctx.setStatus, "preset");

  /**
   * Give up these edits. Clearing dirty is all it takes: the room has been holding the newer read
   * back precisely because this editor was dirty, and it delivers it the moment that stops.
   */
  const monogram = (body.name.trim().charAt(0) || "P").toUpperCase();
  const meta = `${body.samplerSet ? "sampler set" : "preset"} · ${weight.totalCount} block${weight.totalCount === 1 ? "" : "s"} · ${weight.enabledCount} on · ~${weight.tokens} tokens`;

  // Stable, id-taking handlers for BlockList/BlockRow (M4: "editing one block re-renders only that
  // block" needs every prop a row receives, callbacks included, to hold its identity across a
  // keystroke elsewhere - a fresh closure per render defeats React.memo before it gets to compare).
  const onAddBlock = useCallback((): void => editPreset((b) => addBlock(b)), [editPreset]);
  const onAddMarker = useCallback((slot: string): void => editPreset((b) => addMarker(b, slot)), [editPreset]);
  const placedSlots = useMemo(() => placedMarkerSlots(body), [body]);
  const onAddCategory = useCallback((): void => editPreset((b) => addGroup(b)), [editPreset]);
  const onToggleGroupId = useCallback((id: string): void => setCollapsedGroups((prev) => flip(prev, id)), []);
  const onToggleBlock = useCallback((id: string): void => editPreset((b) => toggleBlock(b, id), promptTouch(id, promptIndex.current)), [editPreset]);
  const onPatchBlock = useCallback(
    (id: string, patch: Partial<PresetPrompt>): void => editPreset((b) => patchBlock(b, id, patch), promptTouch(id, promptIndex.current)),
    [editPreset],
  );
  /** Drop target names the block it landed ON, never a filtered-list index - moveBlock addresses
   * the real (unfiltered) list by id, so no `shown`-lookup ever has to ride along in this closure. */
  const onReorderBlock = useCallback(
    (fromId: string, toId: string): void =>
      editPreset((b) => reorderBlock(b, fromId, toId)),
    [editPreset],
  );

  const settingsBar = (
    <SettingsBar
      body={body}
      ctx={ctx}
      showSamplers={platformOwnsField(writeFor, "samplers")}
      onDescription={(v) => editPreset((b) => ({ ...b, description: v }), bodyFieldTouch("description"))}
      onSampler={(key, value) => editPreset((b) => setSampler(b, key, value), {
        key: `sampler:${key}`, read: (b) => b.samplers?.[key],
        write: (b, v) => ({ ...b, samplers: { ...b.samplers, [key]: v as number | string | undefined } }),
      })}
      onBehaviorRefs={(behaviorRefs) => editPreset((b) => ({ ...b, behaviorRefs: behaviorRefs.length ? behaviorRefs : undefined }), bodyFieldTouch("behaviorRefs"))}
      onQuickReplyRefs={(quickReplyRefs) => editPreset((b) => ({ ...b, quickReplyRefs: quickReplyRefs.length ? quickReplyRefs : undefined }), bodyFieldTouch("quickReplyRefs"))}
    />
  );
  const listPane = <div className={s.listCol}>
    <ListToolbar
      counts={counts}
      query={query}
      onQuery={setQuery}
      tab={tab}
      onTab={setTab}
      onExpandAll={() => setExpandedIds(new Set(shown.map((p) => p.id)))}
      onCollapseAll={() => setExpandedIds(new Set())}
      onAdd={onAddBlock}
      onAddCategory={onAddCategory}
      placedSlots={placedSlots}
      onAddMarker={onAddMarker}
    />
    <BulkBar
      count={selectedChecks.size}
      onClear={clearChecks}
      onEnable={() => doBulk((b, ids) => bulkSetEnabled(b, ids, true), false)}
      onDisable={() => doBulk((b, ids) => bulkSetEnabled(b, ids, false), false)}
      onDuplicate={() => doBulk(bulkDuplicate, true)}
      onDelete={() => doBulk(bulkDelete, true)}
    />
    <BlockList
      blocks={shown}
      groups={body.groups}
      collapsedGroups={collapsedGroups}
      onToggleGroup={onToggleGroupId}
      totalBlocks={body.prompts.length}
      tab={tab}
      query={query}
      onClearQuery={() => setQuery("")}
      onShowAll={() => setTab("all")}
      selectedId={selectedId}
      selectedChecks={selectedChecks}
      expandedIds={expandedIds}
      onSelectRow={setSelectedId}
      onToggleCheck={toggleCheck}
      onToggleExpand={toggleExpand}
      onToggle={onToggleBlock}
      onDelete={removeBlock}
      onReorder={onReorderBlock}
      onPatch={onPatchBlock}
      onAdd={onAddBlock}
    />
  </div>;
  /* the rail: per-BLOCK truth (RC's panel) or whole-PRESET truth (the engine's build) */
  const railPane = <aside ref={railRef} className={s.sidebar} aria-label="Preset rail">
    <div className={s.railTabs}>
      <Tabs label="Rail view" items={RAIL_TABS.map((t) => ({ value: t.id, label: t.label }))} value={rail} onChange={setRail} />
    </div>

    {rail === "edit" ? (
      <PromptEditPanel
        ownerKey={piece.id}
        block={selectedBlock}
        stops={stops}
        writeFor={writeFor}
        groups={body.groups ?? []}
        onSetGroup={(groupId) => {
          if (selectedId) editPreset((b) => setBlockGroup(b, selectedId, groupId), promptTouch(selectedId, promptIndex.current));
        }}
        onClose={() => setSelectedId(null)}
        uploads={uploads}
        stageAsset={stageAsset}
        pinUploads={pin}
        discardUploads={discard}
        onAddAttachment={(attachment, receipt) => {
          if (!selectedId) return false;
          const current = bodyRef.current.prompts.find((prompt) => prompt.id === selectedId);
          if (!current || current.attachments?.some((item) => item.ref === attachment.ref)) return false;
          editPreset((b) => patchBlock(b, selectedId, { attachments: [...(b.prompts.find((prompt) => prompt.id === selectedId)?.attachments ?? []), attachment] }), promptTouch(selectedId, promptIndex.current));
          return true;
        }}
        onRemoveAttachment={(ref, occurrence) => {
          if (!selectedId) return;
          editPreset((b) => {
            const current = b.prompts.find((prompt) => prompt.id === selectedId);
            return current ? patchBlock(b, selectedId, { attachments: current.attachments?.filter((attachment, index) => index !== occurrence || attachment.ref !== ref) }) : b;
          }, promptTouch(selectedId, promptIndex.current));
        }}
        onPatch={(patch) => {
          if (selectedId) editPreset((b) => patchBlock(b, selectedId, patch), promptTouch(selectedId, promptIndex.current));
        }}
      />
    ) : rail === "build" ? (
      <LiveBuild
        body={body}
        onSelect={revealBlock}
      />
    ) : (
      <LivePreview
        body={body}
        onPatchContent={(id, content) => editPreset((b) => patchBlock(b, id, { content }), promptTouch(id, promptIndex.current))}
        onSelect={revealBlock}
      />
    )}
  </aside>;

  const tools = useRail(<div className={f.bounded}>{railPane}</div>, "Prompt tools");
  return (
    <div className={s.root} style={accentVars(piece.accent) as CSSProperties | undefined}>
      <EditorEhead
        mark={monogram}
        kind="Preset"
        deck="preset"
        name={body.name}
        onNameChange={(v) => editPreset((b) => ({ ...b, name: v }), bodyFieldTouch("name"))}
        namePlaceholder="Untitled preset"
        nameAriaLabel="Preset name"
        meta={meta}
        dirty={dirty}
        saving={saving}
        onSave={() => void doSave()}
        topRight={topRight}
      >
        <WriteForStrip
          profiles={PRESET_WRITE_FOR_PROFILES}
          labels={PRESET_WRITE_FOR_LABELS}
          value={writeFor}
          onChange={setWriteFor}
        />
      </EditorEhead>

      {conflict ? (
        <EditorConflict what="preset" onTakeTheirs={takeTheirs} onKeepMine={() => void keepMine()} />
      ) : autosave.stalled ? (
        <div className={s.autosaveStalled} role="status">
          {autosaveStoppedNote(AUTOSAVE_TRIES)}
        </div>
      ) : null}

      {!framed && settingsBar}

      {framed ? (
        <div className={f.host}>
          <EditorLayout label="Preset sections" railWidth="wide" active={section} onActiveChange={setSection} rail={tools.rail} sections={[
            { id: "settings", title: "Settings", filled: Boolean(body.description?.trim()), node: settingsBar },
            { id: "prompts", title: "Prompts", filled: body.prompts.length > 0, node: <div className={f.bounded}>{listPane}</div> },
            ...tools.tail,
          ]} />
        </div>
      ) : (
        <Panel deck="preset" data-part="preset.workspace" className={s.workspace}>
          <SplitPane
            className={s.splitPaneHost}
            stored={ctx.prefs.get(PREF_SPLIT)}
            onSplit={(next) => { ctx.prefs.set(PREF_SPLIT, next); }}
            label="Resize the prompt list and the rail"
            left={listPane}
            right={railPane}
          />
        </Panel>
      )}
    </div>
  );
}
