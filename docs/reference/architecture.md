---
id: reference/architecture
title: Architecture
audience: dev
summary: The whole engine: the hub-and-spoke canonical model, escrow, the adapter contract, detection, folders-as-schema, bundles, and the CLI.
tags: [architecture, canonical, escrow, adapter, detection, engine]
related: [reference/entities/character, reference/formats/sillytavern, reference/concepts/canonical-model]
---

# Architecture

bunzai converts AI-roleplay content between formats without losing information. This page explains the
whole engine: how a file becomes a canonical entity and back, and why the design guarantees are what
they are.

## The one idea: hub and spoke

Every format converts through **one canonical superset model**, never format-to-format directly.

```
SillyTavern  ─┐                        ┌─ SillyTavern
RoleCall     ─┤                        ├─ RoleCall
Risu         ─┼──►  canonical entity  ─┼─ Risu
Backyard     ─┤     (the hub)          ├─ Backyard
Agnai        ─┘                        └─ Agnai
```

With `N` formats, a mesh of direct converters would need `N x (N-1)` of them. Hub-and-spoke needs `N`
adapters: each maps its format to and from the canonical model. **Adding a format is +1 adapter, and it
touches no other format and no core code.**

- `import` = read a file into the canonical model (`toCanonical`).
- `export` = write a canonical entity out to a format (`fromCanonical`).
- A conversion is just `import` then `export`.

## The canonical entity

`src/core/canonical.ts` defines the stable wrapper every entity shares:

```ts
interface CanonicalEntity<Kind, Body> {
  schemaVersion: "1";
  kind: Kind;          // character, lorebook, persona, preset, regex, quickreply, pack, or htmldoc
  id: string;          // stable slug derived from the name
  body: Body;          // the actual content, in the superset shape
  profiles?: ...;      // sparse per-app overrides (author once, differ per app)
  original?: ...;      // parsed source twin and source-specific fields (the escrow envelope)
}
```

Six adapter-backed kinds exist today: `character`, `lorebook`, `persona`, `preset`, `regex`, and
`quickreply`.
Their `Body`
shapes are documented under [entities/](entities/), starting with
[entities/character.md](entities/character.md) and [entities/lorebook.md](entities/lorebook.md). The
canonical schemas also define `pack` entities.

### The superset rule

The canonical body is a **superset**: the union of what all real formats express. A field earns a
first-class canonical slot **only if some real wire format actually serializes it**. If no format
produces a field, it does not become a canonical field; at most it rides in escrow. This is why the
lorebook schema, for example, drops five RoleCall in-memory-only fields to escrow (see
[entities/lorebook.md](entities/lorebook.md)) rather than pretending they are portable.

## Escrow: semantic round-trips, contained cross-format loss

Each entity carries an **escrow envelope**, stored in its `original` field (`src/core/canonical.ts`),
keyed by source format:

```ts
original["sillytavern"] = { raw: <the parsed original card>, unmapped: { ... } }
```

- **Same-format round-trip preserves meaning and escrowed fields.** Export re-projects the canonical
  body onto a clone of the original `raw`, so fields the canonical model does not express
  (app-specific extensions, scripts, layout, ids) survive. Edited fields re-encode; untouched fields
  come from the twin. Byte identity is promised only by format specifications that declare and test a
  byte-level round-trip tier.
- **Cross-format conversion is contained-loss by design.** Only the canonical body crosses. One app's
  private junk (its extension blocks, trigger scripts, bespoke layout) is deliberately **not** copied
  into another app's file. This is a safety guarantee, not a gap: bunzai never blind-copies one app's
  fields or executable payloads into another. The future refinement is opt-in per-field extension
  mappers, never a blind copy.
- **Binary carriers are kept.** An `EscrowEntry` may carry `sourceMedia: { b64, mime }` - the file
  the payload arrived INSIDE. A PNG card's pixels are authored art, so the Tavern-lineage PNG
  adapters (sillytavern, rolecall) store the carrier; the studio serves it as the entity's portrait
  (`/api/studio/portrait`) and the PNG export path can reuse those pixels. The card text chunks are
  regenerated on export, so this does not promise byte-identical PNG output. Text sources have no
  carrier and omit it.

The storage layer keeps large entities in versioned parts and content-addressed blobs. Full reads rebuild
the complete canonical entity, including its escrow. An explicit light read reconstructs the body and
small head fields while omitting escrow; canonical media references stay as opaque blob sentinels and
carry stable asset URLs for the later asset-serving route. Existing storage also blobbed long base64-looking authored strings anywhere,
so light reads selectively open only those legacy text refs in visible body parts to preserve their text.
They never open `r/<format>` escrow parts or media payloads. A one-format escrow request opens the head's
selected entry and only its matching raw part, when present.
Body and selected-entry projections also expose their pinned revision/version metadata for internal
derivations and coherent editor captures. SQLite requests bounded planner optimization after opening
and before closing; lock contention skips these lifecycle hints without waiting. A yielding explicit
optimization seam runs after a first-start folder import or a completed import-sheet batch of more
than 1,000 committed pieces. Maintenance failure does not change an import-sheet result.

## The adapter contract

`src/core/adapter.ts` defines what every format plugin implements: one generic contract per kind, and the
`kind`-discriminated union of them over every kind in the generated kind seam:

```ts
interface AdapterBase {
  id: string;
  label: string;
  escrowFormatIds?: readonly string[]; // owned source twins when the adapter id is more specific
  outputExtensions: string[];        // extensions this adapter writes
  detect(input): number;             // 0..1 confidence it can read this input
}

interface KindAdapter<K extends KindId> extends AdapterBase {
  kind: K;
  toCanonical(input): EntityFor<K>;                // the kind's canonical piece
  fromCanonical(entity, context?): AdapterOutput;   // context carries embedded lorebooks to re-embed
}

// Character cards and presets add optional extras (extractLorebook; extractRegex and embedRegex).

interface AdapterOutput {
  text?: string;
  bytes?: Uint8Array;
  suggestedExtension: string;
  report?: SerializeReport;
}

type FormatAdapter = { [K in KindId]: /* CharacterAdapter, PresetAdapter, or */ KindAdapter<K> }[KindId];
```

The registry stores the union heterogeneously. A converter narrows on `kind` before it ever hands an
entity to `fromCanonical`, so a cross-kind call (handing a lorebook to a character writer) is not even
representable. **Formats are open (drop in any folder); entity kinds are a closed set** that grows by adding an
`entities/<kind>/` folder with its `kind.ts` and running `bun run kinds` ([extending/new-kind.md](extending/new-kind.md)).
The set is closed at compile time, which buys type safety across the whole engine.

Adapter-local reports are optional while the codecs migrate, but every orchestration boundary attaches
a `SerializeReport` before output reaches the CLI, HTTP API, export dialog, or Press. Reports name
escrowed, dropped, and shadowed paths plus warnings; their counts are derived from those lists. Canonical
source twins are normally keyed by the adapter id. A more specific wire adapter can declare
`escrowFormatIds` when it owns a family-keyed twin instead: for example, `rolecall-preset` owns
`original.rolecall`. The loss reporter then excludes that twin as same-format data while continuing to
report every genuinely foreign escrow entry.

Canonical JSON is parsed through `src/entities/runtime-schema.ts` at storage and HTTP boundaries, so TypeScript
interfaces are not the runtime check. Each `src/entities/<kind>/runtime-schema.ts` module strictly
decodes its complete handwritten domain type and exports its whole-entity `entitySchema` (the shared envelope from
`src/entities/_shared/envelope.ts` plus its body); the generated seam collects them into the boundary's union. `defineExhaustiveShape<T>()` infers each concrete schema
before requiring exact input and output parity, so missing or extra keys, narrowed unions, coercion,
`any` at any nesting depth, and `never` fail typecheck.
`src/entities/runtime-schema.ts` composes every kind's decoder (from the generated kind seam) into the discriminated union used by
storage, HTTP save, format-corpus verification, and Kit draft validation.

Unknown same-version keys fail instead of being stripped or carried silently. Openness is local and
declared: escrow `raw`, `unmapped`, platform extras, structured metadata, and named record bags keep
their unknown values. Profiles are shallow partial bodies for their matching content kind; omitted
top-level fields are allowed, but a present field must satisfy its complete canonical type. ADR-011
records this boundary contract.

## Detection and the registry

`src/core/registry.ts` is the pure, in-memory adapter table. `detect(input)` runs every adapter's
`detect()` and returns the single highest-confidence match above a `0.5` threshold. Scores are chosen so
more specific formats outrank generic ones (an RoleCall card scores `1.0` and beats the generic
SillyTavern reader's `0.9` on the same CCv3 card).

**The cross-kind firewall.** Because both character and lorebook adapters share one registry, a detector
must not claim another kind's files. The load-bearing case: a SillyTavern worldbook is also
`{ name, ... }` json, so the character reader's flat/v1 path is tightened to require a real character
signal (`description` / `personality` / `scenario` / `first_mes` / `mes_example`), not a bare `name`. A
lorebook has none of those, so it can never be mistaken for a character.

## Folders-as-schema (the moddability promise)

`src/core/loader.ts` is the one impure edge: it scans `src/formats/*/index.ts` with Node filesystem primitives,
dynamically imports each, and registers what it default-exports. Folders whose name starts with `_`
(`_template`, `_shared`) are skipped.

- A format **is** a folder. Nothing central lists formats; the filesystem is the schema.
- A folder's `index.ts` default-exports one adapter, **or an array of adapters** when a format family
  ships several codecs. Agnai, Risu, SillyTavern, and RoleCall each include character and lorebook
  codecs; some arrays also include regex, persona, preset, or quick-reply codecs.
- `FormatId` is an open string, so a drop-in can claim any id.

To add a format: copy `src/formats/_template`, fill in `detect` / `toCanonical` / `fromCanonical`, done.
No core edits, nothing to register by hand.

## Bundles: a card plus its lorebook

A character card can embed a lorebook (`data.character_book` in CCv2/v3). That embedded book is treated
as a **reference** to a canonical lorebook, not an inlined blob:

- On **import**, a shared layer extracts the embedded book into a standalone `CanonicalLorebook` and
  links it from the character via `knowledgeRefs`. This is format-agnostic (any CCv2/v3 card).
- On **export**, the target character adapter re-embeds the referenced lorebook into that format's own
  book slot, via the `EmitContext` it receives. This is format-specific. The resolved list is
  authoritative even when empty: clearing a link or disabling every linked book removes any stale
  embedded book inherited from the source twin instead of resurrecting it.

`src/convert.ts` `convertFile` ties it together: extract on import, re-embed on export, for same-kind
conversions. Details in [concepts/character-book.md](concepts/character-book.md).

## Semantic content capabilities

Semantic edits are pure drop-ins under `src/entities/<kind>/capabilities/`, with platform-native
extensions allowed under `src/formats/<platform>/capabilities/`. The filesystem remains the source
of truth. `src/kit/capabilities/discover.ts` loads the runtime catalog, while
`scripts/capability-manifest.ts` generates the browser import seam and CI checks it for drift.

A capability validates typed input and returns a complete canonical preview, exact changes,
warnings, and platform impact. It never writes. Kit's session-local change composer can combine
several previews for one target while rejecting identity or `original` escrow changes. The
Workbench imports the same pure mutation operations but continues to own focus, selection, and undo
state.
`defineContentCapability` supplies the shared canonical-only, deferred-draft defaults and a
`<kind>/<target.id>` concurrency key; owners keep their input schemas, summaries, aliases, and
preview strategy, and can provide a different concurrency key when their contract requires one.

The first expanded bundle lives under `src/entities/character/capabilities/`. Its ten semantic
operations cover the canonical character editor surfaces, including named variants and
card-embedded behavior scripts. Base-path and variant transforms live beside the character entity
and are imported by both Kit and the Workbench. Script capabilities only transform sealed data;
execution remains confined to the existing user-invoked sandbox benches.

Kit separates the complete runtime registry from the provider-visible snapshot. Direct tools are
always visible. One validated provider-discovery catalog covers `content`, `studio`, `transfer`, and
`diagnostics` descriptors. Content capability metadata projects into it; deferred non-content
`HarnessTool` drop-ins can provide the same metadata without creating another router. The live
deferred inventory is currently content-only. Only pure content capabilities enter the exact
read-or-draft access resolver. General workflow metadata cannot self-classify a tool that retains
the writable Studio bridge; those tools remain unknown until a separate safety-owned policy grants
an exact name. Deferred apply descriptors fail closed until that contract exists. Duplicate tool
names fail before dispatch maps or provider schemas are built.

Deterministic search replaces the current deferred set with up to five matches; collapsed browse
exposes only domain, area, and action metadata, and describe selects exactly one operation. The real
typed schemas appear on the next model request. Deferred exposure resets at the start of each user
turn, while preview drafts remain independently available for query, apply, or discard. Hidden
descriptors never enter search results, browse results, descriptions, or provider snapshots.

`studio_read` traverses canonical values with RFC 6901 JSON Pointers, outlines, offsets, and bounded
limits. Results above 4,096 characters receive an opaque session-local handle and peek.
`result_query` provides bounded stat, read, and literal search without accepting filesystem paths.
The store has UTF-8 byte caps per entry and in aggregate, a count cap, and oldest-first eviction;
character counts drive paging, and direct offsets keep values larger than the store cap recoverable.

Draft composition retains every operation's warnings and platform impact. `change_query` lists,
shows, and validates the complete accumulated proposal without writing. Content capabilities with a
`read` effect return deterministic observations and are rejected if they change canonical content or
claim changes. See [Kit content tools](kit/tools.md) and
[ADR-010](../decisions/ADR-010-content-capabilities.md).

Kit also receives one direct read-only documentation meta-tool with browse, outline, search, and
read. Browse and outline use only generated index metadata (collections, nested section maps, and
authored semantic summaries under `docs/summaries/`). Search lazily builds a small in-memory
BM25-style index over heading chunks plus semantic topics; read is the only path that returns
authoritative Markdown.

Documentation discovery for summary tooling is folder-derived from `docs/` (excluding `generated`,
`media`, `summaries`, and `summary-reviews`), not from a stale generated index: a new Markdown page
is visible to `docs:summaries:check` and `scaffold` immediately. Semantic prose enters
`docs-index.json` and `PAGE-INDEX.md` only when the sidecar is complete and an independent, hash-bound
`APPROVE` receipt under `docs/summary-reviews/` matches the current source and summary hashes.
Hashes prove drift, not semantic quality. Global `docs:summaries:check` requires every page
`APPROVED` and current queue/review projections; focused `docs:summaries:check -- <id>` (or
`--author`) validates the sidecar alone for authors before review. Source or summary edits invalidate
approval until a new independent review is recorded. The recursive catalogue is
`docs/generated/PAGE-INDEX.md`. Resolves reads through the same fail-closed, catalog-contained corpus
boundary as the Studio docs reader. It needs no vector server, embedding model, or network call.
Documentation access is separate from Studio piece access and never accepts an arbitrary filesystem
path.

Durable apply remains outside the pure capability. `StudioStore.compareAndSave()` compares the full
canonical revision and publishes under the storage backend's per-path write lock. Kit then re-reads
and verifies the saved canonical state before emitting a receipt. The security gate classifies only
exact catalog-derived capability names as preview-only drafts; apply remains an explicit write.

## Layering

Strict inward dependencies, never outward:

```
core        depends on nothing
  ^
formats     depend on core (+ shared helpers in formats/_shared)
  ^
cli / app   depend on formats + core
```

The engine never imports UI, a database, or a framework. Prove the converter (canonical + adapters +
tests) before any UI. The CLI was the first surface for that reason; the desktop Studio (`bunzai ui`,
a local Bun server + React app, see [ui.md](ui.md)) now sits beside it on the same engine.

The static browser Studio is a third delivery mode over that engine. `scripts/build-pages.ts`
discovers and bundles the same app, setup, tour, format, and documentation folders used by
the desktop build. `src/pocket/runtime.ts` implements the existing client API against
a memory `ContentStore` and `StateStore` and shared inspect/export actions. It introduces no browser-specific entity
schema or adapter registry. `src/ui/_shared/web-storage.ts` routes shell memory to volatile Maps in
this mode, leaving browser persistence untouched; a reload therefore starts with no Studio data.
Host-owned routes fail explicitly instead of being approximated in a static page.
Light editor reads, selected original envelopes, Risu asset metadata and conditional patch saves use
the same memory ContentStore projections. Desktop and browser patch routes share the runtime-neutral
envelope validator in `src/ui/_shared/studio-patch-request.ts`, including explicit autosave intent.
The shared read route in `src/ui/_shared/studio-read-route.ts` also owns light/full editor envelopes
and selected original projections; the desktop wrapper supplies its storage-error response mapping.
Browser upload grant routes are integrated and source-reviewed; this source pass has not been run in a browser.
The Pages build bakes the same validated host and example theme inventories as desktop; Pocket routes
use the shared theme lifecycle, with approvals held in per-tab memory and cleared on reload. Hosted
visible tabs check the authenticated, revision-only `/api/themes/revision` endpoint every two seconds
and on foregrounding; short reads avoid one held HTTP/1 connection per tab. Effective appearance and
asset routes remain separate, and guests receive no package, grant or audit details from the revision.

## The stage (chat runtime, in progress)

`src/stage` is Bunzai's chat runtime (plan D19), built contract-first. Its encrypted database
already holds the Studio's library, wired in by `src/ui/library-root.ts`. Canonical pieces live in
its versioned `ContentStore`: ordinary changes append a version, explicit autosaves share a persisted
fixed five-minute history window, a delete goes to a Trash for 3 days, and a deleted id is retired
for good, so nothing new can take it. The Studio and Kit reach it
through `StudioStore` (`src/studio/store.ts`); the CLI's `export` reads the stores directly. The Studio's own documents (settings,
collections, engine roots, Kit's block graveyard) live in its `StateStore`, beside two keys nothing
writes yet: `variables` for global macro variables, and `meter` for the token meter's learned numbers. Two more keys hold the guide library (`guides`) and saved scene setups with their undo receipts (`loadouts`; `src/studio/loadouts.ts`), and the folder export carries both. The app never runs on a
plain folder: one comes in through the folder import (`src/studio/folder-import.ts`) and goes out
through the folder export (`src/studio/folder-export.ts`) (plan D5).
Chats live in the same library's `ChatStore` (a SillyTavern chat file imports into it through the ordinary import route and `src/studio/scene-import.ts`; ChatStore rule 29); the Scenes app starts, lists, opens, and edits them (cuts,
takes, moving to the latest card) through `src/studio/scenes.ts`, and cut scenes, deleted takes, and cut
messages wait before the library's open purges them: 3 days for scenes, takes, and pieces, 1 day for a cut message (`src/core/trash-window.ts`). Messages show through the display macro pass in `src/core/chat-display.ts`
(ADR-012 amendment). The chat store also keeps what a reply needs (ChatStore rules 15 to 19): a
checkpoint per take while a reply streams, the prompt trace stored with each generated swipe, each
take's scene state (its macro variables are the `vars` slot, kept as per-version deltas and rebuilt from the shown history; [scene-state.md](scene-state.md)), the Kit connection and model each scene last used, and the scene's preset
with its own switches and sampler values. A scene follows its library preset: the turn loop reads
the preset's current version at every turn, so a library edit reaches the next reply. A turn writes a reply, a new version of the
last reply, or more text on the end of it (Continue; ChatStore rule 31). The turn loop
(`src/studio/scene-turn.ts`) lays the preset out and assembles the prompt with RoleCall's
assembler (`src/core/assembly`), applies the preset's samplers, window, and prefill
(`src/core/assembly/request.ts`), sends it through the scene's Kit connection behind Kit's egress
gate (`src/kit/providers/scene.ts`), streams the reply over `/api/chats/turn` (trying the person's Fallback Model once when the scene's model fails before writing anything, `src/studio/scene-turn-fallback.ts`), and teaches the token
meter from the reported usage. `contracts/` holds the interfaces and their shared test suites (library,
chats, provider, pipeline hooks); `store/` implements them, with `memory/` for tests and
`sqlite/` for the app's one database and its migrations; `crypto/` encrypts everything at rest;
`provider/` holds the OpenAI-compatible connection every other provider sends through, and the native
Anthropic connection (Anthropic's own Messages API, `/v1/messages`) a direct Anthropic connection
sends through instead: explicit `cache_control` breakpoints and no system-message hoisting, which the
OpenAI-compatible endpoint Anthropic itself offers does not support. `src/kit/providers/scene.ts`
picks between them per spoke (`ProviderSpoke.scene.native`) and sends tools on every connection that has a scene endpoint, local and custom included, bar models that refuse tools whatever their host (`sceneTools`); both report usage into the token meter's
record the same way (`src/core/tokens`, [token-meter.md](token-meter.md)); `pipeline/` checks hook effects. The D18
boundary lint keeps storage from importing engine, entity, or format code. The rebuildable-result
cache contract is in `src/core/derive/derive.ts`.

Chat snapshots use `store/cast-snapshot-codec.ts` outside the opaque backend boundary.
`store/chat-store.ts` composes the memory backend without importing SQLite;
`store/sqlite-chat-store.ts` owns desktop composition. Each backend's `chat-store-snapshots.ts`
owns full, light and targeted portrait reads; SQLite row shapes live in `chat-store-rows.ts`.
Light snapshots resolve authored references and leave declared media payloads sealed after checking
the complete reference topology. Migration 22 introduces snapshot parts and version fencing. These
source changes and unrun fixtures have received independent code review; migrations and runtime,
performance and packaged verification have not been executed during this implementation pass.

Cold full reads and cold patch fills use a per-library worker service with copied key leases,
held reply reservations and generation fences through cache publication and conditional writes.
The small memory path uses one bounded backend snapshot; SQLite admits sealed byte/row counts before
materialization. Shared decoding charges each repeated blob expansion before conversion and reports
unreadable stored payloads through the existing damage boundary. Desktop and CLI build definitions
include literal worker entrypoints; source packaging definitions and probes have not been executed.

## Reusable roleplay core

`src/rp-core.ts` exports `createRoleplayCore`. The caller supplies a `ChatStore`, `StateStore`, provider resolver, library readers, clock and random seed. It uses the existing turn orchestration and canonical assembly, skills, trackers and Final Cut. It does not create a second session journal. The source API can be imported by Bun; the Node core smoke bundles and executes a real scripted turn under Node.

Its `dramaturg` methods prepare, inspect and stop the scene consultant using that same runtime and provider resolver. Accepted work remains owned through startup, streaming and the final conversation write; shutdown cancels and awaits it. The ChatStore owns the revision-guarded sealed conversation in migration 46, alongside the existing scene-state migrations 43 through 45. Snapshot restore classifies the new table explicitly. Read-only tools use the current narrator tool loop without changing its reply-scoped write or deadline rules.

Create one core per opened store. Its live runtime owns turn controllers, inspection and regex waits, background tracker rounds, recovery operations and promises returned by the optional host `afterEvent` callback. Independent stores may use colliding identifiers. Await `close()` before closing storage; new turn/recovery mutations refuse after closure. Desktop composition shares one runtime across routes, and library shutdown awaits that runtime. The host remains responsible for other jobs it starts outside this API.

Desktop uses `src/ui/server-scene-composition.ts` to supply library readers, provider connections, Compendium hooks and automatic summary hooks. Those host hooks retain their existing scene lanes; the reusable API tracks their returned promises through shutdown. The terminal session runner accepts a configured core from its caller. This is a source API, not a published standalone package or proof of packaged-platform behavior.

## The CLI

`src/cli.ts` is the thin app layer. Commands:

| Command | Does |
| --- | --- |
| `bunzai convert <in> <out> [--to <format>]` | Convert a file. Target resolved by `--to` or the output extension. |
| `bunzai inspect <file>` | Show what is inside a file (kind, name, key fields). |
| `bunzai label <file>` | Guess a card's format and likely origin app. |
| `bunzai validate <file>` | Validate a file against its detected format and the canonical schema. |
| `bunzai formats` | List every adapter the registry discovered (the single source of truth). |
| `bunzai ui` | Launch the primary loopback Studio server; optional remote listeners are enabled separately. |
| `bunzai export <folder> [studio]` | Write the library out as a plain, unencrypted studio folder the import reads back. |
| `bunzai derived --stats|--clear [studio]` | Inspect or clear rebuildable derived-cache rows in the encrypted library. |
| `bunzai version` / `bunzai help` | The obvious. |

`src/cli-rp-session.ts` provides a terminal session runner over an injected core and scene store. Text sends a message; `/continue`, `/swipe`, `/help` and `/quit` control it. It cannot run imported regex: an enabled prompt rule fails before provider egress, and an enabled Final Cut input rule refuses that pass rather than executing the rule in the host. It is tested with scripted input and providers, and has no standalone CLI command yet. Cross-process ownership of an encrypted library must be enforced before a second process can safely use crash recovery alongside desktop.

## Source of truth

| Concern | File |
| --- | --- |
| Canonical wrapper, escrow, id policy | `src/core/canonical.ts` |
| Raw-twin field comparison and overlay dispatch | `src/formats/_shared/overlay-fields.ts` |
| Shared extension-to-MIME catalog and image set | `src/core/media/mime.ts` |
| Adapter contract, entity kinds, emit context | `src/core/adapter.ts` |
| Registry (detection, lookup) | `src/core/registry.ts` |
| Loader (folders-as-schema) | `src/core/loader.ts` |
| Bundle extract/re-embed orchestration | `src/convert.ts` |
| Shared synchronous derivation owner | `src/core/derive/derive.ts` |
| Sealed SQLite derivation persistence | `src/stage/store/sqlite/derived-backend.ts` |
| Stage contracts (library, chats, provider, hooks) | `src/stage/contracts/` |
| The one database: open, migrations, transactions, rebuild, the commit seal and its owed record | `src/stage/store/sqlite/database.ts`, `src/stage/store/sqlite/migrations.ts` |
| Rolling snapshots, retention, and whole-library restore (jobs run on the background lane) | `src/stage/store/sqlite/snapshots.ts`, `src/stage/store/sqlite/snapshot-jobs.ts`, `src/stage/store/sqlite/snapshot-retention.ts`, wired in `src/ui/library-snapshots.ts` |
| Row fingerprints and the health check (scan, lane cell checks, repairs) | `src/stage/store/sqlite/row-fingerprints.ts`, `migration-24-health-check.ts`, `health-check.ts`, `health-scan.ts`, `health-page.ts`, `health-lane.ts`, `health-repair.ts`, `health-move.ts` (also `health-cells.ts`, `health-closure.ts`, `health-labels.ts`, `health-roll-target.ts`, `health-structure.ts`, `health-types.ts`), and the lane worker `maintenance-worker.ts` |
| Backups and health routes (host only) | `src/ui/server-library-care.ts`, reached from `src/ui/server-library.ts` |
| Encryption at rest: keys, keyring, cell format | `src/stage/crypto/` |
| Appearance contract, built-in inventory, one-way legacy import and unified extension resolution | `src/extensions/theme-contract.ts`, `src/extensions/theme-appearance.ts`, `src/extensions/theme-inventory.ts`, `src/extensions/legacy-theme-migrations.ts`, `src/extensions/runtime/theme-service.ts` |
| Surface and variant ids, the difference score, and the painter that projects a theme onto `--bk-*` tokens | `src/extensions/surface-registry.ts`, `src/extensions/theme-difference.ts`, `src/ui/shell/theme-tokens.ts`, `src/ui/_shared/surface-variant.ts` |
| Shared theme read routes and revision-only polling | `src/extensions/theme-read-routes.ts`, `src/ui/server-theme-extensions.ts`, `src/pocket/runtime.ts`, `src/ui/shell/use-theme-events.ts` |
| Separate workspace and temporary overlay destinations; explicit promotion and shared draft owners | `src/ui/shell/store-navigation.ts`, `src/ui/shell/AppSurface.tsx`, `src/ui/shell/AppRooms.tsx` |
| RoleCall-style bottom dock, discovered app roster, persistent collapse preference and keyboard navigation | `src/ui/shell/Dock.tsx`, `src/ui/shell/dock-core.ts`, `src/ui/shell/bottom-dock.module.css` |
| Character superset | `src/entities/character/schema.ts` |
| Lorebook superset | `src/entities/lorebook/schema.ts` |

The informational scale timing wrapper requires an empty caller sandbox and a bounded fixture count. Release evidence is opt-in: `bun run scale:timed -- --release-evidence --profile low-end --n 10000 --artifact <absolute-json-path> --packaged-cli <absolute-compiled-cli> --packaged-desktop <absolute-desktop-executable>`. It owns a throwaway OS-temp workspace, redirects storage locations before fixture imports, and resolves Chrome from the existing browser cache before redirecting `LOCALAPPDATA`. The artifact records numeric coverage, failures, budgets, source identity, and a separate compiled-CLI launch/shell-response proof; for the desktop executable it records and later rechecks only the supplied binary's filename and SHA-256. That identity check does not prove desktop runtime behavior. `bun run scale:release-evidence -- <absolute-json-path> --packaged-cli <same-absolute-compiled-cli> --packaged-desktop <same-absolute-desktop-executable>` rejects stale, dirty, incomplete, mismatched, or failing evidence and re-hashes both artifacts. The reported search-build duration is the cold public request, a conservative upper bound that includes its first query. These source paths have not been executed and contain no measured results.


The Studio boot owns one PieceStore shared by Library, mentions, status and Workbench recents.
Committed receipts and journal replay update addressed summaries by write identity; lock lifetimes
fence delayed reads and recovery. Metadata completion batches replacements without per-row copies
of the growing projection. Native and Pocket bind the same search, asset and receipt contracts;
these integrated source paths have independent review, with executable and live proof still pending.

Cold admission shares a 256 MiB logical budget across sealed snapshots, decoder expansion, queued
work and retained handoffs. An active fill reserves the available allowance, so concurrent new
fills can receive a bounded busy refusal. This accounting is independently source-reviewed; it
is not a physical RSS measurement or proof that the massive fixture runs within the target latency.
