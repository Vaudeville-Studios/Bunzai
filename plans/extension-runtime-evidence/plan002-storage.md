# Plan 002 storage implementation evidence

Status: implementation and host/Core boundary reviewed in the isolated worktree; host changes remain uncommitted. The reviewed RP-Core commits are published on the authorized Vaudeville-Studios fork branch `feature/rp-core-extension-integration` at `9cce0552df233c7185329d9cfc5473be67e2e821`; the parent Bunzai branch has not been pushed. Static Pages Browser compatibility was exercised against the current source. No Desktop packaged claim.

## Owners and contract

- `stage/contracts/core-record-store.ts` defines the scoped journal and projection contract. `ExtensionCommitContext.invocationId` carries the existing broker receipt ID; Core requires it to equal `target.operationId`.
- `sqlite/core-record-authority.ts` snapshots invocation authority and checks current grants, runtime fence, cancellation, exact active scene/take/session link and optional initial journal CAS inside each domain-write transaction. A scene grant does not invent a take grant; an explicitly resolved take must match. Turn writes require `turn.run`, `model.prompt` and a reviewed host-connection resource.
- `sqlite/core-record-store.ts` fences `create`, `append` and `link`. Core lease cleanup remains independent of revoked extension grants. Scoped writers cannot invoke privileged repair writes.
- Migration 52 adds committed-operation/cursor records, exact Core-message to UI-message/swipe identities, and a bounded scene-birth binding. Existing migrations 1 through 51 retain their SQL.
- Extension Core births originate from the same fenced ChatStore creation receipt, actual chat/take and sealed frozen cast IDs/versions. `pendingCreation(sceneId)` discovers a committed header even with zero journal entries and no link; `recoverCreation(operationId)` finishes only its proven link after revocation.
- Host/Core ownership begins atomically in `ChatStore.createCoreChat`: one sealed `origin: host` birth marker is inserted with the scene and branch, before the row can appear in extension library listings. `/api/chats/start` uses this path only when the Core store is configured; its scoped Core store commits the initial header, host operation proof and scene link together. A crash before that Core commit leaves a durable unlinked birth that all legacy HTTP writers refuse; recovery links only a durable accepted Core creation, never replays an unaccepted create. Ordinary `createChat(..., commit)` remains the explicit legacy path and does not acquire a Core marker. Core-capable extension creation uses `createCoreChat(..., commit)` with `origin: extension`; Browser/Pocket's explicit no-Core path stays legacy.
- `pendingProjection`, `projectionEntries` and `hostProjection` expose committed durable data for host recovery without re-executing a guest request. `projectionEntries` streams one row at a time and rejects a changed operation snapshot. Journal sequence is not the vendor's message-only session version.
- `ChatStore.projectCoreMessage(s)` inserts or repairs messages and commits exact mappings in one SQLite transaction. Batch inputs use one base branch version. Existing append, add-swipe and edit-swipe owners remain authoritative; no duplicate message SQL was introduced. Mapping includes the exact swipe ID, including identical-text Core siblings sharing one UI message.
- `linkMessages(inputs, expectedVersion)` atomically bootstraps existing identities only at the exact active take revision. The Studio owner must first validate the complete vendor-visible path and historical swipe fidelity. Unknown or unrepresentable histories must remain refused.
- `markProjected` validates the committed operation/link/sequence bounds. Its trusted caller must reconcile the complete vendor-visible path before acknowledging that cursor; storage does not implement a second vendor path fold.

## Evidence

`bun test ./src/stage/store/sqlite/core-record-authority.test.ts ./src/stage/store/sqlite/core-record-store.test.ts ./src/stage/store/sqlite/migrations.upgrade.test.ts`

- Stable checkpoint: 36 passed, 145 assertions before the swipe foreign-key regression. After that correction, the new storage file passed 12 tests and 60 assertions.
- Covers held SQL append followed by actual control revocation; no journal write and usable lease cleanup; committed recovery after revocation; atomic projection rollback; immutable target/link checks; cancellation; exact identity batches and stale revisions; identical-text swipe siblings and continued-history replay; zero-entry scene birth recovery; actual encrypted version51 upgrade; snapshot restore of cursor and mappings.

`bun test ./src/stage/store/chat-store.sqlite.test.ts -t 'swipe|edit'`

- 60 passed, 245 assertions, including existing edit history, fork isolation, removed swipe refusal and transaction rollback contracts after extracting synchronous owners.

Meaningful mutation RED/GREEN, with exact task-owned source restored afterward:

1. Omit only the transaction-local live grant check: held append commits after revocation and the public storage regression fails. Restore: passes.
2. Remove the projection transaction: a bad second batch item leaves the greeting persisted, and the atomic batch regression fails. Restore: passes.
3. Continue the first UI swipe instead of the mapped swipe: identical-text sibling regression fails on the committed identity check. Restore: passes.

Independent root review identified that exact swipe identity also needs deletion integrity. The regression hard-deleted one of two identical-text UI swipes: its mapping initially remained and the assertion failed. Migration52 now records the actual swipe position and uses the existing composite swipe primary key with `ON DELETE CASCADE`. The regression passes: only the deleted swipe's Core mapping disappears, while its sibling mapping remains.

The initial new API regression failed because `forExtension` did not exist. This is API-gap evidence, not proof of an existing preimplementation security assertion. The fence mutation above supplies that behavioral evidence.

Health scan: 37 passed, two scene-state tests exceeded the default five-second test deadline and were cancelled. Retrying only those two with `--timeout 15000` passed, ten assertions. No assertion changed.

The pre-health-check snapshot fixture originally retained migration52 tables while deleting its migration records. Actual older-snapshot restore failed with `table core_scene_creation_bindings already exists`. Updating that fixture to remove the three new tables restored its intended old schema: older restore passed (five assertions), and health-adoption restore passed (seven assertions).

## Pending review and limits

- Root approved the exact migration-52 storage shape pin `f1706f2b902d1e801429927ee4b7af908e70977950bca036a3e4338aded9ee06` after reviewing host and extension birth authority, operation/ordinal state, projection identities, and restore/fingerprint/health inventories. The migration is additive; migrations 1-51 retain their SQL and older hosts refuse the unknown schema before writing. The current tripwire passes (1 test, 2 assertions).
- ESLint does not configure stage files: the targeted invocation reported twelve ignored-file warnings; that is not lint verification.
- Concurrent full typechecks observed in-flight caller and fixture diagnostics. The two storage fixture readonly-array diagnostics were corrected; final aggregate typecheck belongs to reconciliation.
- Line-cap and stage-boundary scans passed; the latter checked 5,221 files. `git diff --check` passed at the stable checkpoint.
- No self-approval of this migration, security boundary, semantic summaries or release evidence.

## Host-birth addition (2026-10-31)

The first-party host had the same create-before-Core-header visibility window as extension scene creation. The public-boundary regression now pauses the actual `/api/chats/start` request at RP-Core header persistence after atomic host-birth commit. While paused, the real QuickJS extension lists the scene and attempts `messages.send`; it receives `UNSUPPORTED_HOST` and no legacy transcript is written. Resuming the request commits and links the Core header. The HTTP birth-guard test also verifies that take-only mutations and Core settings reject an unlinked host birth while the non-destructive empty-scene delete remains available.

The stable combined storage, vendor, and Core/extension checkpoint passed 49 tests and 297 assertions; `bun run typecheck` exited 0. After extracting Core start/send routes from `server-chats.ts`, targeted reruns passed: Core extension/birth/QuickJS 3 tests and 68 assertions, shutdown and greeting repair 2 tests and 16 assertions, and typecheck 0. `scan:lines` is clean. A fresh `bun run build:pages` and `bun run extensions:pocket-browser` passed; the Browser fixture verified the opaque host boundary and zero external requests. No Desktop packaged proof is claimed.
