# Glossary

Words that mean something particular in Bunzai, and the folder that owns each one. Read this
before searching by name: several words here mean two different things, and a few folders are not
what their names suggest. For where a specific file lives and what it does, search the generated
[code map](../generated/CODE-MAP.md), which lists every source file with its one-line purpose.

`bun run glossary:check` (part of `verify:ci`) fails when a path named here no longer exists, or
when a folder directly under `src/` is missing from the table below.

## Where things live

| Folder | What it holds |
|---|---|
| `src/core/` | The engine's pure center: the canonical model, adapter contract, registry, detection, and synchronous derived-result owner. Imports no UI or storage. |
| `src/entities/` | One folder per content kind (character, lorebook, preset, and so on): its schema, its runtime check, and its capabilities. |
| `src/formats/` | One folder per platform format (SillyTavern, RisuAI, and others), found by folder name, never registered by hand. |
| `src/studio/` | The Studio's storage on disk: safe paths, atomic writes, settings, keep-both naming. Not the Studio's screens (those are in `src/ui/`). |
| `src/ui/` | The Studio app: the local server, the React shell, the apps (rooms), and the desktop window. |
| `src/ui/components/light-rays/` | Vaudeville OGL spotlights and roiling floor fog: one capped canvas, shaders, and CSS fallback. |
| `src/ui/components/proscenium/` | Reusable black theater frame with ruby curtains, a hanging sign and an artwork screen. |
| `src/kit/` | Kit, the terminal agent: its session loop, tools, commands, key vault, and screens. |
| `src/stage/` | The Stage, the chat runtime being built: contracts, the SQLite store, encryption, providers, and pipeline hooks. |
| `src/extensions/` | Validated extension packages, generated operation catalogs and SDK, and the sealed install, approval, audit, and revoke lifecycle. Untrusted JavaScript runs through the bounded QuickJS runtime. |
| `src/sandbox/` | Lua and regex test benches, plus extension JavaScript guest workers. Imported script content remains data; execution requires its supported isolated worker. |
| `src/site/` | The public website built into the GitHub Pages root: its pages, style, and the one script that reads the releases list. |
| `src/pocket/` | The browser-only Studio for the static web build, kept in memory with nothing saved. |
| `src/mcp/` | Bunzai's Model Context Protocol wire code. |
| `src/docs/` | Code that finds and checks documentation for the in-app readers. Not the documentation itself, which is the top-level `docs/`. |
| `src/generated/` | Files written by scripts (import seams, packaged format lists). Never edit by hand. |
| `src/types/` | Type declarations for dependencies that ship none. |
| `src/shared/` | Small cross-domain helpers with one shared behavior owner. |
| `docs/` | Documentation: decisions (`docs/decisions/`), references, and guides. |
| `scripts/` | Build, generation, and check scripts; `scripts/hooks/` holds the commit and push gates. |
| `sidecar/` | The Go remote-access companion, built separately. |

## The engine and formats

| Word | Meaning here | Where | Watch out |
|---|---|---|---|
| canonical entity | The one shared shape every format converts to and from. | `src/core/canonical.ts` | |
| hub and spoke | Every conversion goes format to canonical to format, never format to format. | `docs/reference/architecture.md` | "Spoke" also names a Stage provider (below). |
| adapter | One format's plug-in: it detects its files and converts one kind of content. | `src/core/adapter.ts` | |
| escrow | The `original` field, which keeps a format's own fields that the canonical model has no place for, so nothing is lost. | `src/core/canonical.ts` | Kept per source format, not one blob. |
| superset rule | A field joins the canonical model only when a real format emits it; otherwise it stays in escrow. | `docs/reference/architecture.md` | |
| folders-as-schema | A format, app, or capability is a folder; adding the folder adds the thing. Nothing is listed centrally. | `src/core/loader.ts` | |
| capability | A small, typed edit to one kind of content that previews a change and never writes by itself. The Workbench and Kit both use them. | `src/entities/` | |
| registry | The in-memory table of adapters that scores which format a file is. | `src/core/registry.ts` | |
| derived result | A rebuildable computation cached by input revision; never canonical authority. | `src/core/derive/derive.ts` | Its encrypted persistent tier is optional and disposable. |
| piece part | A named unit of canonical content stored with version visibility and exact blob references. | `src/entities/piece-parts.ts` | The storage backend treats its sealed contents as opaque. |
| blob | A shared content-addressed media or escrow payload referenced by parts. | `src/entities/piece-parts-blob.ts` | Disk keys are keyed hashes; imported scripts remain data. |
| owner | The existing module that controls a behavior or state boundary. | `docs/reference/architecture.md` | A cache, projection or transport receipt does not become a second authority. |
| round-trip law | Exporting to the same format keeps the meaning. | `AGENTS.md` | Byte-identical only where a format's spec says so. |

## The Studio and Kit

| Word | Meaning here | Where | Watch out |
|---|---|---|---|
| Studio | The app where content is made and kept. | `src/ui/` | Its storage folder is `src/studio/`; its screens are in `src/ui/`. |
| room | One app inside the Studio, such as the Library room or the Workbench room. | `src/ui/apps/` | |
| Dock | The row of app tiles that switches rooms. | `src/ui/shell/` | |
| Library | The room for importing, browsing, and selecting pieces. | `src/ui/apps/library/` | Not the Stage's library store. |
| Workbench | The editing room, the Studio's home. | `src/ui/apps/workbench/` | |
| Binder | The lorebook editor inside the Workbench. | `src/ui/apps/workbench/lore/` | Not its own room. |
| Press | The export room. | `src/ui/apps/press/` | |
| Kit | The terminal agent that works on the same content as the Studio. | `src/kit/` | Release build commands include the Kit executable. |
| bridge | Kit's one way into the Studio's content, and the trust boundary it cannot go around. | `src/kit/bridge.ts` | |
| belt | The tools Kit offers the model. | `src/kit/belt.ts` | |
| gate (Kit) | The pause where a Kit draft must be applied or discarded on purpose. | `src/kit/changes/` | "Gate" also names the commit and push checks in `scripts/hooks/`. |
| rail | Kit's live view of a preset's prompt blocks, in order, edited in place. | `src/kit/render/rail/` | |
| doctor | Kit's `/doctor` self-check of its vault, provider, and build. | `src/kit/doctor/` | The planned card health check is a different thing. |
| graveyard | Where deleted content waits before it is purged, so a delete can be undone. | `src/studio/graveyard.ts` | |
| keep-both | On a name clash, save beside the old copy under a new name instead of overwriting it. | `src/studio/store.ts` | |

## The Stage (the chat runtime)

| Word | Meaning here | Where | Watch out |
|---|---|---|---|
| Stage | Bunzai's chat runtime, built behind contracts. Its encrypted database holds the Studio's library and every scene. | `src/stage/` | The Studio makes content; the Stage plays it. |
| contracts | The interfaces nothing may go around: the library store, the chat store, the provider, and the pipeline hooks. | `src/stage/contracts/` | |
| spoke (provider) | One connection to a model service, such as the OpenAI-compatible one. | `src/stage/provider/` | Not the formats' "hub and spoke". |
| cast | A chat's fixed roster (character, persona, preset) and the frozen copy taken when the chat starts. | `src/stage/store/` | Kit's `/gallery` shows card art; that is not the cast. |
| branch, swipe | A fork in a chat, and an alternate reply in the same place. | `src/stage/store/` | |
| turn | One full generation, through every pipeline hook in order. | `src/stage/pipeline/` | |
| loadout | A saved bundle of a scene's own settings (preset, samplers, model, lorebooks, props, guides, note, backdrop, persona) that can be applied to another scene. It is one sealed document in the library, not a piece. | `src/studio/loadouts.ts` | Not a piece kind and not in the Library. RoleCall's `loadoutCode` on a card is an unrelated recommended-config code. |
| loadout receipt | The record an apply leaves, with each changed setting's value before and after, so Undo can put it back for 15 minutes. | `src/studio/loadouts.ts` | Not the delete and import receipts (`src/ui/receipt.ts`, the content store). It lives in the loadouts document and survives a restart. |
| piece store | The boot-owned accepted summary inventory shared by Studio readers. | `src/ui/_shared/piece-store.ts` | Committed write identities and lock lifetimes fence updates; it does not own canonical bodies. |
| search index | A rebuildable projection of searchable piece metadata. | `src/core/search/`, `src/stage/search/` | Portable Core contracts are separate from native worker and encrypted persistence owners. |
| scene state | What a scene remembers beyond its text, in named slots (the macro variables are the first), kept as per-version deltas and rebuilt from the shown history. | `src/core/scene-state/`, `src/stage/store/` | Not the scene's settings (connection, preset, Props), which are stored on the chat as they are set. See [scene-state.md](scene-state.md). |
| tracker | Two things. A Props tracker is a first-party module (Inventory, Spellbook, ...) a scene switches on. A library tracker is a piece the person makes from named typed fields, linked by a scene, kept as scene state and updated by the model through one tool. | `src/core/trackers/` (Props), `src/entities/tracker/`, `src/core/tracker.ts` (library) | The two keep separate state and separate blocks in the prompt. See [tracker.md](entities/tracker.md). |
| Compendium | A scene's typed-entry view of its lorebooks (eleven entry types, a derived tree, dashboard numbers, relationship and cross-reference graphs) and the scene choices and receipts behind recall and filing. | `src/core/compendium/` | Not the lorebook engine (`src/core/lore/`), which matches keys; the Compendium reads `metadata.entry_type`. A receipt here is a filing record (ChatStore rule 39), not a loadout or delete receipt. |
| cold fill | A bounded worker reconstruction used on a full read or patch-cache miss; a patch's fill keeps pictures as references. | `src/stage/store/cold-read-service.ts` | Logical admission is not a measured physical-memory limit. |
| performance evidence | Revision- and artifact-bound observations consumed before release. | `scripts/scale/timed.ts`, `scripts/scale/release-evidence.ts` | Source definitions are integrated; no measurements were produced during this pass. |
| background lane | Runs heavy work (the file rebuild, the password lock, snapshots, the health check's cell checks) on worker threads so the app never freezes. | `src/stage/worker-lane.ts` | |
| breather | Makes a long loop hand control back to the app every 20 ms or so. | `src/stage/store/breather.ts` | |
| freeze gate | `bun run perf:check`: fails when an everyday action freezes the app past 100 ms (it runs with the health check's seal attached, and `perf-gate-health.ts` scans a library with a 20 MB image on the lane). Its data (5,000 cards of a few KB each) lives in `perf-gate-data.ts`, split out from the runner 2026-09-29; that file also holds realistic 1-3 MB bodies and a ~20 MB snapshot for later phases. `perf-browser.ts` (not in `verify:ci`) seeds a sandbox with that realistic data, boots the real server, and drives it with a headless browser over CDP to print numbers against the perf plan's target budgets; it asserts nothing itself. | `scripts/perf-gate.ts`, `scripts/perf-gate-health.ts`, `scripts/perf-gate-data.ts`, `scripts/perf-browser.ts` | The realistic data is not wired into this gate's own pass/fail yet: on today's code it fails past budget on a large real library. Whichever phase fixes that is the one that should switch this gate's data over. |

## Encryption

| Word | Meaning here | Where | Watch out |
|---|---|---|---|
| data key | The one key that encrypts everything in the library. It never changes. | `src/stage/crypto/crypto.ts` | |
| keyring | Where the data key is kept wrapped, and every way to unlock it. | `src/stage/crypto/keyring.ts` | The Linux keyring (Secret Service) is a different thing: one of the key vault's locks. |
| key vault | Kit's store for secrets, locked by the operating system (DPAPI, the macOS Keychain, the Linux Secret Service) or a key file. | `src/kit/keystore/` | |
| device vault | The keyring's use of the key vault to give this computer its own copy of the data key. | `src/stage/crypto/device-vault.ts` | |
| remembered computer | A computer holding its own copy of the data key, so it opens without a password. | `src/stage/crypto/` | |
| recovery words | The twelve words that open the library when everything else is lost. | `src/stage/crypto/crypto.ts` | |
| snapshot | A clean copy of the library file, made hourly on the background lane and kept 24 hourly, 7 daily, 4 weekly; a restore can be undone. | `src/stage/store/sqlite/snapshots.ts` | |
| health check | A scan of the whole library that opens every sealed cell and compares each row with its keyed fingerprint, then names each damaged item in plain words and offers a repair that sets things aside, never deletes. | `src/stage/store/sqlite/health-check.ts` | The cell checks run on the background lane under a key lease, never on the main thread. A row with no fingerprint yet is "not yet covered", not damage. |
| row fingerprint | A keyed hash of one row's contents (a sealed cell contributes only its IV and tag), kept in `row_fingerprints` and re-made inside the transaction that changed the row. | `src/stage/store/sqlite/row-fingerprints.ts` | Travels with the content in a restore. |
| set aside | Moving a damaged row, whole, into `set_aside`, a table no purge reads, instead of deleting it. | `src/stage/store/sqlite/health-repair.ts` | User data: a restore brings back the snapshot's set-aside rows. |
| cell | One encrypted value in the database. | `src/stage/crypto/cell-cipher.ts` | |
| stand-in | A test-only fake (`fake-*.ts`), such as the fast password lock. App code may never import one. | `src/stage/crypto/` | |

## Process and docs

| Word | Meaning here | Where | Watch out |
|---|---|---|---|
| ADR | An accepted decision record. | `docs/decisions/` | |
| sidecar (docs) | A doc page's summary file, which must be approved before it counts. | `docs/summaries/` | "Sidecar" also names the Go companion in `sidecar/`. |
| Hoplight | The parent project Bunzai forked from; it has no Stage. | `docs/decisions/` | Stage code never flows back to it. |
