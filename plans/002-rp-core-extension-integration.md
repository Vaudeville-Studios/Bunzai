# Plan 002: Connect extensions to the existing RP-Core scene engine

## Status and execution contract

- Priority P1; effort XL; risk HIGH; category integration/security.
- Planned against Bunzai `7588d4bf5c835b4a2176e3ebaf1843f9f5006c66`, 2026-10-31.
- Pinned external engine: `vendor/rp-core` at `b0b6761297fa27146c4fab6a285bad8e5bad1c1c`.
- Depends on plan 001, merged as `9c6063c5` with evidence follow-up `7588d4bf`.
- User explicitly requested this plan and execution. Preserve the separate RP-Core repository and current landing. This is host integration, not another engine replacement or copying the vendor into Bunzai.
- Reviewer maintains the index. Executor edits source in a new isolated worktree and reports evidence. No Mainstage push or public deployment until review; existing authorization is sufficient after approval, with the user's prior no-full-suite/no-verify delivery preference retained. Do not change hook configuration.

Drift check first: compare HEAD and origin/Mainstage with the planned SHA, inspect status and submodule status, then compare the symbols below. Keep the original dirty Bunraku-publish checkout and the abandoned Bunzai-mainstage-delivery merge untouched. Create `C:\Users\chiev\Documents\Bunzai-rp-core-extensions-20261031`, branch `feature/rp-core-extension-integration`, from the current published source. If another author advanced Mainstage, reconcile changed owners before editing.

## User-visible outcome

An extension using an authorized scene can contribute to the actual RP-Core prompt, receive its lifecycle events, preview that same prompt locally, and run/cancel/inspect its own bounded turns. Transcript writes use the RP-Core journal and recover the UI projection. Package-owned extension state remains scoped to exact scenes, takes, messages and owned turns. Revocation or cancellation prevents later writes and provider calls. Legacy scenes and memory-only Browser Studio continue to work.

Do not achieve parity by deleting ownership guards. Every newly enabled operation must have a working authoritative adapter, exact version semantics and a public-boundary test. Differences that cannot be represented faithfully must remain explicit in descriptor-owned availability notes, with the actual implemented subset documented. Complete all representable integration work; bring incompatible contracts back to the reviewer with concrete source evidence rather than silently faking or dropping functionality.

## Current owners and source facts

1. `src/studio/core-scene.ts` owns `createCoreSceneSession`, `openCoreScene`, `sendCoreScene`, `checkCoreProjection`, `reconcileCoreScene` and provider construction. `openCoreScene` currently opens an Engine with no host hooks. `connectionFor` resolves saved credentials and guarded transport, supports OpenAI-chat and native Ollama, and explicitly refuses other native adapters. Reuse that boundary; guests never receive credentials or a provider object.
2. `src/ui/server-chats-turn.ts` owns private `coreStream`, `ownedCoreStream`, `coreMessage`, and a per-ChatStore WeakMap of running Core sessions. Linked scenes use this path. Legacy `stream` alone receives extension callbacks. The Core stream currently projects only terminal messages and does not dispatch extension events. Extract shared Core execution/projection ownership into Studio modules before adapting Terminal; do not copy the HTTP engine into another runtime.
3. `src/extensions/runtime/turn-services.ts` owns exact connection-fingerprint review, request/output budgets, own-package cancellation/status and the legacy `RoleplayCore` adapter. Its first actions call `assertExtensionSceneNotCore`. Preserve its public contract and authority checks while routing linked scenes through the shared Core owner.
4. `src/extensions/runtime/prompt-hooks.ts` owns manifest-declared contributors, required/optional behavior, grant rechecks, candidate/output limits and the accepted strings. `service-prompts.ts` owns local preview and applies contributions once. `src/studio/scene-turn-prompts.ts:appendExtensionPrompts` inserts a distinct system message after the last system message. Reuse the semantics; do not flatten or overwrite unrelated multimodal/tool content.
5. Vendor public `HostHooks` in `vendor/rp-core/src/engine/hooks.ts` has `beforeAssemble`, `transformRequest` and `transformReply`. `transformRequest` currently returns index/text edits only; it does not append messages. `beforeAssemble` errors are not fail-closed. Required extension failures must prevent provider egress. Decide a faithful supported integration at the host/provider boundary, or propose the smallest vendor contract amendment before touching that repository. Do not claim appending an extension prompt is equivalent to overwriting another message.
6. `src/extensions/contracts/events.ts` owns value-only lifecycle metadata and projection. Payloads deliberately omit prompt, reply and provider data. `src/studio/scene-turn-events.ts` owns the host TurnEvent vocabulary. Map Core events through these owners rather than introducing a second event inventory.
7. `src/stage/store/sqlite/core-record-store.ts` owns `CoreSceneRecords`, encrypted Core journals, Core leases and links. Its `create/append/link` transactions currently do not check extension commits. `src/stage/store/sqlite/extension-commit-guard.ts:requireExtensionCommit` is the existing authority check that must run INSIDE each domain-write transaction.
8. Vendor `RecordSessionStore` queues journal writes. `AsyncSessionHandle` flushes them after operations. Never await a session mutation while holding a StageDatabase transaction. A failed queued append can leave the invocation's in-memory mirror ahead of disk: close/discard it. An immutable invocation-scoped record-store wrapper is appropriate; ambient mutable commit context on a shared store is not.
9. `src/extensions/runtime/scene-services.ts` owns scoped reads and writes. Mutators currently refuse linked scenes and then use ChatStore. `scene-state-services.ts` reads/writes `ext:<package>:` slots through fenced ChatStore doors. `scene-settings.ts` contracts distinguish exact selectors and revisions. These cannot be made Core-compatible by simply removing a guard.
10. Vendor SessionHandle supports send, edit, hide, select, fork, configure and preview. `hide` is not necessarily Bunzai cut-one deletion; `fork` creates a new session, not a same-chat take; configure does not advance session.version. No public API currently models extension-owned pending state deltas. Prove mappings or retain precise refusals. Do not write forged vendor journal entries.
11. Migration 47 owns Core sessions/entries/scene links. Migrations 48-51 own extensions. Preserve all shipped SQL. A new migration 52 or later may add durable take/message identity mapping or recoverable operation records; update snapshot inventory, fingerprints and the version-aware tripwire honestly.
12. Host composition is `src/ui/server-extension-owner.ts`, `src/ui/server-scene-composition.ts`, `src/ui/server.ts`, `src/kit/extensions/owner.ts`, `src/kit/index.tsx`, and `src/pocket/extension-owner.ts`. Desktop/Terminal use actual open-library Core records, Browser explicitly has none. Preserve fail-closed missing-owner behavior and store identity isolation.
13. Operation source descriptors own availability: `src/extensions/operations/scenes`, `state`, `turns`, and `src/extensions/contracts/operation.ts`. Catalog/SDK/docs are generated. Never add an operation-ID compatibility registry to a generator.

Read AGENTS.md, SECURITY.md, docs/01-VISION.md, docs/02-ARCHITECTURE.md, docs/03-CONVENTIONS.md, CONTRIBUTING.md, HELPERS.md, docs/decisions/ADR-014 through ADR-016 and the relevant UI/architecture references. ADR-014's later amendment documents the actual external journal split; retain that architecture while reconciling extension support. Domain cores stay framework-independent. Each authored file is at most 500 lines.

## Scope

In scope: the owning modules above and their direct contract/caller tests; new focused Studio Core execution/prompt/projection modules; Core storage contracts/SQLite implementation, append-only migrations and snapshot/fingerprint tests; extension adapter contracts, operation metadata and generated catalogs; host compositions and lifecycle/shutdown tests; affected documentation, semantic summaries and plan evidence. UI changes are limited to truthful compatibility/error/status presentation if needed, using existing controls/tokens.

Out of scope: visual landing changes, RP-Core replacement/subsumption, unrelated provider/format feature ports, automatic migration of old user scenes, paid model calls, real libraries/vaults, test harness reduction/deletion, full-suite/CI redesign, dependency additions without a demonstrated need, publishing an upstream vendor commit without explicit destination authorization. Any vendor change requires prior reviewer approval of exact API purpose and a separate local vendor commit; never leave an uncommitted dirty gitlink as a deliverable.

## Implementation sequence

### 1. Reproduce the public gap and pin compatibility decisions

Use the real temporary SQLite library pattern in `src/kit/extensions/core-scene-guard.integration.test.ts`, actual QuickJS package activation, broker grants and effect answers. Add a focused linked-Core fixture with a scripted provider and no network. Demonstrate RED: authorized contribution missing from actual Core request, lifecycle event missing, and Core turn/mutation refused. Keep negative guard tests for missing ownership, unknown target, revoked scope and cross-store IDs. Record the exact failing command/output under plans evidence. Do not weaken the old tests to call refusals success.

Write a compact operation-by-operation mapping table in evidence before implementation: authoritative engine verb, Core/UI version mapping, durable state owner, exact resource checks, projection recovery, and supported host. Classify existing documentation promises IMPLEMENT/REWRITE/RETAIN. Reviewer decides genuine contract incompatibilities promptly; this table is design evidence, not another runtime registry.

### 2. Establish journal and projection commit authority

Extend the host Core storage boundary with an immutable invocation-scoped ExtensionCommitContext. Validate requireExtensionCommit inside the same SQLite transaction as each create/append/link and any Core mapping write. Restrict exact scene/session/take/message ownership in the trusted adapter, not guest-provided IDs. Keep acquire/renew/release cleanup independent of a revoked extension's domain-write grants; every lease mutation still checks its Core lease owner.

Persist stable Core-to-UI message/take identities where existing immutable IDs cannot be reused. Avoid matching repeated text or assuming paths always have the same positions. Reconciliation must handle supported edits/swipes, committed journal tails, restart after a projection failure and repeated replay without duplicate messages. Journal success followed by projection failure is recoverable/ambiguous, never falsely rolled back or denied. Do not let a stale projection overwrite Core. Ensure ignored journal writes after revocation cannot be rescued by later first-party cleanup with ambient privilege.

Authority clarification: persist an operation/commit identity or equivalent projection cursor atomically with an accepted journal write. Once that write is durably authorized, trusted host reconciliation may repair its derived projection even after the original grant is revoked. That repair must derive solely from proven committed journal data, not re-execute the extension's requested action, accept a failed queued append, or require a now-revoked grant. Separate a fenced proposed mutation from idempotent restoration of an already-authoritative result, and test revoke between journal commit and projection.

Add only necessary append-only schema, update backup classifications and tripwire with reviewer-approved pin. Test old version51 database upgrade and restore with actual encrypted Core records and extension controls preserved. Existing migrations remain byte-for-byte unchanged.

### 3. Share the Core host execution owner

Move reusable execution, per-store active ownership, event projection, stop/review and terminal projection out of the HTTP private functions. HTTP becomes an SSE adapter over the same owner used by extensions. Reuse sceneRuntimeFor/runOwnedTurn shutdown admission where applicable. One running turn has one owner and one terminal event; consumer detach does not invent cancellation, while explicit package cancellation/revocation does stop owned execution.

Preserve first-party Core request behavior, existing legacy routes, review gates and library shutdown semantics. Tests with colliding IDs in two libraries must remain isolated. A package cannot inspect/cancel a first-party or another package's turn. Host shutdown waits for accepted work, releases leases and admits no later operation.

### 4. Connect prompts, events and truthful local preview

Recon confirms the current vendor API cannot represent the required append-and-inspect behavior faithfully. Reviewer authorizes a minimal, separately committed local vendor API amendment for this step: bounded append-only system contributions before final assembly/shaping and trace accounting, fail-closed async cancellation/timeout behavior, a read-only async preview using the same assembly path (preserve the existing synchronous preview API), and a trusted per-provider-request guard covering primary/fallback/retry paths. Reuse the engine's existing placement, shape, request and hook machinery rather than writing a second assembler. The callback receives value-only prompt data and an explicit signal, never host ambient authority. No-hook behavior must be unchanged. This is approval to implement and test a local vendor change, not authorization to publish to LeviTheWeasel's repository. Before any host release pin requires an unpublished vendor commit, prepare a concrete reviewable vendor commit and identify a usable authorized publication destination; never push a dangling gitlink.

Adapt the current prompt runtime to the actual Core request at the final safe preparation boundary. Preserve distinct system-message insertion and final shaping/token accounting. Required hook failure, cancellation, stale grant or over-budget output fails closed before egress. Optional failure follows the existing runtime policy. Each candidate is applied once; no double invocation from preview wrappers or the provider path. Preserve non-text blocks/tools or explicitly refuse a request that cannot be faithfully adapted; never silently drop them.

Use Core preview without calling a provider or writing configuration/journal rows. A typed temporary draft may be represented only by an engine-supported preview mechanism, not a persisted fake send. Explain the preview limitations truthfully and reuse the extension manager's output schema.

Do not call existing openCoreScene for preview: it configures the narrator and opening a session may recover unfinished turns. Use a genuinely read-only snapshot/session preview path. Instrument the actual RecordStore in the preview fixture and assert zero create/append/link, including a journal with an abandoned turn, not merely the simple empty scene. Normal lease reads/cleanup do not make a journal mutation acceptable. A snapshot must be revision-checked to avoid advertising a preview of another state as current.

Emit existing bounded lifecycle events for Core first-party and extension-owned turns, once and in the actual lifecycle order. Do not dispatch completion before committed projection/recoverable result is known. Event hooks do not gain prompt-read or provider authority. Verify scene.opened stays on the existing host navigation boundary.

### 5. Route bounded extension turns to Core

Retain exact reviewed saved connection/model/fingerprint, one package's turn ownership, cancellation, expected UI revision and Core version checks. Apply provider request-count, final serialized prompt-byte, token/output and cancellation budgets to EVERY actual call and retry, not just an initial nominal request. Respect existing constants and budget owner instead of reimplementing their values. No tools, Director calls, Compendium writes, shared globals or extra model traffic may be inherited implicitly by an extension-owned turn. Explicit follow-on options require a faithful, scoped mapping; otherwise refuse those options before the first provider call.

Check live authorization immediately before provider egress AND inside journal/projection writes. Abort linked signals on revoke/disable/runtime replacement. Hold/revoke/release tests must prove zero late egress and zero unauthorized commit. Preserve honest effect receipt statuses: known writes committed, uncertain admitted effects ambiguous, never denied merely because a late error is UNSUPPORTED_HOST.

### 6. Enable faithful scene, transcript, state and settings operations

Route create/send/edit through shared engine verbs and recoverable projection after version/scope checks. Enable deletion or take forks only when exact public contract is preserved, including historical swipes, names, branch ownership, output IDs and recovery. Same-chat takes may require a durable per-take Core session mapping; do not duplicate an entire logical scene or relabel another session as a take without that contract. Scene creation must produce a linked Core scene before reporting success and must recover or explicitly clean an incomplete stage.

For package-owned extension state, retain one authoritative state model and namespace isolation. Bind each applied delta to an exact canonical committed message; pending deltas bind to the same owned reply/regenerate turn and apply once, or are discarded on failure/stop according to the current contract. They must not leak into continue/first-party/another package's turn. Do not pretend host extension metadata is native Core narrative state. If a missing public engine hook prevents faithful pending-delta commit, propose the minimal explicit upstream contract rather than direct journal fabrication.

Settings must affect the next actual Core turn or truthful host-only presentation. Reuse existing revision hashing and exact selector schemas; configure's unchanged version alone is insufficient. Keep unsupported legacy-only preset/lore/regex/tracker selectors explicit until their actual Core adapters exist. Remove blanket Core refusal only as each implemented operation becomes proven. Update descriptor-owned notes to describe the exact remaining selector/engine limitations, regenerate all projections, and retain fail-closed unknown-owner guards.

### 7. Consolidate, verify and review

Remove superseded Core-specific glue and duplicate logic after callers use the shared owner. Keep legacy adapters required by old scenes and Browser; no automatic old-scene conversion. Update ADR-014/016 and extending API/coverage/SDK docs with implemented truth and exact limitations. Have another reviewer approve authored semantic summaries. Record current versus historical artifact proof separately.

Run the commands below with no real providers or user data. Use a fresh running server/Browser fixture to exercise a real extension install/grant, Core scene prompt contribution, lifecycle event, owned turn/status/cancel and a supported mutation visible after reload. Verify legacy and Browser smoke. If native executable proof is not refreshed, state that plainly and do not call source tests packaged proof.

## Commands and acceptance

- Install in the isolated worktree: `bun install --frozen-lockfile`; initialize the already-pinned submodule, never update it opportunistically.
- `bun run typecheck` must exit0 after final source changes.
- Focused base: `bun test ./src/kit/extensions/core-scene-guard.integration.test.ts ./src/extensions/runtime/turn-services.test.ts ./src/extensions/runtime/prompt-hooks.test.ts ./src/extensions/broker/invoke.test.ts ./src/extensions/catalog/operations.test.ts`.
- Core host base: `bun test ./src/ui/server-chats-core-lease.test.ts ./src/ui/server-chats-core-shutdown.test.ts ./src/ui/server-chats-turn.test.ts ./src/stage/store/sqlite/migrations.upgrade.test.ts ./src/ui/switch/storage-shape-tripwire.test.ts`.
- Add explicit commands for newly created Core adapter/storage/integration test files to evidence. These are required, not optional because the base list predates them.
- Catalogs: `bun run extensions:catalog:check`, `bun run extensions:sdk:check`, `bun test ./scripts/extension-required-families.test.ts`.
- Structure: `bun run scan:lines`, `bun run scan:boundaries`, `bun run lint:ui`, `git diff --check`; generated docs/checks and semantic review must pass. Preserve warnings instead of hiding them.
- Build/Browser: `bun run build:pages`, `bun run extensions:pocket-browser`; test current built output with an isolated native-host HTTP fixture as well, since Browser has no RP-Core owner.
- No 16k full-suite, no unrelated harness deletion or suite reduction. Historical whole-suite evidence does not certify this candidate.

Required RED/GREEN coverage: actual provider request includes exact authorized candidate once; required hook failure zero egress; full lifecycle order without content leaks; two stores/colliding IDs; own-package stop/status isolation; stale version/model/fingerprint; every retry budgeted; revoke while hook/provider/journal persistence is paused; cancelled invocation no late append; first-party success without extension authority; immutable pending state ownership; repeated crash recovery no duplicates; unknown Core owner denial; encrypted upgrade/restore; cleanup after rejected writes. Use deterministic test clocks/scripted providers and throwaway roots. Mutation-RED checks must demonstrate that removing the commit fence/prompt bridge makes the meaningful public regression fail, then restore exact task-owned files.

## Done criteria and handoff

All enabled operations work through real public broker/QuickJS and Core persistence boundaries; final TypeScript and focused checks pass; independent adversarial reviewer accepts runtime/commit/projection boundaries; running UI proves the user-visible flow; metadata, docs and summaries match implementation; no unrelated or dirty vendor edits; isolated branch commits are reviewable. Produce exact source commit, worktree, changed owners, tests, artifact scope and remaining limitations. Root approval precedes Mainstage delivery.

## Stop conditions and maintenance

Report to root immediately for a mismatched engine contract, missing safe persistence fence, required vendor API change, unrepresentable operation semantics, failed compatibility regression or necessary out-of-scope changes. Root resolves or revises this plan; do not improvise fake success or stop all independent useful work. Do not publish to upstream, introduce credentials, test against real home, change old migrations, or hide failed checks. Future RP-Core updates must rerun host contract tests against the pinned API; catalog availability must continue to derive from descriptors and exact behavior, not an independent permission list.
