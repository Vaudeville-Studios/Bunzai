/** Library room: shelves, collection filters, import receipts and batch Send to the Workbench. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OverlayWidgets } from "./overlay";
import { ThemeSlot } from "../../_shared/theme-slot";
import type { CSSProperties, DragEvent, JSX } from "react";
import type { AppContext, StudioDamagedEntry, StudioEntitySummary, BunzaiApp } from "../../app-contract";
import { useSurfaceVariant } from "../../_shared/surface-variant";
import { deckHead, deckOf, knownDecks } from "../../_shared/decks";
import { toErrorMessage } from "../../_shared/error-message";
import { deckCounts } from "./deck-core";
import { ImportOverlay, makeImportRunners, pickFiles, type ImportState } from "./import-flow";
import { handOffPiece, HTML_VIEW_APP } from "../../agent/html-handoff";
import { routeSend, sendStatus } from "./send-pieces";
import {
  LoreWorkshopDialog,
  type LoreWorkshopState,
} from "./lore-workshop-dialog";
import {
  makeLoreShelf,
  type LoreMeta,
} from "./lore-shelf-ops";
import {
  makeRegexShelf,
  type RegexMeta,
  type RegexWorkshopState,
} from "./regex-shelf-ops";
import { RegexWorkshopDialog } from "./regex-workshop-dialog";
import { createBlank } from "../../_shared/new-piece";
import { useEntityDelete } from "./delete-flow";
import { consumeImportRequests } from "../../_shared/import-signal";
import { peekPiece, sourceLabelFor } from "./piece-peek";
import { makePersonaShelf, type PersonaMeta } from "./persona-shelf-ops";
import { LIBRARY_STYLE, MARK_SVG, PREF_FIRST_DECK, PREF_SIZE } from "./styles";
import { PREF_LAYOUT, PREF_ORDER, PREF_VIEWS, RC_STYLE } from "./rc-styles";
import { clampSize, pieceKey, type DeckViewContext } from "./view-contract";
import { deckViews } from "./views/registry";
import { DamageNotice } from "./damage-notice";
import { FirstLanding, StudioUnreachable } from "./first-landing";
import { LIBRARY_AGENT_SURFACE, usePublishLibrarySurface } from "./agent-surface";
import { useLibraryPieceUpdates } from "./use-library-piece-updates";
import { matchesByKind, parseQuery, resultLine, unknownHint } from "./search-core";
import { NoMatchNotice, SearchBox } from "./search-bar";
import { useDebouncedQuery } from "./search-debounce";
import { SendBar } from "./send-bar";
import { useCollections } from "./collections-ops";
import { usePicking } from "./use-picking";
import { CollectionsBar } from "./collections-bar";
import { portraitUrl as storedPortraitUrl } from "../../_shared/asset-url";
import { carouselSections, drawnPieces, isShelfLayout, isShelfOrder, orderPieces, withSectionView, type ShelfLayout, type ShelfOrder } from "./carousel-core";
import { Shelves, SizeDial } from "./shelves";
import { useSearchResults } from "./use-search-results";
import { LibraryRail, OrderSwitch } from "./rail";
import "./variant-styles";
import { TRASH_STYLE, TrashPanel, useTrashCount } from "./trash-panel";
import { handOffScene, libraryTrash, SCENES_APP } from "../../_shared/scene-handoff";
import { useSetMenu } from "./set-menu";
import { useLibraryBookCovers } from "./book-cover-room";
import { Button } from "../../components/button";
import { LibraryExtensionCommandMenu } from "./extension-command-menu";
const portraitUrl = (e: StudioEntitySummary): string | null =>
  e.hasPortrait ? storedPortraitUrl(e.kind, e.id) : null;

function Library({ ctx }: { ctx: AppContext }): JSX.Element {
  const firstDeck = ctx.prefs.get(PREF_FIRST_DECK);
  const [entities, setEntities] = useState<StudioEntitySummary[]>([]);
  const [damaged, setDamaged] = useState<StudioDamagedEntry[]>([]);
  const [studioDir, setStudioDir] = useState<string>();
  /** an unreachable studio is NOT an empty one; without this the two render identically */
  const [loadFailed, setLoadFailed] = useState(false);
  /** True only once the first reload answers - before that `entities` still reads as its initial
   * zero, indistinguishable from a genuinely empty studio without this. */
  const [loaded, setLoaded] = useState(false);
  const [appearance, setAppearance] = useState(() => ctx.appearance.get());
  const gridVariant = useSurfaceVariant("library.grid"); // a theme's shelf shape is only the DEFAULT layout; the person's own choice (library.layout) wins
  /** Read in the same reload cycle as `loaded`, never through useTrashCount: that hook's own fetch
   * fires independently at mount and could still read stale when `loaded` flips true. */
  const [trashEmpty, setTrashEmpty] = useState(false);
  /** the deck picked in the rail, shown alone; null while every deck shows (RC's "all") */
  const [soloDeck, setSoloDeck] = useState<string | null>(null);
  const activeKind = soloDeck ?? "";
  const [formatLabels, setFormatLabels] = useState<Map<string, string>>(new Map());
  const picking = usePicking();
  const selected = picking.selected;
  useEffect(() => ctx.appearance.onChange(() => setAppearance(ctx.appearance.get())), [ctx]);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [query, setQuery] = useState("");
  const [workshop, setWorkshop] = useState<LoreWorkshopState | null>(null);
  const covers = useLibraryBookCovers(ctx);
  const [regexWorkshop, setRegexWorkshop] = useState<RegexWorkshopState | null>(null);
  const [loreMeta, setLoreMeta] = useState<Record<string, LoreMeta>>({});
  const [regexMeta, setRegexMeta] = useState<Record<string, RegexMeta>>({});
  const [personaMeta, setPersonaMeta] = useState<Record<string, PersonaMeta>>({});
  const [, setWorkbenchTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const reloadSequence = useRef(0);
  const [sizeRem, setSizeRem] = useState(() => clampSize(ctx.prefs.get(PREF_SIZE)));
  const collections = useCollections(ctx);
  const [chosenLayout, setLayoutState] = useState<ShelfLayout | null>(() => {
    const stored = ctx.prefs.get(PREF_LAYOUT);
    return isShelfLayout(stored) ? stored : null;
  });
  const layout = chosenLayout ?? (gridVariant === "covers" || gridVariant === "core" ? "carousel" : "grid");
  const [order, setOrderState] = useState<ShelfOrder>(() => {
    const stored = ctx.prefs.get(PREF_ORDER);
    return isShelfOrder(stored) ? stored : "all";
  });
  const setLayout = (next: ShelfLayout): void => {
    setLayoutState(next);
    ctx.prefs.set(PREF_LAYOUT, next);
  };
  const setOrder = (next: ShelfOrder): void => {
    setOrderState(next);
    ctx.prefs.set(PREF_ORDER, next);
  };

  const reload = useCallback((forceInventory = false) => {
    const sequence = ++reloadSequence.current;
    const lifetime = ctx.pieces.captureLifetime();
    // apiFetchJson throws on any non-2xx; a failed read is not an empty studio, so it is caught.
    void (async () => {
      try {
        const [inventory, version, trash] = await Promise.all([
          forceInventory && ctx.pieces.isSeeded()
            ? ctx.pieces.reloadInitial(() => ctx.api.studioInventory(), (value) => value.entities)
            : ctx.pieces.loadInitial(() => ctx.api.studioInventory(), (value) => value.entities),
          ctx.api.version().catch(() => ({ version: "", studioDir: undefined })),
          Promise.all([ctx.api.listTrash().catch(() => []), ctx.api.listSceneTrash().catch(() => [])]),
        ]);
        if (sequence !== reloadSequence.current || !ctx.pieces.isCurrentLifetime(lifetime)) return;
        setEntities([...ctx.pieces.listSnapshot()]);
        setDamaged(inventory.damaged);
        setStudioDir(version.studioDir);
        setLoadFailed(false);
        setTrashEmpty(trash[0].length === 0 && trash[1].length === 0);
      } catch {
        if (sequence === reloadSequence.current && ctx.pieces.isCurrentLifetime(lifetime)) setLoadFailed(true);
      }
    })();
  }, [ctx]);
  const forceReload = useCallback(() => reload(true), [reload]);

  useEffect(() => {
    // Mount only: ctx rebuilds on every shell-store write, so depending on it (or reload, a useCallback over ctx) re-downloaded the studio per status message.
    // the workbench-driven repaint: sending/removing/focusing pieces elsewhere flips the "on the
    // workbench" marks here without this room ever calling render itself (see the sendbar handler)
    const unsub = ctx.workbench.onChange(() => setWorkbenchTick((t) => t + 1));
    // Format labels are decorative; shelves still work when this request fails.
    void ctx.api
      .formats()
      .then((formats) => {
        setFormatLabels(new Map(formats.map((f) => [f.id, f.generic ? "Default" : f.friendly])));
      })
      .catch(() => {
        /* labels stay unset; sourceLabel already falls back */
      });
    reload();
    const invalidate = () => { reloadSequence.current++; };
    return () => { invalidate(); unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const del = useEntityDelete(ctx, () => {
    picking.replace([]);
    reload(true);
  });

  const allCss = useMemo(() => LIBRARY_STYLE + RC_STYLE + TRASH_STYLE + deckViews().map((v) => v.css).join("\n"), []);
  const [trashOn, setTrashOn] = useState(false);
  // The Scenes page's Trash button opens the Library here, on its Trash.
  useEffect(() => {
    const show = (): void => {
      if (!libraryTrash.taken()) return;
      libraryTrash.give(null);
      setTrashOn(true);
    };
    show();
    return libraryTrash.on(show);
  }, []);
  const starting = useRef(false);
  const trashCount = useTrashCount(ctx, entities);
  useLibraryPieceUpdates({ ctx, pieces: ctx.pieces, setEntities, setLore: setLoreMeta, setRegex: setRegexMeta, setPersona: setPersonaMeta, onReady: () => setLoaded(true) });

  const openKeys = new Set(ctx.workbench.pieces().map(pieceKey));
  // drop any staged key that has since gone (opened elsewhere or deleted) so the count never lies
  const selectedValid = new Set([...selected].filter((k) => !openKeys.has(k) && entities.some((e) => pieceKey(e) === k)));

  // No rows (not zero-count rows) until the first load answers.
  const decks = loaded ? deckCounts(entities, knownDecks().map((d) => d.kind)) : [];
  const deck = deckHead(soloDeck ?? "character");

  const debouncedQuery = useDebouncedQuery(query);
  const parsed = useMemo(() => parseQuery(debouncedQuery), [debouncedQuery]);
  const [searchRetry, setSearchRetry] = useState(0);
  const searchResult = useSearchResults(ctx.api.search, debouncedQuery, parsed.active, entities, collections.index, searchRetry);
  const currentSearch = searchResult.current;
  const searchUnavailable = parsed.active && currentSearch && searchResult.unavailable;
  const searchPending = parsed.active && !currentSearch;
  const entityByKey = useMemo(() => new Map(entities.map((entity) => [`${entity.kind}\0${entity.id}`, entity])), [entities]);
  const remoteHits = parsed.active && currentSearch ? searchResult.hits : [];
  const hits = parsed.active && !searchUnavailable && !searchPending
    ? remoteHits.flatMap((hit) => { const piece = entityByKey.get(`${hit.kind}\0${hit.id}`); return piece ? [{ piece, score: hit.score }] : []; })
    : parsed.active ? entities.map((piece) => ({ piece, score: 0 }))
    : entities.map((piece) => ({ piece, score: 0 }));
  const hitTotal = parsed.active && currentSearch && !searchUnavailable ? searchResult.total : 0;
  const perDeck = [...matchesByKind(hits).reduce((m, { kind, count }) => m.set(deckOf(kind), (m.get(deckOf(kind)) ?? 0) + count), new Map<string, number>())].map(([kind, count]) => ({ kind, count }));
  const matched = new Map(perDeck.map((m) => [m.kind, m.count]));
  const lastOpened = ctx.workbench.recents();
  const hitPieces = hits.map((h) => h.piece);
  const inDeck = orderPieces(hitPieces.filter((p) => deckOf(p.kind) === activeKind), order, lastOpened);
  const deckTotal = decks.find((d) => d.kind === activeKind)?.count ?? 0;
  const allSections = carouselSections({
    pieces: hitPieces, counts: decks, order, lastOpened,
    first: typeof firstDeck === "string" && firstDeck ? firstDeck : undefined,
  });
  // One deck picked: its section alone, numbered as the first thing on screen.
  const sections = soloDeck
    ? allSections.filter((sec) => sec.deck.kind === soloDeck).map((sec) => ({ ...sec, numeral: "I" }))
    : allSections;
  /** WHAT IS ON SCREEN, in the order it is drawn: ranges, Select all, and the agent all walk this. */
  const drawn = soloDeck ? inDeck : drawnPieces(sections);
  const elsewhere = hitTotal - inDeck.length;
  const searchLine = searchUnavailable
    ? "Search is unavailable · showing the unfiltered library"
    : searchPending
      ? "Searching the library…"
      : currentSearch && searchResult.truncated
        ? `First ${String(searchResult.available)} of ${String(hitTotal)} results are available · result limit reached`
        : soloDeck
    ? resultLine({ active: parsed.active, deckPlural: deck.plural, shown: inDeck.length, deckTotal, elsewhere })
    : parsed.active
      ? `${searchResult.truncated ? "First " : ""}${String(hits.length)} of ${String(hitTotal || entities.length)} pieces match${searchResult.truncated ? " · result limit reached" : ""}`
      : "";

  /** Stage every drawn piece not open on the Workbench; while a search runs that means every MATCH. */
  const selectAll = (): void => picking.replace(drawn.filter((e) => !openKeys.has(pieceKey(e))).map(pieceKey));

  const stagedRefs = entities.filter((e) => selectedValid.has(pieceKey(e)));

  /** What is DRAWN is what gets published, search text included. The deck name is withheld while
   * every deck shows: naming one shelf over a listing of all of them would read as the rest missing. */
  usePublishLibrarySurface(ctx, {
    deck: soloDeck ? deck.plural : null,
    inDeck: drawn, total: entities.length, damaged, staged: selectedValid, loadFailed,
    filter: parsed.active ? debouncedQuery : undefined,
  });
  const statusWhere = soloDeck ? deck.plural.toLowerCase() : "every deck";
  useEffect(() => {
    ctx.setStatus(
      loadFailed
        ? "could not reach the studio · your pieces are still on disk"
        : !loaded
          ? "opening your library..."
          : entities.length === 0
            ? damaged.length > 0
              ? `no readable pieces · ${damaged.length} unreadable ${damaged.length === 1 ? "file" : "files"}`
              : "empty studio"
            : searchLine || `${statusWhere} · ${drawn.length} of ${entities.length} pieces`,
    );
  }, [ctx, damaged.length, entities.length, statusWhere, drawn.length, loadFailed, loaded, searchLine]);

  const { runImport, commitImport, cancelImport } = makeImportRunners({ ctx, importState, setImportState, reload: forceReload });

  // The shell's Import button + global file drops: picker when empty-handed, else straight in.
  const runImportRef = useRef(runImport);
  runImportRef.current = runImport;
  useEffect(
    () =>
      consumeImportRequests((files) => {
        if (files) runImportRef.current(files);
        else pickFiles((picked) => runImportRef.current(picked));
      }),
    [],
  );

  const onDrop = (evt: DragEvent<HTMLDivElement>): void => {
    evt.preventDefault();
    const files = [...(evt.dataTransfer?.files ?? [])];
    if (files.length) runImport(files);
  };

  /** Shelve a freshly created piece without waiting for a whole studio re-read. */
  const addEntity = (summary: StudioEntitySummary): void =>
    setEntities((prev) =>
      prev.some((e) => e.kind === summary.kind && e.id === summary.id) ? prev : [...prev, summary],
    );

  const overlay = importState ? (
    <ImportOverlay
      state={importState}
      onCommit={commitImport}
      onCancel={cancelImport}
      onAddMore={() => pickFiles((f) => runImport(f, true))}
    />
  ) : null;

  // Built before the early returns below: the set menu is a hook, and hooks never sit behind a return.
  const loreShelf = makeLoreShelf({ ctx, loreMeta, setLoreMeta, setWorkshop, reload: forceReload });
  const regexShelf = makeRegexShelf({ ctx, regexMeta, setRegexMeta, setWorkshop: setRegexWorkshop, reload: forceReload });
  const personaShelf = makePersonaShelf({ ctx, personaMeta, setEntities });
  useSetMenu(ctx, loreShelf, regexShelf, covers.design);

  const doors = { css: allCss, damaged, studioDir };
  if (loadFailed) return <StudioUnreachable {...doors} onRetry={forceReload} />;

  if (loaded && entities.length === 0 && trashEmpty) {
    return (
      <FirstLanding
        {...doors}
        onDrop={onDrop}
        onPickImport={() => pickFiles(runImport)}
        onStartFresh={() => {
          void createBlank(ctx, "character").then(
            (summary) => {
              addEntity(summary);
              ctx.workbench.open(summary);
              ctx.setStatus(`opened character · ${summary.name}`);
            },
            (err) => ctx.setStatus(toErrorMessage(err, "could not create a character")),
          );
        }}
        overlay={overlay}
      />
    );
  }

  /** A rail click, as in RC: show that deck alone, or every deck again when it was already shown. */
  const pickDeck = (kind: string): void => {
    setTrashOn(false);
    setSoloDeck((prev) => (prev === kind ? null : kind));
  };

  const vctx: DeckViewContext = {
    appearanceKey: `${appearance.themeId ?? "core"}:${appearance.digest ?? ""}`,
    bookFrameUrl: (() => { const id = appearance.appearance?.marks.bookFrame; return id ? ctx.appearance.assetUrl(id) : undefined; })(),
    entities: drawn,
    search: ctx.api.search,
    deck,
    open: openKeys,
    selected: selectedValid,
    menus: ctx.menus,
    portraitUrl,
    bookCover: covers.of,
    sourceLabel: (e) => sourceLabelFor(formatLabels, e),
    peek: (e) => peekPiece(ctx, e),
    onPiece: (e, mods) => {
      const key = pieceKey(e);
      if (openKeys.has(key) && !mods?.shift) {
        ctx.setStatus(`${e.name} is already on the Workbench`); // open = annotation, not a toggle
        return;
      }
      // Ranges run over what is DRAWN, so the order is the screen's, after search and ordering.
      picking.press(key, mods ?? { shift: false, meta: false }, drawn.map(pieceKey), openKeys);
    },
    onSweep: (cards, box, additive) => { picking.sweep(cards, box, additive, openKeys); },
    onStartScene: (e) => {
      if (starting.current) return; // one scene per click, however fast the clicks come
      starting.current = true;
      void ctx.api.startScene(e.id).then(
        (chat) => { handOffScene(chat.id); ctx.openApp(SCENES_APP); if (chat.startNotes?.length) ctx.setStatus(chat.startNotes.join(" ")); },
        (err: unknown) => ctx.setStatus(toErrorMessage(err, "could not start the scene")),
      ).finally(() => { starting.current = false; });
    },
  };
  /** A deck's own context: its pieces, and only its own shelf's tools (views deny by absence). */
  const vctxFor = (kind: string, pieces: StudioEntitySummary[]): DeckViewContext => ({
    ...vctx,
    entities: pieces,
    deck: deckHead(kind || "character"),
    loreShelf: kind === "lorebook" ? loreShelf : undefined,
    regexShelf: kind === "regex" ? regexShelf : undefined,
    personaShelf: kind === "persona" ? personaShelf : undefined,
  });
  const views = ctx.prefs.get(PREF_VIEWS);

  return (
    <div
      className="lib rc" data-part="library.root" ref={rootRef}
      style={{ "--card-w": `${sizeRem}rem` } as CSSProperties}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <style>{allCss}</style>
      <div className="lframe">
      <LibraryRail
        layout={layout}
        onLayout={setLayout}
        decks={decks}
        matched={parsed.active ? matched : undefined}
        selected={soloDeck}
        onDeck={pickDeck}
        collections={collections.all}
        query={query}
        setQuery={setQuery}
        onAdd={() => pickFiles(runImport)}
        trash={{ count: trashCount, on: trashOn, onToggle: () => setTrashOn((on) => !on) }}
      />
      <div className="lmain" data-part="library.main">
        {trashOn ? <TrashPanel ctx={ctx} onBack={() => setTrashOn(false)} onRestored={forceReload} /> : <>
        <ThemeSlot id="library.header" />
        <DamageNotice entries={damaged} studioDir={studioDir} prefs={ctx.prefs} />
        <div className="ltop" data-part="library.toolbar">
          <SearchBox value={query} onChange={setQuery} hint={unknownHint(parsed.unknown)} status={searchUnavailable ? "Search unavailable; showing the unfiltered library." : searchPending ? "Searching the library…" : undefined} onRetry={searchUnavailable ? () => setSearchRetry((value) => value + 1) : undefined} />
          <OrderSwitch order={order} onOrder={setOrder} />
          <SizeDial ctx={ctx} sizeRem={sizeRem} setSizeRem={setSizeRem} rootRef={rootRef} prefKey={PREF_SIZE} />
            {drawn.length > 0 && selectedValid.size === 0 && !searchUnavailable && !searchPending && !searchResult.truncated && (
            <Button size="sm" onClick={selectAll} title="Stage everything shown">
              Select all
            </Button>
          )}
        </div>

        <LibraryExtensionCommandMenu ctx={ctx} pieces={stagedRefs} />
        <CollectionsBar room={collections} query={query} setQuery={setQuery} staged={stagedRefs} />

        <SendBar
          staged={selectedValid}
          entities={entities}
          onSend={(batch) => {
            picking.replace([]);
            // Not every kind has a Workbench editor; see send-pieces.ts for the split.
            const routing = routeSend(batch);
            if (routing.toWorkbench.length > 0) ctx.workbench.sendMany(routing.toWorkbench);
            if (routing.toViewer) {
              handOffPiece(routing.toViewer.id);
              ctx.openApp(HTML_VIEW_APP);
            }
            const said = sendStatus(routing);
            if (said) ctx.setStatus(said);
            // sendMany opens the pieces (firing workbench.onChange -> this room repaints with the
            // staged marks gone) and, in "always" mode, navigates to the Workbench; forcing our
            // own render here would clobber that navigation, so we deliberately don't.
          }}
          onDelete={(batch) => del.requestDelete(batch)}
          onSelectAll={selectAll}
          onClear={() => picking.replace([])}
        />

        {loaded ? (
          <Shelves
            ctx={ctx}
            vctxFor={vctxFor}
            sections={sections}
            single={soloDeck}
            singleTotal={deckTotal}
            layout={layout}
            views={views}
            setView={(kind, view) => ctx.prefs.set(PREF_VIEWS, withSectionView(views, kind, view))}
            meta={{ lore: loreMeta, regex: regexMeta, persona: personaMeta }}
            parsed={parsed}
            query={debouncedQuery}
            setQuery={setQuery}
            perDeck={perDeck}
            onJump={(kind) => setSoloDeck(kind)}
            studioTotal={entities.length}
            onCreated={addEntity}
          />
        ) : (
          <p className="voice" style={{ padding: "48px 0" }}>Opening your library...</p>
        )}
        </>}
      </div>
      </div>

      {overlay}
      {covers.dialog}
      {workshop && (
        <LoreWorkshopDialog
          ctx={ctx}
          state={workshop}
          onDismiss={() => setWorkshop(null)}
          onDone={() => {
            setWorkshop(null);
            reload(true);
          }}
        />
      )}
      {regexWorkshop && (
        <RegexWorkshopDialog ctx={ctx} state={regexWorkshop}
          onDismiss={() => setRegexWorkshop(null)} onDone={() => { setRegexWorkshop(null); reload(true); }} />
      )}
      {del.confirm}
    </div>
  );
}

const app: BunzaiApp = {
  OverlayWidgets,
  manifest: {
    id: "library",
    title: "The Library",
    markSvg: MARK_SVG,
    accent: "#3b82f6", // hardcode-ok: this app's own identity color in the shell manifest, not theme chrome
    order: 20,
    subtitle: "Cast & worlds",
    firstRunLanding: true, // JOURNEY 1.1: a fresh studio lands on the two doors
    agentSurface: LIBRARY_AGENT_SURFACE,
  },
  Component: Library,
};
export default app;
