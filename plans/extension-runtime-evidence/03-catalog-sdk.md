# WP3 catalog and WP12 tooling evidence

## Implemented

- Operation drop-ins are discovered from `src/extensions/operations/`; generation produces the runtime composer, closed JSON metadata, API reference, and coverage report. A fixture test proves a temporary drop-in appears and disappears from generated projections. Catalog checks reject duplicate IDs, open schemas, incomplete policies, and effect/policy mismatch.
- The generated catalog currently contains 71 operations across 24 source drop-ins. It includes discovery/status and own-receipt reads; safe summaries and explicitly granted canonical body reads for all 17 kinds; strict character and persona identity projections, character links/history; 21 source-owned semantic draft adapters, including character variants, lorebook entries, preset blocks/groups, pack items/groups, inert regex rules, Script Sheet/Promptbook text, and tool definitions; exact-ID create/duplicate previews, draft inspect/discard/apply, trash/restore; own-package storage, settings and scene state; a bounded scoped collections read; guarded network, files, events, models and tools; and desktop-only transfer import/export previews. Generated coverage derives supported kinds, detail groups and semantic capabilities from source metadata.
- Runtime composition binds per-package storage, commit-context-bound ContentStore writes, guarded network, own-package scene state and event subscriptions from the desktop runtime owner. Semantic drafts use per-package `ChangeSession`, canonical expected-revision store writes and post-save verification. The review fingerprint binds canonical baseline/proposed entities, target/mode, composed operation IDs and warnings; apply rechecks it after host confirmation and immediately before `startApply`. Review includes every composed capability's allowlisted changes and requires each source operation to remain granted. Draft sessions are keyed by store/package/digest/policy/API/grant revision so a new run epoch does not erase a two-command preview, while a grant revision change invalidates old drafts. A browser-specific generated seam includes only browser-hosted drop-ins; Browser has source/fixture evidence, while terminal availability remains zero pending its runtime owner.
- Transfer import reads one opaque host-selected handle through nested `files.read`, validates byte length/digest and canonical parser output, then stages via nested `content.create.preview`; it does not persist or execute imported text. Export requires nested `content.read`, reads canonical content and escrow only inside a trusted exact-scope transfer adapter, serializes through existing `emitPieces`, returns a bounded fidelity report and stages bytes through nested `files.write.preview`. The guest receives no raw entity or file bytes.
- The generated guest SDK exposes typed lower-camel-case operation wrappers that all route through `bunzai.call`. It reuses the central extension error vocabulary and exposes `ExtensionCallError`; generation rejects flattened-name collisions.
- Source package check/pack share bounded path resolution and the authoritative extension/theme package validator. The source reader rejects path traversal and directory-junction escapes before file reads, supports canonical base64 binary files, and caps individual and total bytes.
- Pack output uses the shared canonical JSON digest helper. An end-to-end test builds a mixed theme+JS package, compares repeated artifact digests, previews and installs through the extension service, and verifies stored canonical package bytes and restored digest.
- `api.describe`, `api.search` and `host.features` return public host metadata with an own-package `granted` flag. Input/output schemas are bounded canonical JSON strings; offset pages are capped at 250 KB. A broker-level regression walks the full host catalog in pages and individually retrieves every descriptor.
- A fresh inspector bundle was packed after the SDK and paging changes with digest `4ef63cdb24b3e9a69c8060b9b0c6632a9be4d062a6847e4ca0aa5b095fb340d7`.

## Verification evidence

The following passed individually after the latest catalog and SDK regeneration:

- `bun test ./src/extensions/catalog/operations.test.ts`
- `bun test ./src/extensions/operations/content/summary-operations.test.ts`
- `bun test ./src/extensions/operations/content/identity-operations.test.ts`
- `bun test ./src/extensions/operations/content/summary-broker.test.ts`
- `bun test ./src/extensions/operations/content/lifecycle-broker.test.ts`
- `bun test ./src/extensions/operations/network/request.test.ts`
- `bun test ./src/extensions/operations/content/domain-reads.test.ts`
- `bun test ./src/extensions/operations/storage/operations.test.ts`
- `bun test ./scripts/extension-catalog.test.ts`
- `bun test ./scripts/extension-sdk.test.ts`
- `bun test ./scripts/extension-check.test.ts`
- `bun test ./scripts/extension-pack.test.ts`
- `bun test ./scripts/extension-package-files.test.ts`
- `bun run extensions:catalog:check`
- `bun run extensions:sdk:check`

Additional verification after scene-state and JSON-schema updates:

- `bun test src/extensions/operations/state/scene-state-operations.test.ts src/ui/server-extension-owner.test.ts`
- `bun test src/extensions/catalog/operations.test.ts src/extensions/operations/network`
- `bun run extensions:catalog:check`
- `bun run extensions:sdk:check`

Additional verification after semantic drafts, all-kind summaries, status operations and artifact decoding:

- `bun test ./src/extensions/runtime/draft-services.test.ts ./src/extensions/operations/content/semantic-draft-broker.test.ts ./src/extensions/operations/content/read.test.ts ./src/extensions/operations/api/status.test.ts`
- `bun test ./scripts/extension-pack.test.ts ./scripts/extension-check.test.ts`
- `bun run extensions:catalog:check`
- `bun run extensions:sdk:check`

Verification after canonical body reads, persona identity, the greeting semantic adapter, and lower-camel SDK generation:

- `bun test ./src/extensions/operations/content/read.test.ts ./src/extensions/runtime/draft-services.test.ts ./src/extensions/operations/content/semantic-draft-broker.test.ts ./scripts/extension-sdk.test.ts ./scripts/extension-pack.test.ts` (12 tests, 59 assertions; includes host-only create-body review)
- `bun test ./src/extensions/operations/api/status.test.ts ./src/extensions/catalog/operations.test.ts ./src/extensions/operations/content/summary-operations.test.ts` (10 tests, 27 assertions)
- `bun run capabilities:check`
- `bun run extensions:catalog:check`
- `bun run extensions:sdk:check`
- `bun run extensions:check -- src/extensions/examples/bunzai.extension.inspector --host desktop`

Settings and reserved-key verification after runtime owner composition:

- `bun test ./src/extensions/runtime/settings-services.test.ts ./src/extensions/operations/settings/operations.test.ts ./src/extensions/operations/storage/operations.test.ts ./src/ui/server-extension-owner.test.ts` (5 tests, 21 assertions)
- `bun test ./scripts/extension-pack.test.ts ./scripts/extension-sdk.test.ts` (2 tests, 18 assertions)
- `bun run extensions:catalog:check` (41 operations, 18 drop-ins at that verification point)
- `bun run extensions:sdk:check`

Latest owned tests after the root typecheck snapshot fixes:

- `bun test ./src/extensions/operations/content/read.test.ts ./src/extensions/runtime/draft-services.test.ts ./src/extensions/operations/content/semantic-draft-broker.test.ts` (10 tests, 41 assertions)
- Existing character, persona, lorebook and preset capability suites plus catalog and draft suites passed (31 tests, 109 assertions) after expanding to eight reviewed semantic adapters.
- Catalog and SDK checks pass at 45 operations across 18 drop-ins.

Verification after host-public metadata paging and model/tool drop-ins:

- `bun test ./src/extensions/operations/api/status.test.ts ./src/extensions/catalog/operations.test.ts ./scripts/extension-sdk.test.ts ./scripts/extension-pack.test.ts` (9 tests, 257 assertions)
- `bun run extensions:check -- src/extensions/examples/bunzai.extension.inspector --host desktop`
- `bun run extensions:catalog:check` (53 operations, 20 drop-ins)
- `bun run extensions:sdk:check`

Latest owned checkpoint after output-root isolation, additional semantic adapters and collections metadata read:

- `bun test ./scripts/extension-catalog.test.ts` (2 tests, 18 assertions); custom source roots fail before writing unless `--output-root` is supplied, and the temporary fixture snapshots all checked-in generated outputs across add/remove runs.
- `bun test ./scripts/extension-catalog.test.ts ./src/extensions/operations/content/semantic-draft-broker.test.ts ./src/entities/promptbook/capabilities/phase-preset.test.ts ./src/entities/scriptsheet/capabilities/instruction.test.ts ./src/entities/tool/capabilities/definition.test.ts ./src/extensions/runtime/collection-services.test.ts ./src/extensions/catalog/operations.test.ts` (14 tests, 65 assertions).
- `bun run capabilities:check`; `bun run extensions:catalog:check` (69 operations, 22 drop-ins); `bun run extensions:sdk:check` (69 wrappers).
- Collections adapter is read-only until the existing `CollectionsStore` has an atomic extension commit fence; file picker/media/clipboard/link host actions without a real gesture owner remain unavailable. No full-worktree typecheck or packaged host proof is claimed here.

The root agent owns whole-worktree typecheck checkpoints; this evidence does not claim a passing typecheck. No packaged desktop/browser runtime proof is claimed.

Latest owned checkpoint after transfer previews and immutable draft review:

- `bun test ./src/extensions/runtime/draft-services.test.ts ./src/extensions/operations/content/semantic-draft-broker.test.ts ./src/extensions/operations/transfers ./src/extensions/operations/files ./src/extensions/catalog/operations.test.ts` passed (12 tests, 70 assertions).
- `bun run extensions:catalog:check` checked 71 operations across 24 drop-ins; `bun run extensions:sdk:check` checked 71 wrappers; `bun run capabilities:check` checked 34 capability modules.
- A broker regression holds confirmation open, amends the draft, approves the old review and proves no write occurs. Another test composes two separately granted capabilities and verifies both diffs appear in review. Preview under run epoch 1 remains inspectable and applicable under run epoch 2; a changed grant revision invalidates it.
- Transfer broker tests prove nested file/content grants, canonical adapter serialization/parsing, escrow preservation, no persisted import preview, and no raw content in the export response. Desktop owner composition for formats, transfers, and asset reading is now present; packaged worker-level transfer proof and whole-worktree typecheck remain unverified here.

Latest owned checkpoint after exact transfer IDs, delegated export writes, host-action operations and regex boundary review:

- `bun run extensions:catalog:check` checked 99 operations across 36 drop-ins; `bun run extensions:sdk:check` checked 99 wrappers. Both were regenerated from source.
- `bun test ./src/extensions/catalog/operations.test.ts ./scripts/extension-catalog.test.ts ./scripts/extension-sdk.test.ts ./src/extensions/operations/content/kinds.test.ts ./src/extensions/operations/transfers` passed (11 tests, 56 assertions). Separate clipboard/link/playback/UI operation tests passed (7 tests, 31 assertions).
- `export.write` declares only `files.write.apply` as a delegate. The broker test verifies separate grants, one child host confirmation and parent/child receipt order. This is generated-operation + broker evidence, not a real worker integration test.
- Removed `regex.preview` from host diagnostics because it executed `applyRules` and `inspectSet` on the host thread. `bun test ./src/regex-doors.test.ts ./src/extensions/operations/diagnostics/operations.test.ts ./src/extensions/operations/transfers/export-write.test.ts` passed (5 tests, 13 assertions) and did not run a REDOS sample on the host. A worker-backed extension regex preview remains unavailable.
- `bun test ./scripts/extension-required-families.test.ts` remains intentionally failing: planned scene/message/turn/state-slot/prompt contribution/command/assets import+attach/macros preview/log families are incomplete, and many Terminal/Browser host requirements do not match current concrete owners. The normative matrix was not weakened.
- Runtime lead has now bound the Desktop asset, format and transfer adapters. Pocket/Terminal asset support and the public packed-export write UI path still require host-level integration proof.
- Pocket now binds the same canonical asset reader. `bun test ./src/pocket/runtime.test.ts ./src/ui/server-extension-owner.test.ts ./src/extensions/runtime/asset-services.test.ts` passed (9 tests, 51 assertions), including Browser host catalog availability and both runtime owner startup fixtures. Terminal asset composition remains unverified.
- `assets.read` now uses the shared 180 KB binary transfer ceiling instead of 700 KB, so base64 output and DTO overhead stay under `MAX_VALUE_BYTES`; its generated-catalog broker regression passes exact-limit and limit-plus-one cases (2 asset tests, 11 assertions).
- Delegated child IDs are now included in strict public operation metadata; the catalog/SDK and status paging tests pass with `export.write` exposing `files.write.apply` to permission tooling (12 tests, 461 assertions across the focused rerun).
- No whole-worktree typecheck or full-plan acceptance is claimed; those checkpoints remain under root ownership.
- The complete operation-focused test slice `bun test ./src/extensions/operations ./src/extensions/runtime/asset-services.test.ts ./src/extensions/runtime/collection-services.test.ts` passed (48 tests, 612 assertions).

Latest catalog/tooling maintenance slice (generated outputs held for the source freeze):

- Added package-scoped `logs.write`/`logs.readOwn` descriptors and host-neutral bounded `diagnostics.runtime`; the required-family gate remains unchanged pending the ExtensionStore adapter and host composition.
- Added `contracts/operation-id.ts` as the shared grammar used by catalog, grant/package/wire/confirmation/API schemas and both store budget admission implementations. Exact plan ID `logs.readOwn` is valid; malformed case/segments reject.
- Hardened bundling with Bun's static import scanner, path checks before source loading, bounded file-descriptor snapshots, and `onLoad` from the captured graph. Comment-hidden imports cannot bypass graph validation, and a post-capture source mutation cannot affect the generated bundle.
- `bun test ./scripts/extension-bundler.test.ts src/extensions/operations/logs/operations.test.ts src/extensions/contracts/operation-id.test.ts` passed (8 tests, 27 assertions). The memory/SQLite ExtensionStore additions also passed with the focused store slice (13 tests, 154 assertions).
- Logs are still unit-tested against a narrow fake port; persistent adapter, public host route, host parity, regenerated catalog/SDK/docs and whole-worktree typecheck remain pending.

Latest catalog-owner checkpoint after capability-derived field reads, inert Skill/prompt-format edits, and shared source regeneration:

- `bun run capabilities` wrote 36 source capability modules; `bun run capabilities:check` confirmed them current.
- `bun run extensions:catalog` generated 113 operations from 39 drop-ins; `bun run extensions:sdk` generated 113 wrappers. Both catalog and SDK `--check` commands pass.
- Focused operation/capability tests passed (20 tests, 78 assertions), including `readHeld` body/detail projection with large held media, draft CAS/escrow, logs, Skill and prompt-format inertness, and source-vs-catalog metadata parity. Catalog/diagnostics tests passed separately (14 tests, 58 assertions), including `macros.preview` broker confirmation-before-evaluation and the regex execution exclusion.
- Added fixed required-family entries for Skill instruction and prompt-format template draft operations. Their authored text and templates remain data; prompt-format assembly remains unimplemented. Generated metadata and the SDK now include these two capability-backed operations.
- Widened content/body/domain reads, canonical content lifecycle/drafts, scenes, settings, storage and logs to all three hosts only where the corresponding service is composed. Collections currently list desktop and terminal; Pocket has a `StateStore` but does not yet bind the collection adapter, so Browser metadata remains excluded.
- After these host metadata updates, catalog and SDK checks remain green at 113 operations /39 drop-ins; `bun test src/extensions/operations/content src/extensions/operations/scenes src/extensions/operations/collections src/extensions/operations/storage src/extensions/operations/settings` passed (23 tests, 118 assertions).
- The normative host matrix remains the owner-authorized Plan 001 baseline: Desktop requires every row; Browser requires catalog/content/collections/drafts/scene state and reads/prompts/events/assets/UI/diagnostics/storage; Terminal requires nonvisual rows except the explicitly excluded picker/UI/media-playback/clipboard/link items. Latest gate run remains red with 27 host mismatches and 25 missing fixed IDs, no duplicates, and no missing explicit capability adapters. Missing IDs include scene create/settings, take fork/navigation, message writes/composer, turn control, prompt contribution, command registration, asset import/attach, and regex preview. Unsupported hosts remain visible gaps rather than being removed from acceptance.
- This checkpoint does not claim a green whole-worktree typecheck, complete required-family coverage, host parity beyond composed adapters, or packaged release verification.

Latest owned source checkpoint after asset import/attach and all-kind held history:

- Asset definitions now include exact `assets.import.preview/apply` and `assets.attach.preview/apply`. Preview routes bytes through the source-owned character media capability; output replaces raw media data with SHA, MIME and byte count. Apply delegates only to independently granted `content.draft.apply`.
- `bun test src/extensions/operations/assets/mutation-operations.test.ts src/extensions/operations/assets/operations.test.ts src/core/media/mime.test.ts` passed before the attach extension (30 tests, 88 assertions); the updated asset mutation test then passed alone (1 test, 14 assertions), including source asset attachment, apply, spoof rejection and redacted output. Asset read remains capped at the shared 180 KB transfer limit.
- `content.history.list/read` now cover every Studio content kind. Historical field reads accept only paths derived from the existing capability exposure catalog, require both `history` and each exact field grant, project through `readVersionHeld`, and omit media bytes and original/escrow data. `bun test src/extensions/operations/content/history-operations.test.ts` passed (1 test, 7 assertions) for character and scriptsheet history, held 180 KB media, and denial without the history grant.
- Asset mutation and history source changes are not yet reflected in generated docs/SDK because engine source additions (`ui.scene.open`, `ui.editor.open`, plus worker-host changes) are still in flight. Before those additions, catalog and SDK checks passed at 118 operations /40 drop-ins. The catalog parity test currently fails only because those two newly landed UI source definitions are not yet regenerated.
- Current normative family gate remains red with 27 host mismatches and 19 missing IDs, with no duplicates and no missing semantic capability adapters. The remaining IDs are scenes.create/settings preview/apply, takes.fork, UI scene/editor navigation, composer/message writes, turn control, prompts.contribute, commands.register, and regex.preview. Host mismatches are reported against the fixed Plan 001 matrix; no acceptance rows were narrowed.
- After the engine added `ui.scene.open`, `ui.editor.open`, and the isolated-worker `regex.preview` source drops, the catalog source-parity test detects those three IDs as not yet regenerated. The current generation must be refreshed after the coordinated source-ready signal; no green generator check is claimed after this source drift. The required-family gate therefore still reports those IDs as missing from the generated catalog.
- Combined focused run after history/asset edits: 36 tests passed (122 assertions); the only failure was baked-catalog parity for the three newly added engine source IDs. `bun run capabilities:check` passed (36 modules current). Whole-worktree typecheck remains owned by the lead/root checkpoint.

Latest coordinated source-ready regeneration:

- `bun run extensions:catalog` generated 121 operations from 41 source drop-ins; `bun run extensions:sdk` generated 121 wrappers. Both `--check` commands pass.
- `bun test src/extensions/catalog/operations.test.ts` passed (6 tests, 22 assertions), including source-folder versus baked metadata parity. Focused assets/history/mime tests pass (36 tests, 122 assertions); capability generation check passes (36 modules).
- The fixed required-family gate remains intentionally red with 26 host mismatches and 16 missing operation IDs, no duplicates, and no missing semantic adapters. Missing IDs: `scenes.create`, `scenes.settings.preview`, `scenes.settings.apply`, `takes.fork`, `composer.draft.set`, `messages.send`, `messages.edit.preview`, `messages.edit.apply`, `messages.delete`, `turns.start`, `turns.continue`, `turns.regenerate`, `turns.cancel`, `turns.status`, `prompts.contribute`, and `commands.register`.
- Host gaps still required by the fixed plan: Browser/Terminal prompt inspect+transform and event subscribe+unsubscribe; Terminal models list/describe/generate/cancel/usage, transfer operations, files read/write, and network request; Browser/Terminal macros preview and regex preview. `ui.scene.open`/`ui.editor.open` are explicitly excluded for Terminal, while remaining required for Desktop and Browser.
