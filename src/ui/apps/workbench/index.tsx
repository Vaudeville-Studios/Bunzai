/**
 * The Workbench app - home: the IDE (CONTRACT V2 port of the deleted vanilla index.ts). Pieces sent
 * from the Library open here; the shell's tab strip IS the tab bar, and this room shows the ACTIVE
 * piece's editor pane. Every kind opens its own writable editor (character, pack, lorebook, regex,
 * persona, preset).
 *
 * Draft persistence: one CharacterPane stays mounted (hidden via CSS) per open character, so React
 * state IS the unsaved draft across tab switches - closing the tab unmounts it, which is the discard.
 */
import { Button, Card, Disclosure } from "../../components/button";
import { Panel } from "../../components/panel";
import { RoomHeader } from "../../components/room-header";
import { OverlayWidgets } from "./overlay";
import { AppActivity } from "../../_shared/app-activity";
import { EditorKeyOwner } from "./editor-key-owner";
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { ThemeSlot } from "../../_shared/theme-slot";
import type { CSSProperties, JSX, ReactNode } from "react";
import type { AppContext, StudioEntitySummary, BunzaiApp } from "../../app-contract";
import { deckMeta, pieceColor } from "../../_shared/decks";
import { useAccentVars } from "../../_shared/use-scoped-accents";
import { toErrorMessage } from "../../_shared/error-message";
import { useReopenOnStudioChange } from "../../agent/use-studio-changes";
import { useFocusMode, FocusToggle } from "../../components/focus-toggle";
import { rankRecents } from "./recents-core";
import { editorFor } from "./editors";
import type { KindId } from "../../../generated/kinds";
import { createBlank } from "../../_shared/new-piece";
import { readLoreLight } from "./lore/light-read";
import { keyOf, paneKeyOf } from "../../_shared/piece-key";
import { WORKBENCH_AGENT_SURFACE, usePublishWorkbenchSurface } from "./agent-surface";
import { portraitUrl as storedPortraitUrl } from "../../_shared/asset-url";
import { EDITOR_VARIANTS_STYLE } from "./variants-style";
import styles from "./styles.module.css";
import { useStageLights } from "../../components/light-rays";
import { icSvg } from "../../_shared/ic-svg";
import { NodesView } from "./nodes/NodesView";
import { ViewSwitch } from "./nodes/ViewSwitch";
import { PREF_VIEW, parseView, type View } from "./nodes/canvas-state";
import { HostCommandMenu } from "../../extensions/host-command-menu";

const RECENTS_SHOWN = 14; // how many "bring one up" cards the rail offers at most
const PREF_RAIL_OPEN = "workbench.recentsOpen"; // collapse survives sessions; only explicit false closes

/** the locked bench mark (vs-shell-apps) */
const MARK_SVG = icSvg("lucide:pen-line", 18);

const portraitUrl = (e: StudioEntitySummary): string | null =>
  e.hasPortrait ? storedPortraitUrl(e.kind, e.id) : null;

/** One mounted-per-open editable piece; hidden (not unmounted) while another tab is active. */
function EditablePane({
  ctx,
  piece,
  hidden,
  beside,
  topRight,
}: {
  ctx: AppContext;
  piece: StudioEntitySummary;
  hidden: boolean;
  /** rendered as the second pane of a split: seam on its left, ordered after the active pane */
  beside?: boolean;
  topRight?: ReactNode;
}): JSX.Element {
  const appActive = useContext(AppActivity);
  const [keyRoot, setKeyRoot] = useState<HTMLDivElement | null>(null);
  const [source, setSource] = useState<{ entity: unknown; revision: string; assets: Record<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);

  /** Named so a studio change can run it again; the mount effect just calls it once. */
  const load = useCallback((): (() => void) => {
    let cancelled = false;
    const address = `kind=${encodeURIComponent(piece.kind)}&id=${encodeURIComponent(piece.id)}`;
    const mode = editorFor(piece.kind)?.load ?? "full";
    const loadEntity = mode === "lore"
      ? readLoreLight(ctx, piece.id)
      : mode === "light"
      ? ctx.api.getLightEditableEntity(address)
      : ctx.api.getEditableEntity(address).then((loaded) => ({ ...loaded, assets: {} }));
    void loadEntity
      .then((loaded) => {
        if (!cancelled) setSource(loaded);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        ctx.setStatus(`could not load ${piece.name}`);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece.id, piece.kind]);

  useEffect(() => load(), [load]);

  /**
   * THE FILE CHANGED UNDERNEATH: re-read it, unless this piece has unsaved work.
   *
   * The agent applying a change writes the same file this editor is showing, and without this the
   * bench went on displaying what it read when it opened - which is exactly the "it said it
   * applied it and nothing moved" the rail had. Declining while dirty is the rule Kit's rail
   * settled: a stale view is an annoyance, losing a rearrange is not.
   */
  useReopenOnStudioChange(
    ctx.pieces,
    piece,
    ctx.workbench.dirty()[keyOf(piece.id, piece.kind)] === true,
    () => { load(); },
  );

  const Editor = editorFor(piece.kind)?.Editor;
  const editor =
    source == null ? null
    : Editor ? <Editor entity={source.entity} revision={source.revision} ctx={ctx} piece={piece} topRight={topRight} />
    : (
      // a kind with no editor yet: say so and show its fields, read-only
      <div className={`${styles.room} scrollThin`} data-part="editor.root">
        <p>This {deckMeta(piece.kind).singular.toLowerCase()} has no editor yet.</p>
        <pre>{JSON.stringify((source.entity as { body?: unknown } | null)?.body ?? {}, null, 2)}</pre>
      </div>
    );

  return (
    <div
      ref={setKeyRoot}
      className={
        hidden ? styles.paneWrapHidden : beside ? `${styles.paneWrap} ${styles.paneWrapBeside}` : styles.paneWrap
      }
      style={beside ? { order: 1 } : undefined}
    >
      <div className={styles.paneFlush} data-editor="frame">
        <AppActivity.Provider value={appActive && !hidden}><EditorKeyOwner.Provider value={{ root: keyRoot, primary: !beside }}>{editor ?? (
          <div className={styles.soon}>
            {failed ? `could not load ${piece.name}` : "loading the piece…"}
          </div>
        )}</EditorKeyOwner.Provider></AppActivity.Provider>
      </div>
    </div>
  );
}

function RecentCard({ ctx, entity }: { ctx: AppContext; entity: StudioEntitySummary }): JSX.Element {
  const accentVars = useAccentVars();
  const menuRef = ctx.menus.useContextMenu(() => ({ type: "entity", label: entity.name, data: entity }));
  const url = portraitUrl(entity);
  return (
    <Card
      ref={menuRef}
      kind="art"
      vars={{ ...accentVars(pieceColor(entity)), "--card-aspect": "2 / 3" } as Record<`--${string}`, string>}
      title={`Bring ${entity.name} up`}
      onClick={() => ctx.workbench.send(entity)}
      art={
        <div className={styles.rcov} style={url ? { backgroundImage: `url("${url}")` } : undefined}>
          {!url && <b>{entity.name.charAt(0).toUpperCase()}</b>}
        </div>
      }
      heading={entity.name}
    />
  );
}

/** The low deck of recently imported/opened pieces - the "wanna bring this one up?" offer. Renders
 * nothing when no entity qualifies (empty studio, or everything recent is already an open tab). */
function RecentsRail({ ctx, entities, foldOnEdit = true }: { ctx: AppContext; entities: readonly StudioEntitySummary[]; foldOnEdit?: boolean }): JSX.Element | null {
  const [open, setOpen] = useState<boolean>(() => ctx.prefs.get(PREF_RAIL_OPEN) !== false); // default open

  // editing takes the room: whenever the ACTIVE piece changes, the rail folds itself away
  // (the show button still reopens it; the next piece folds it again)
  const active = ctx.workbench.active();
  const activeKey = active ? keyOf(active.id, active.kind) : "";
  useEffect(() => {
    if (activeKey && foldOnEdit) setOpen(false);
  }, [activeKey, foldOnEdit]);

  const openKeys = new Set(ctx.workbench.pieces().map((p) => keyOf(p.id, p.kind)));
  const recent = rankRecents(entities, ctx.workbench.recents(), openKeys, RECENTS_SHOWN);
  if (recent.length === 0) return null;

  const toggleOpen = (): void => {
    const next = !open;
    setOpen(next);
    ctx.prefs.set(PREF_RAIL_OPEN, next);
  };

  return (
    <div className={styles.recents}>
      <Disclosure
        variant="line"
        open={open}
        onClick={toggleOpen}
        leading={<span className={styles.pip} />}
        label="Recent · bring one up"
        summary={open ? "hide" : "show"}
      />
      {open && (
        <div className={styles.strip}>
          {recent.map(/* bounded-ok: fixed category set, per-item detail, capped or short by construction */ (e) => (
            <RecentCard key={keyOf(e.id, e.kind)} ctx={ctx} entity={e} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The empty bench's backlight: soft accent-colored lights roaming the wall behind the card, following the Stage lights choice
 * (Moving roams, Still holds them in place, Off draws none). */
function WallLights(): JSX.Element {
  const mode = useStageLights();
  return <div className={styles.lights} data-lights={mode} aria-hidden="true" />;
}

/** Subscribes to the shell's workbench-change signal (open pieces / active tab) and forces a
 * re-render so `ctx.workbench.pieces()/.active()` (plain getters, not reactive on their own) stay
 * live in this component. */
function useWorkbenchTick(ctx: AppContext): void {
  const [, setTick] = useState(0);
  useEffect(() => ctx.workbench.onChange(() => setTick((t) => t + 1)), [ctx]);
}

function WorkbenchRoom({ ctx }: { ctx: AppContext }): JSX.Element {
  const accentVars = useAccentVars();
  useWorkbenchTick(ctx);
  const entities = useSyncExternalStore(ctx.pieces.subscribeList.bind(ctx.pieces), ctx.pieces.listSnapshot.bind(ctx.pieces), () => []);
  const { focused, toggle } = useFocusMode();
  const [view, setViewState] = useState<View>(() => parseView(ctx.prefs.get(PREF_VIEW)));
  const setView = (next: View): void => {
    setViewState(next);
    ctx.prefs.set(PREF_VIEW, next);
  };
  const nodesOn = view === "nodes";

  const pieces = ctx.workbench.pieces();
  const active = ctx.workbench.active();
  const beside = ctx.workbench.beside();
  // True until the shell's boot confirms a saved bench's contents (or there was nothing to restore),
  // or that read has permanently failed (use-boot.ts). Gates the empty-room message and CTAs below so
  // a bench still being restored is never shown as a plain "the workbench is clear".
  const restoring = ctx.workbench.restoring();
  const restoreFailure = ctx.workbench.restoreFailure?.() ?? null;
  // paneKey includes focusEntry so one lorebook can sit beside itself on two entries
  const activeKey = active ? paneKeyOf(active) : "";
  const besideKey = beside ? paneKeyOf(beside) : "";
  // every open piece gets a pane: a kind with no editor (or one this build does not know) opens read-only
  const editablePieces = pieces;
  // the split is real only when the beside piece can actually render an editor here
  const splitOn =
    besideKey !== "" && editablePieces.some((p) => paneKeyOf(p) === besideKey);

  // the agent window's live half: which pieces are open, which one is being edited, which are unsaved
  usePublishWorkbenchSurface(ctx, { pieces, activeKey, besideKey: splitOn ? besideKey : "" });

  useEffect(() => {
    if (active) return; // ONE writer per status line: the editor owns it while a piece is open
    if (restoring) return; // a still-restoring bench is never announced as "clear"
    ctx.setStatus(pieces.length === 0 ? "the workbench is clear" : `${pieces.length} open`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces.length, activeKey, restoring]);

  const focusNode = <FocusToggle focused={focused} onToggle={toggle} />;

  const newPack = async (): Promise<void> => {
    // guarded like EditablePane's save: these two buttons are the empty workbench's only CTAs, and a
    // failed save must say so instead of visibly doing nothing
    let saved: StudioEntitySummary;
    try {
      saved = await createBlank(ctx, "pack");
    } catch (e) {
      ctx.setStatus(`could not create the pack · ${toErrorMessage(e)}`);
      return;
    }
    const summary: StudioEntitySummary = ctx.pieces.snapshot("pack", saved.id)?.summary ?? saved;
    ctx.workbench.send(summary);
    ctx.setStatus(`opened pack folder · ${summary.name}`);
  };

  const newLorebook = async (): Promise<void> => {
    let saved: StudioEntitySummary;
    try {
      saved = await createBlank(ctx, "lorebook");
    } catch (e) {
      ctx.setStatus(`could not create the lorebook · ${toErrorMessage(e)}`);
      return;
    }
    const summary: StudioEntitySummary = ctx.pieces.snapshot("lorebook", saved.id)?.summary ?? saved;
    ctx.workbench.send(summary);
    ctx.setStatus(`opened lorebook · ${summary.name}`);
  };

  return (
    <div className={`${styles.room} scrollThin${focused ? ` ${styles.focused}` : ""}${!active && !nodesOn ? ` ${styles.wall}` : ""}`} data-part="editor.root">
      <style>{EDITOR_VARIANTS_STYLE}</style>
      <div className={styles.stage} style={accentVars(active?.accent) as CSSProperties | undefined}>
        {nodesOn && <NodesView ctx={ctx} pieces={pieces} onView={setView} />}
        {!active && !nodesOn && (
          <>
            <WallLights />
            <Panel as="section" data-part="editor.empty" className={styles.ghostRoom} aria-live="polite" data-empty="editor">
              <RoomHeader
                align="center"
                data-part="editor.empty.header"
                kicker="The Workbench · Edit pieces"
                title={restoreFailure ? "We couldn't restore the workbench" : restoring ? "Restoring your workbench…" : "Your workbench is empty"}
                lede={restoreFailure ? undefined : restoring ? "Your open pieces will appear here when they are ready." : "Open a piece from your Library to start editing. Each piece opens in a tab above."}
              />
              {restoreFailure && <p className={styles.ghostErr}>{restoreFailure}</p>}
              {restoring && !restoreFailure && <div className={styles.skel} aria-hidden="true"><i /><i /><i /></div>}
              <div className={styles.ghostActions}>
                {!restoring && (
                  <>
                    <Button variant="primary" onClick={() => ctx.openApp("library")}>Open Library</Button>
                    <Button onClick={() => void newPack()}>New pack folder</Button>
                    <Button onClick={() => void newLorebook()}>New lorebook</Button>
                  </>
                )}
                <ViewSwitch view={view} onChange={setView} />
                {focusNode}
              </div>
            </Panel>
          </>
        )}
        {/* in Nodes view the row takes no room, but every pane stays mounted so unsaved drafts survive */}
        <div className={splitOn ? `${styles.paneRow} ${styles.paneRowSplit}` : styles.paneRow} style={nodesOn ? { display: "none" } : undefined}>
          {editablePieces.map(/* bounded-ok: tabs, ports, options, chips and per-item detail inside one document */ (p) => {
            const key = paneKeyOf(p);
            return (
              <EditablePane
                key={key}
                ctx={ctx}
                piece={p}
                hidden={nodesOn || (key !== activeKey && !(splitOn && key === besideKey))}
                beside={splitOn && key === besideKey}
                topRight={<><ViewSwitch view={view} onChange={setView} /><ThemeSlot id="editor.header.end" />{focusNode}</>}
              />
            );
          })}
        </div>
      </div>
      <HostCommandMenu
        api={ctx.api.extensions}
        resources={active ? [{ kind: active.kind, id: active.id }] : []}
        onActivate={(packageId, commandId, input, resources) => ctx.api.extensions.activate(packageId, "command", commandId, input, { resources: [...resources] })}
      />
      {/* the rail is an empty-bench amenity: while a piece is open, even its folded label is a
          dead row - it vanishes entirely and returns when the bench clears */}
      {/* Nodes view keeps the rail: it is how more pieces come onto the canvas */}
      {!focused && (!active || nodesOn) && <RecentsRail ctx={ctx} entities={entities} foldOnEdit={!nodesOn} />}
    </div>
  );
}

const app: BunzaiApp = {
  OverlayWidgets,
  manifest: {
    id: "workbench",
    title: "The Workbench",
    markSvg: MARK_SVG,
    accent: "var(--stage-warn)", // hardcode-ok: app identity color, not theme chrome
    order: 10,
    subtitle: "Edit pieces",
    editsPieces: true, // the shell's tab strip focuses into this room
    agentSurface: WORKBENCH_AGENT_SURFACE,
  },
  Component: ({ ctx }) => <WorkbenchRoom ctx={ctx} />,
};

export default app;
