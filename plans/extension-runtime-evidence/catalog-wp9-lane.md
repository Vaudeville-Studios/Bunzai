# Catalog and WP9 follow-on evidence

Snapshot date: 2026-10-31. This note records scoped implementation checks, not release approval.

## Turn follow-on access

The turn operation resolves no background write authority when `followOn` is omitted or false. Selecting automatic summary adds only its two summary fields. Selecting compendium adds receipt and lore-entry fields plus only the named lorebook resources. Turn review rejects a selected book outside the configured writable set. Native summary writes were exercised against both Memory and SQLite stores with grant revocation during the provider call; stale output was not saved. The compendium fixture showed that a one-book scope reads no other lorebook.

Commands:

```text
bun test ./src/extensions/operations/turns/operations.test.ts ./src/studio/compendium-extension-scope.test.ts ./src/studio/scene-summary-extension-commit.test.ts
bun test ./src/studio/scene-summary.test.ts
bun test ./src/studio/compendium-hooks.test.ts ./src/studio/compendium-historian.test.ts
```

Results: 5 passed / 18 assertions in the combined broker/scope/revocation run; 62 passed / 176 assertions for summary behavior; 29 passed / 82 assertions for compendium hooks and historian behavior.

## Generation and acceptance

At the source snapshot before the latest state-write contract edit, catalog generation produced 137 operations from 47 drop-ins. Catalog and SDK checks passed; catalog/SDK/bundler tests passed 7 tests / 35 assertions; package tests passed 5 tests / 45 assertions. Lead subsequently changed `state.write.preview/apply` schemas to identify one message or turn and return `pending` for checkpoint appends. Regenerate the catalog, SDK and docs after the lead's shared typecheck/source-ready notice.

The fixed required-family test currently reports five missing Terminal turn operations: `turns.start`, `turns.continue`, `turns.regenerate`, `turns.cancel`, and `turns.status`. Terminal `composer.draft.set` is explicitly excluded because that host has no scene-bound composer owner; its global agent input is a separate control. No other required host was removed to match present support.

## Macro-preview documentation review

Root approved the ADR-015 summary for the narrow macro-preview caller decision and source-summary accuracy, with no packaged WebView, broader runtime, or release approval. Source hash: `sha256:3ed11e9758fa7bb370e25ddf9fdaee2f5b1f3466841f9d5bb59d62330b9293e`. Root's scoped review receipt is in `docs/summary-reviews/decisions/ADR-015-extension-runtime.json`.

## Documentation handoff

Current reviewed summaries:

- `docs/summaries/reference/extending/quickstart.json`: approved by root for documentation accuracy and the tested pack/worker contract; source hash `sha256:30360456b86f0d9e4b2854509a8debb626b33b12cc7f93bc2a4e7f2e65f628e1`.
- `docs/summaries/reference/extending/file-reader-test.json`: approved by root for documentation accuracy and the tested pack/worker contract; source hash `sha256:30dd153ac25d07d441f734b7fa2dab98b5c6e14f1826bfe2128eea8f581bc75d`. Packaged WebView behavior remains unverified.
- `docs/summaries/decisions/ADR-015-extension-runtime.json`: approved by root for the narrow caller decision and source-summary accuracy; source hash recorded above.

Pending review:

- `docs/summaries/decisions/ADR-012-macro-evaluation-boundary.json`: author-valid after adding the ADR-015 fifth-caller summary; source hash `sha256:229625718d9b32c04e35135c7307652b092679f7b10947e12f400835ebb3ced9`; approval was invalidated by the source update and needs a new independent receipt.
- Generated API: `sha256:e14533dc5100eee0c6a45802a5271cd3cb91daab321985fb2c9e8ee2b5b3ada1`.
- Generated coverage: `sha256:0928036b29a4407fb85dd77e0f3f4804ea13676899901eee7cee094d8be70de9`.
- Generated SDK: `sha256:047bea4676e995f63e3d909fc49fecd8c8210a7dbee0ec9a44a65c7f0fecc204`.

The generated API, coverage and SDK files and their author-valid sidecars reflect the 137-operation snapshot. Lead subsequently changed the state-write input/output contract, so regenerate those files and restamp/review their sidecars after the shared contract and TSC checkpoint freeze. The docs index currently reports 10 incomplete pages; summary and index gates therefore remain red by design.

## Terminal turn composition checkpoint (2026-10-31)

The Terminal owner now composes `createExtensionTurnServices` with the same `RoleplayCore` built by `createSceneCore`, the canonical `ChatStore`, the saved provider resolver in production, and a Terminal-only facade for `scene-turn.regex` that runs the existing bounded regex Worker directly. There is no second turn loop or UI-ticket dependency. All five `turns.start`, `turns.continue`, `turns.regenerate`, `turns.cancel`, and `turns.status` descriptors now declare `desktop` and `terminal`; `composer.draft.set` remains desktop/browser only under the recorded scene-composer ownership correction.

The Terminal integration fixtures use in-memory fenced stores, a fake provider, and a computed `providerConfigFingerprint` carried both by the fake reader and the fake `Connected` result. They prove an approved QuickJS command sends exactly one request, commits the assistant reply through ChatStore, and exercises the scene regex gate through the isolated Terminal Worker. A second QuickJS command reads the same package's running turn and cancels it; the turn resolves as stopped. No vault credential or paid provider is used. These are unit/integration proofs of the Terminal owner path, not packaged-release verification.

Focused verification:

```text
bun test ./src/kit/extensions/owner.test.ts ./src/kit/extensions/regex-preview.test.ts
```

Result: 11 tests passed / 40 assertions. Catalog and SDK generation each emitted 137 operations; their `--check` commands pass. `scripts/extension-required-families.test.ts` passes (7 assertions), including the required Terminal turn rows. No whole-tree typecheck was run by this lane; lead was asked to run it after this freeze.

Current generated reference hashes:

- API JSON: `sha256:C92BE59280DF3E74E83F78377ABDE30A44812195B5CB91E807E830EC091B4C6C`
- Coverage: `sha256:A7A5D1AEDF26C12B4A7617BD12BD187FE48C555C4C5A5AD2D4E6F11ACD4D8D03`
- SDK: `sha256:047BEA4676E995F63E3D909FC49FECD8C8210A7DBEE0EC9A44A65C7F0FECC204`

Implementation snapshot hashes:

- Terminal owner: `sha256:BB409B967CBF4FDD10366D6DEB5024F92F064868A3969D2685D39C5A777F1BFE`
- Turn descriptors: `sha256:18FFC0D06D7E718DFCD16DBA55040E0342A2D0E39F5C8BA157A64B40C881C739`
- Terminal owner integration tests: `sha256:35EAA048FA2EEDE09B5349E46DDD18E7E91E2FB415F4CB0BE1D59AE38B26A03F`

## Host-selected invocation context (2026-10-31)

The activation route accepts a strict `hostContext` separately from guest `input`. The runtime snapshots at most 16 unique `{kind,id}` refs for the activation; the broker filters the snapshot against each current operation grant and exposes only that intersection as `context.invocation.resources`. `content.list` and `content.search` accept `scope: {type:"invocation"}` to query that narrowed set. The Library menu uses staged refs and Workbench uses its active pane; no global selection authority was introduced. More than 16 refs disables the command with an actionable message and sends no activation. Terminal has no current-resource context or `--on` selector; Terminal commands must provide explicit resource selectors where their operation supports them, with exact grants still enforced.

Focused verification:

```text
bun test ./src/ui/extensions/host-command-menu.test.tsx ./src/extensions/contracts/invocation-context.test.ts ./src/extensions/operations/content/summary-operations.test.ts ./src/ui/extensions/api-client.test.ts ./src/ui/server-extension-runtime.test.ts
bun test ./src/extensions/operations/commands/register.test.ts ./src/extensions/operations/events/subscription-operations.test.ts ./src/extensions/operations/network/request.test.ts ./src/extensions/operations/prompts/operations.test.ts ./src/extensions/operations/scenes/operations.test.ts ./src/extensions/operations/settings/operations.test.ts ./src/extensions/operations/state/scene-state-operations.test.ts
bun test ./src/sandbox/javascript/engine.test.ts ./src/sandbox/javascript/run-in-worker.test.ts ./scripts/extension-sdk.test.ts
bun run extensions:catalog:check
bun run extensions:sdk:check
bun test ./scripts/extension-required-families.test.ts
```

Results: 17 tests / 56 assertions passed across the host-context, DTO, selector, client and route run; the seven affected operation fixture suites passed 19 tests / 76 assertions; the QuickJS/worker/SDK run passed 24 tests / 48 assertions. Catalog check passed for 137 operations / 47 drop-ins; SDK check passed for 137 wrappers; required-family test passed 7 assertions. The component test confirms refs remain separate from guest input and over-limit refs are rejected without truncation. The SDK declarations expose `bunzai.context.invocation.resources` as a readonly array; the real QuickJS engine test verifies the frozen host-selected refs. Lead's fresh whole-tree typecheck passed before the SDK declaration-only change; a rerun was requested after the generator template edit.

Source hashes:

- Invocation DTO: `sha256:A23FD16FD9F5FFAA65FBD9B8C5E055F74BF03D5DDDE98BD87F75F3F48FB1B1CC`
- Content list/search selectors: `sha256:B47B33EC108105E08DE5D429C1A9E9A4563847F09DC635EDC912062CFEF31166`
- Host command menu: `sha256:6A964E6C72731C9EFFEEED0A397E6DFE3A16F325D380A29E2B2E12EB6CFE6A61`
- Host command menu test: `sha256:B186FD598DDEA83BA69CA711561DCE68ED053D4C6E5E8009455C8D016C7FAEBD`
- Generated API JSON: `sha256:E0B77B4D754FEFEC5388AEE7441C95626D01F621B6C617A9F88EADE497839276`
- Generated coverage: `sha256:A7A5D1AEDF26C12B4A7617BD12BD187FE48C555C4C5A5AD2D4E6F11ACD4D8D03`
- Generated SDK entry: `sha256:815B89A8F2464C8E29740597F5616EFF27252AF4A51632201F4C80008FA23D53`
- Generated SDK reference: `sha256:BBBB6FF03E5DFE1855BBD75007388E2A4511086C94DC7FC487D08CD917608468`
