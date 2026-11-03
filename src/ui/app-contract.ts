/**
 * The Bunzai app contract v2 (ADR-008, CONTRACT V2) - the dock's folders-as-schema, React shaped.
 * An APP is a folder in src/ui/apps/<name>/ whose index.tsx default-exports a BunzaiApp. The server
 * discovers and bundles them; the client builds the dock from the manifest and renders the app's
 * Component into the Workbench canvas. Drop a folder in, the dock gains a tile - nothing central
 * lists apps, exactly like format adapters. This file is shared by server (discovery) and client
 * (mounting), so it imports react and the menu types only as `import type` - erased at build time,
 * no runtime framework dependency leaks into discovery.
 */
export type { BunzaiApp, OverlayWidgetProps } from "./app-contract-app";
import type { ContextMenus } from "./shell/store";
import type { ParseReport, SerializeReport } from "../core/reports";
import type { LvbakImportReport } from "../formats/lumiverse-archive/report";
import type { AuxHelperStatus, LanStatus, RemoteDevice, RemoteState } from "./remote/sidecar-status";
import type { StudioDamageReason } from "../studio/errors";
import type { PieceFacts } from "../studio/store-listing";
import type { GraveSummary, PiecePatch } from "../stage/contracts/content-store";
import type { ScenesApi } from "./app-contract-scenes";
import type { CompendiumApi } from "./app-contract-compendium";
import type { CompendiumAiApi } from "./app-contract-compendium-ai";
import type { ParticipantsApi } from "./app-contract-participants";
// The same shapes the store and the Kit tool use; a second declaration here would be a second
// authority over what a collection is, which is how the damage-reason union broke.
import type { CollectionEdit, CollectionsFile } from "../studio/collections-shape";
import type { AgentState, AgentSurfaceSpec } from "./agent/surface";
import type { EditableEntity, EditedEntitySave, LightEditableEntity, StagedAssetUpload } from "./app-contract-editor";
import type { ImportCompletionApi } from "./app-contract-import";
import type { SearchApi } from "./app-contract-search";
import type { SpotifyApi } from "./app-contract-spotify";
import type { TableReadApi } from "./app-contract-table-read";
import type { PieceStore } from "./_shared/piece-store";
import type { MacroEngineInfo, MacroResolveAsk, MacroResolveResult } from "./app-contract-macro";
import type { EffectiveThemeAppearance, ImageMedia } from "../extensions/theme-contract";
import type { ExtensionManagerApi } from "../extensions/runtime/service";
export type { MacroEngineInfo, MacroResolveAsk, MacroResolveResult } from "./app-contract-macro";
export type { EditableEntity, EditedEntitySave, LightEditableEntity, StagedAssetUpload } from "./app-contract-editor";

/** What the dock needs to draw a tile before the app's code is even loaded. */
export interface AppManifestEntry {
  /** folder name = app id (open string; drop-ins claim any id) */
  id: string;
  /** tile label ("The Library") */
  title: string;
  /** flat-ink SVG markup for the tile mark (family grammar: no gradients, no glow) */
  markSvg: string;
  /** the app's own accent (hex); NEVER brand rose - that stays on CTAs */
  accent: string;
  /** dock ordering (lower = earlier) */
  order: number;
  /** the tile's mono second line ("app · home", "app · convert"); futures say "installs later" */
  subtitle?: string;
  /** utility group at the end of the bottom dock (Settings) */
  dockFoot?: boolean;
  /** unavailable app: excluded from navigation until mountable */
  comingSoon?: boolean;
  /** legacy catalog placement hint; available apps also appear in the bottom dock */
  catalogOnly?: boolean;
  /** identifies the packaged-app catalog surface */
  appCatalog?: boolean;
  /** this app is the surface a brand-new studio lands on right after setup (JOURNEY 1.1) */
  firstRunLanding?: boolean;
  /** this app is where open pieces are edited: the shell's tab strip focuses into it */
  editsPieces?: boolean;
  /**
   * What the agent standing on this screen is told about it.
   *
   * THE STATIC HALF ONLY. A manifest is discovered by reading folders and handed to the client as
   * data, so it can carry what this app IS and what is WORTH DOING here - never what is on screen
   * right now. The running app publishes that through `ctx.agent.publish`; see src/ui/agent/surface.ts,
   * which puts the two together.
   *
   * Naming actions here does not grant the agent anything: it reaches the whole studio through Kit's
   * tools and every write meets the Gate regardless of which screen asked. This is a menu, not a lock.
   */
  agentSurface?: AgentSurfaceSpec;
}

/** Everything an app may touch. Apps NEVER import the engine or reach the filesystem directly:
 * the shell hands them this context, and all IO goes through the local API - one engine, thin
 * shells. Theme lives in the shell store now (apps read it via useShellStore if they need it);
 * there is no `root` - a BunzaiApp renders JSX, the shell owns the DOM. */
export interface AppContext {
  /** authenticated-local API base (loopback server) */
  api: ScenesApi & CompendiumApi & CompendiumAiApi & ParticipantsApi & ImportCompletionApi & SearchApi & SpotifyApi & TableReadApi & { extensions: ExtensionManagerApi } & {
    /** Read one package-declared inert theme image only through its digest- and scope-bound host route. */
    readExtensionThemeAsset(packageId: string, assetId: string, themeDigest: string, assetDigest: string, mediaType: ImageMedia, signal?: AbortSignal): Promise<Uint8Array>;
    listEntities(kind?: string): Promise<StudioEntitySummary[]>;
    getEntitySummary(kind: string, id: string): Promise<StudioEntitySummary | null>;
    studioInventory(kind?: string): Promise<{
      entities: StudioEntitySummary[];
      damaged: StudioDamagedEntry[];
    }>;
    /** Read one canonical piece with an encoded kind/id query, not a bare piece id. */
    getEntity(query: string): Promise<unknown>;
    /** Load an editor baseline with the revision required for an atomic re-save. */
    getEditableEntity(id: string): Promise<EditableEntity>;
    /** Load the explicit light wire shape: escrow omitted; media may be blob sentinels. */
    getLightEditableEntity(id: string): Promise<LightEditableEntity>;
    /** Load one escrow entry by its format id without opening unrelated escrow. */
    getEditableOriginalEntry(kind: string, id: string, format: string): Promise<unknown | null>;
    getEditableOriginalEntryVersioned(kind: string, id: string, format: string): Promise<import("../stage/contracts/content-store-light").StoredOriginalEntry | null>;
    /** List Risu NamedAssets from native escrow without opening their blob payloads. */
    getRisuNamedAssets(kind: string, id: string): Promise<import("../stage/contracts/content-store-light").StoredRisuNamedAssets | null>;
    /** Persist a create/import. Omit overwrite for keep-both; administrative flows may replace. */
    saveEntity(entity: unknown, opts?: { overwrite?: boolean }): Promise<StudioEntitySummary>;
    /** Replace an editor baseline only when no other writer changed it first. */
    saveEditedEntity(entity: unknown, expectedRevision: string): Promise<EditedEntitySave>;
    /** Persist a piece patch against its opened revision. */
    patchEditedEntity(kind: string, id: string, expectedRevision: string, patch: PiecePatch, uploads?: string[], intent?: "manual" | "autosave"): Promise<EditedEntitySave>;
    /** Stream a validated NamedAsset to session-bound encrypted staging. */
    uploadAsset(file: File, signal?: AbortSignal): Promise<StagedAssetUpload>;
    /** Fetches a picture or video link once, on the person's click, and stages it like an upload (server-asset-fetch.ts); the studio refuses unsafe links. */
    uploadAssetFromUrl(url: string, signal?: AbortSignal): Promise<StagedAssetUpload>;
    /** Turns pictures the library already holds (uploaded refs) into staged grants without moving their bytes (/api/asset/adopt). */
    adoptAssets(refs: readonly string[]): Promise<StagedAssetUpload[]>;
    discardAssetUploads(refs: readonly string[]): Promise<void>;
    /** Remove one entity from the studio. True when a file was actually removed. */
    deleteEntity(kind: string, id: string): Promise<{ deleted: boolean; receipt?: Omit<import("../stage/contracts/content-store").PieceChangeEvent, "sequence"> | null }>;
    /** The library's Trash, newest first: deleted pieces kept for 3 days. */
    listTrash(): Promise<GraveSummary[]>;
    /** Brings a piece back from the Trash under its own id, with its history. */
    restoreFromTrash(graveId: string): Promise<StudioEntitySummary>;
    /** Persist a primary entity plus the pieces extracted with it (a character's lorebooks, a preset's regex sets);
     * keep-both renames rewrite the primary's links to them. */
    saveBundle(payload: {
      entity: unknown;
      related?: unknown[];
      overwrite?: boolean;
    }): Promise<SaveBundleResult>;
    inspectFile(file: File, signal?: AbortSignal): Promise<InspectResult>;
    /** POST /api/inspect-archive: a `.lvbak` streamed straight from disk, never buffered whole in
     * browser memory first (unlike inspectFile's arrayBuffer() - a real backup can be gigabytes). */
    inspectArchive(file: File, signal?: AbortSignal): Promise<InspectArchiveResult>;
    /** POST /api/studio/save-staged: commit one archive or large inspect row by its staging ref;
     * the entity itself never round-trips through the browser. `refIds` carries the commit loop's
     * minted-id-to-shelf-id map so the server can rewrite knowledgeRefs before saving. */
    saveStaged(payload: SaveStagedPayload): Promise<SaveBundleResult>;
    /** Revoke staged rows owned by this page session after import cancellation or dismissal. */
    cancelStaged(rows: readonly { token: string; key: string }[]): Promise<{ removed: number }>;
    /** `extension` picks the container when a format writes more than one (e.g. sillytavern json/png). */
    exportEntity(entity: unknown, targetId: string, extension?: string): Promise<ExportResult>;
    saveExportFolder(label: string, files: Readonly<Record<string, Blob>>): Promise<{ dir: string; files: string[] }>; // into a new <studio>/Export/<stamp> <label>/ on the host; 403/501 where there is none
    /** A stored Sprite pack as a ZIP of its pictures, read from the library one picture at a time (never opened whole). The answer is the streaming Response: drain it with `drainToBlob`, never `arrayBuffer()`. */
    exportStoredPack(id: string): Promise<Response>;
    /** A keep-both copy made on the server by reference (a big pack never crosses the wire). */
    duplicateEntity(kind: string, id: string): Promise<StudioEntitySummary>;
    formats(): Promise<FormatInfo[]>;
    /**
     * The Macro Lab's two engine calls (host-only; see server-macro-lab.ts).
     *
     * `macroEngines` is a question about THIS MACHINE, not about what Bunzai models: the macro
     * catalogs describe five dialects and only the engines listed here can actually run one. A
     * surface that lets someone pick a lens with no runtime behind it and then press Resolve is
     * promising an answer nobody can give.
     */
    macroEngines(): Promise<{ engines: MacroEngineInfo[] }>;
    /** Resolve one scrap of text through a real engine. Button-press only; one at a time per engine. */
    macroResolve(ask: MacroResolveAsk): Promise<MacroResolveResult>;
    /**
     * The person's own groupings of pieces, and the five edits that change them.
     *
     * Every edit returns the WHOLE file as the server stored it, rather than an acknowledgement.
     * The server serialises edits and normalises what it writes, so its copy is the only one worth
     * believing - a client that patched its own state locally would drift the moment two edits
     * overlapped, which is exactly the case a grouping feature invites.
     */
    collections(): Promise<CollectionsFile>;
    collectionEdit(edit: CollectionEdit): Promise<CollectionsFile>;
    /** per-platform canonical-path coverage claims - the editor lens's ground truth (vs-editor-2) */
    coverage(): Promise<CoverageInfo[]>;
    /** the running build's version + studio folder (About shows both; the update check compares) */
    version(): Promise<{ version: string; studioDir?: string; mode?: "packaged" | "source" | "browser" }>;
    /** ask GitHub for the latest release, server-side against a fixed URL; button-press only */
    updateCheck(): Promise<{ httpStatus: number; body: unknown }>;
    /** one page of the repo's GitHub releases (raw array in `body`); the client builds the timeline. */
    updatesReleases(
      page?: number,
    ): Promise<{ httpStatus: number; body: unknown; hasMore: boolean; retryAfterSec?: number }>;
    /** begin an update/rollback to a release tag; 202 -> { started, kind }, else throws (host-only). */
    switchTo(version: string): Promise<{ started: boolean; kind: "update" | "rollback" }>;
    /** poll the running switch's progress. */
    switchStatus(): Promise<{
      phase: "idle" | "working" | "restarting" | "manual" | "failed";
      message: string;
      target: string | null;
    }>;
    /** read + clear the restart-outcome marker (drives the post-restart popup). */
    switchPending(): Promise<{ marker: { from: string; to: string; at: number } | null }>;
    /** stop the server and exit the app (About's Quit button) */
    shutdownApp(): Promise<{ ok: boolean }>;
    /** stop, respawn the same command, exit; the page reconnects (About's Restart button) */
    restartApp(): Promise<{ ok: boolean }>;
    /** current remote-access state (the Remote access tab polls this) */
    remoteStatus(): Promise<RemoteState>;
    /** start remote access; the server opens the Tailscale sign-in page when the node asks for it */
    remoteEnable(): Promise<RemoteState>;
    /** stop remote access and drop back to off */
    remoteDisable(): Promise<RemoteState>;
    /** the devices currently connected (host-only) */
    remoteDevices(): Promise<RemoteDevice[]>;
    /** kick a connected device by its node id (host-only) */
    remoteKick(nodeId: string): Promise<{ ok: boolean }>;
    /** whether the mesh helper can be fetched for this platform, and what is already installed */
    remoteHelperStatus(): Promise<AuxHelperStatus>;
    /** fetch, verify against the baked fingerprint, and install the mesh helper (host-only) */
    remoteHelperDownload(): Promise<AuxHelperStatus>;
    /** LAN mode status (connect code + pending/connected devices), host-only */
    remoteLanStatus(): Promise<LanStatus>;
    remoteLanEnable(): Promise<LanStatus>;
    remoteLanDisable(): Promise<LanStatus>;
    remoteLanApprove(id: string): Promise<LanStatus>;
    remoteLanDeny(id: string): Promise<LanStatus>;
    remoteLanKick(id: string): Promise<LanStatus>;
  };
  pieces: PieceStore;
  /** Host-verified appearance state; apps cannot paint or authorize themes themselves. */
  appearance: {
    get(): EffectiveThemeAppearance;
    /** Resolve a verified package asset to a renderer-only URL; the wire descriptor stays canonical. */
    assetUrl(id: string): string | undefined;
    invalidate(): void;
    refresh(): Promise<void>;
    onChange(cb: () => void): () => void;
  };
  /** update the mono status bar's app segment */
  setStatus(text: string): void;
  /** every installed app's manifest (Settings needs the roster for the home-app picker) */
  apps(): AppManifestEntry[];
  /** open another packaged app without importing shell state into an app bundle */
  openApp(id: string): void;
  /** THE right-click system (src/ui/shell/store.ts): attach targets on your elements, register
   * providers for target types; one consistent menu everywhere, extended by registration. Prefer
   * the `useContextMenu` hook for React elements (attaches on mount, detaches on unmount); `attach`
   * stays here for the shell's own imperative use (e.g. the document-level fallback target) and
   * now returns a detach function. */
  menus: ContextMenus;
  /** per-user app preferences, persisted into the studio's settings.json open record
   * (namespace your key by app id: "workbench.view"); read returns undefined when unset */
  prefs: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  /** THE WORKBENCH's open pieces - shell-owned (they ARE the tab strip) so they persist across
   * app switches. Sending honors the user's follow setting (ask / always / never). */
  workbench: {
    pieces(): StudioEntitySummary[];
    /** the piece whose editor the Workbench shows */
    active(): StudioEntitySummary | null;
    /** the piece pinned beside the active one, or null when the stage is a single pane. ANY kind
     * can sit beside any other - the split lives in the shell, not in one editor. */
    beside(): StudioEntitySummary | null;
    /** open a piece on the Workbench (follow-prompt per settings; no-op if already open) */
    send(s: StudioEntitySummary): void;
    /** open a piece AND land on its editor, no follow prompt - for create/"open" buttons where
     * the click itself already says where the user is going (the openBeside precedent) */
    open(s: StudioEntitySummary): void;
    /** pin a piece into the second pane beside the active one (opens it first if needed) */
    openBeside(s: StudioEntitySummary): void;
    /** collapse back to a single pane; the pinned piece stays open as a tab */
    closeSplit(): void;
    /** open a batch of pieces at once (already-open ones are skipped); the follow-prompt fires
     * ONCE with the count actually opened - the multi-select commit path */
    sendMany(pieces: StudioEntitySummary[]): void;
    /** close a piece */
    remove(id: string, kind: string): void;
    /** is this piece open on the Workbench? */
    isOpen(id: string, kind: string): boolean;
    /** report an editor's unsaved state; the shell tab wears the dirty dot (the one saved/unsaved
     * indicator - no "saved locally" pill competes with it) */
    setDirty(id: string, kind: string, dirty: boolean): void;
    /**
     * Which open pieces carry unsaved work, keyed "kind:id".
     *
     * THE READER FOR setDirty, added because its absence pushed an app into importing the shell
     * store directly - which the structural guardrail refuses, and rightly: an app bundle with its
     * own copy of the store forks the store and React both. The one door needed widening rather
     * than working around.
     *
     * Keyed WITHOUT the pane focus suffix, which is the trap: a pane is "kind:id@entry" and dirty
     * is tracked per piece, so looking one up by pane key type-checks and reports every
     * entry-focused lorebook as saved.
     */
    dirty(): Readonly<Record<string, boolean>>;
    /** per-piece last-opened timestamps ("kind:id" -> epoch ms); merged with importedAt to rank
     * the Workbench recents rail. A copy - callers never mutate the store. */
    recents(): Record<string, number>;
    /** activate a piece's tab and go to the Workbench */
    focus(id: string, kind: string, focusEntry?: string): void;
    /** True from boot until the studio's piece list has confirmed a saved bench's contents (or there
     * was nothing to restore), or the read has permanently failed (use-boot.ts). The Workbench reads
     * this to show "Restoring your bench..." instead of a bare empty room while it is true. */
    restoring(): boolean;
    /** The sticky boot failure that prevented a saved Workbench from being confirmed. */
    restoreFailure?(): string | null;
    /** subscribe to changes; returns an unsubscribe (call it in the app's cleanup) */
    onChange(cb: () => void): () => void;
  };
  /** The Press's staged queue (staging grammar: the Library stages, the Press works the set). Same
   * one-door rule as workbench: apps never import shell modules. */
  press: {
    queue(): StudioEntitySummary[];
    stage(batch: StudioEntitySummary[]): void;
    unstage(id: string, kind: string): void;
    clear(): void;
    onChange(cb: () => void): () => void;
  };
  /**
   * Tell the agent window what is on this screen right now.
   *
   * THE LIVE HALF of agentSurface. The manifest says what this app is for; only the mounted app
   * knows which pieces are listed, which one is focused, and which of them has unsaved work.
   *
   * OPTIONAL BY DESIGN. An app that never calls this still gets a surface built from its manifest,
   * because a seam that produced nothing for the apps that skipped it would be skipped by all of
   * them. Publishing makes the agent better on that screen; not publishing costs the app nothing.
   *
   * THERE IS NO UN-PUBLISHING, and that is deliberate rather than an omission. The shell swaps apps
   * through one slot, so opening the agent window unmounts the screen it exists to describe. A
   * publish withdrawn on unmount left the window reading nothing on the one navigation the whole
   * design serves. A snapshot stands until another screen replaces it.
   */
  agent: {
    /** Describe this screen. Replaces whatever the last screen said. */
    publish(state: AgentState): void;
    /**
     * The screen last described, or null before any has been.
     *
     * READ THROUGH THE CONTEXT, NEVER BY IMPORTING THE MODULE. Every app under /apps is bundled
     * separately, so an app importing live-state gets its OWN instance of it - a different object
     * from the one the shell publishes into. The agent app did exactly that and could therefore
     * never see a single publish: mounted as a dock app it read an empty module and said "no screen
     * has described itself yet" on every navigation, while the same component in the floating panel
     * worked, because there it runs inside the shell's own bundle. The same shape as the
     * `instanceof` split recorded in _shared/api-fetch.ts, and just as invisible to a typecheck.
     */
    current(): { readonly appId: string; readonly state: AgentState } | null;
    /** Subscribe to the above; returns the unsubscribe. */
    onChange(cb: () => void): () => void;
  };
}

// -- shared wire shapes (server <-> client) ---------------------------------------------------------

export interface StudioEntitySummary {
  id: string;
  kind: string;
  name: string;
  /** friendly source line for the receipt ("A character card, made for SillyTavern.") */
  provenance?: string;
  /** entity accent when authored */
  accent?: string;
  importedAt?: string;
  /** the entity carries displayable art at /api/studio/portrait?kind=..&id=.. */
  hasPortrait?: boolean;
  /**
   * The library's version of this piece (`EntitySummary.version`, `store-listing.ts`): starts at 1,
   * rises with every change, including an edited portrait. Absent on a plain folder, which keeps no
   * versions. Views append it to a cached portrait URL (`view-contract.ts`'s `versionedArtUrl`) so
   * the shared art cache (`_shared/art-cache.ts`, keyed on the URL alone) fetches fresh art after an
   * edit instead of serving what it decrypted before.
   */
  version?: number;
  writeId?: number;
  revision?: string;
  /** source format id ("sillytavern") + its variant ("v3") for the card-type chip */
  sourceFormat?: string;
  sourceVariant?: string;
  /** the piece's own content tags (character discovery tags, a book's or persona's tags) */
  tags?: string[];
  /**
   * Optional view params. Lorebooks use `focusEntry` so the same book can open beside itself
   * on two different entries (pane key is kind:id@focusEntry; dirty stays kind:id).
   */
  params?: { focusEntry?: string };
  /** Body-derived shelf/peek facts off the piece's sealed summary;
   *  absent on a save/create/restore response, where a reader falls back to `getEntity`. */
  facts?: PieceFacts;
}

export interface StudioDamagedEntry {
  kind: string;
  id: string;
  /**
   * THE STUDIO'S OWN UNION, imported rather than copied.
   *
   * This was a hand-written list of four while the studio had five. Nothing failed to compile,
   * because a type that lies about what can arrive cannot be checked against what does: the server
   * sent `unusable-filename`, the notice's switch fell out of the bottom, and 145 files were listed
   * on screen as `undefined`. Importing it makes the next reason a compile error instead.
   */
  reason: StudioDamageReason;
}

export interface InspectResult {
  ok: boolean;
  /** friendly, plain-words lines for the receipt (already humanized by the server) */
  receipt?: { name: string; kindLine: string; extras: string[] };
  entity?: unknown;
  /** Large inspect and archive rows stay server-side and commit through save-staged by this ref. */
  staged?: { token: string; key: string };
  /** The imported entity's minted id, for archive dependency rewrites. */
  entityId?: string;
  /** SHA-256 content key when a staged row has no client-side entity. */
  contentHash?: string;
  /** Archive rows only: the entity's lorebook references, so the sheet's link caveat can warn
   * about refs that will not resolve without reading an entity the row no longer carries. */
  knowledgeRefs?: string[];
  /** Archive lorebook rows only: entry count for the sheet's "N entries" chip. */
  entryCount?: number;
  /** The pieces extracted with the primary (a character's embedded lorebook, a preset's bundled regex sets), each a
   * canonical piece naming its own kind, already linked from the primary (convert.ts readPieces). */
  related?: unknown[];
  formatId?: string;
  kind?: string;
  parseReport?: ParseReport;
  /** plain-words failure ("We could not read this one. ...") - warm, never technical */
  error?: string;
}

/**
 * Result of POST /api/inspect-archive: a `.lvbak` fans out into many entities in one upload, so
 * this is `{rows, report}` rather than one InspectResult. Each row is InspectResult-shaped but a
 * SUMMARY: receipt, kind, parseReport, and a `staged` ref - never `entity`, because a real
 * backup's entities total gigabytes and the one-response-body design is exactly what used to OOM
 * (JSON.stringify caps near 2 GiB). The entities wait server-side; commit saves each row by
 * reference through POST /api/studio/save-staged. `formatId` is always "lumiverse-archive" (the
 * CONTAINER a user actually dropped, not each entity's own internal codec pathway), and there is
 * no `related` grouping: an archive's embedded books and bundled regex sets already arrive as
 * their own top-level rows, never nested under a primary, so listing them again as `related`
 * would double them in a sheet. `report` is the whole-archive accounting (imported/failed/
 * skipped tables/warnings) a later report card (M13) reads; `rows` is what a sheet (M12) checks
 * and commits, same as any other import.
 *
 * A WHOLE-ARCHIVE abort (unsupported schema, not a .lvbak, a corrupted or oversized container)
 * never produces rows at all: `ok` is false and `error` carries the one warm-words line, same
 * voice as InspectResult.error.
 */
export interface InspectArchiveResult {
  ok: boolean;
  rows?: InspectResult[];
  report?: LvbakImportReport;
  error?: string;
}

/** Request body of POST /api/studio/save-staged: one staged archive row, committed by reference. */
export interface SaveStagedPayload {
  token: string;
  key: string;
  /** minted lorebook id -> REAL shelf id, from the commit loop's own keep-both bookkeeping */
  refIds?: Record<string, string>;
}

/** Result of POST /api/studio/save-bundle. Partial failures retain already-written related entities. */
export interface SaveBundleResult {
  ok: boolean;
  /** Set when the file was a chat: the scene it became. A chat is saved to the scenes, not the shelves, so `primary` is absent. */
  scene?: { sceneId: string; title: string; messageCount: number };
  /** Set when the file was a chat that is already a scene (the save is refused): the scene that holds it. */
  alreadyImported?: { sceneId: string; title: string };
  primary?: StudioEntitySummary;
  related: StudioEntitySummary[];
  partial?: boolean;
  error?: string;
}

export interface ExportResult {
  suggestedExtension: string;
  text?: string;
  bytesB64?: string;
  report: SerializeReport;
}

export interface FormatInfo {
  id: string;
  label: string;
  kind: string;
  outputExtensions: string[];
  /** human platform name for receipts/pickers ("SillyTavern", "RisuAI") */
  friendly: string;
  /** Bunzai's own storage format: never offered as an external publish target */
  native: boolean;
  /** the generic reader of a family: its cards chip as "Default", not a platform name */
  generic: boolean;
}

/** One platform's coverage claims (served by /api/coverage; declared in src/formats/<id>/coverage.ts).
 * The editor lens computes every dim/tag from these - the editor itself knows zero platforms. */
export interface CoverageInfo {
  id: string;
  label: string;
  /** canonical body path prefixes the platform's wire carries (dot-boundary prefix semantics) */
  carries: string[];
  notes?: Record<string, string>;
  /** false = export honesty only; omit from the editor platform strip. Default true. */
  lens?: boolean;
}
