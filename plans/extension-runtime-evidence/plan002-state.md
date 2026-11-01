# Plan 002 package-owned Core state evidence

Status: implemented in the isolated worktree, awaiting independent review of this state slice. Prior storage approval does not approve these additions. No commit, push, live UI, real model or packaged claim.

## Ownership and lifecycle

Canonical extension scene metadata remains in the existing ChatStore `message_deltas` and scene-state fold. Core narrative variables are not a second state authority. New direct Core message writes validate the live broker commit, actual active scene/take revision, exact mapped current UI message/swipe and absence of an active Core session lease. The existing strict `checkExtensionDeltas` owns namespace and value validation.

`CoreStateLifecycle.ownedTurn(packageId, sceneId, turnId)` is a small host-owned lookup. It admits only the package's active reply/regenerate turn. The runtime service accepts this optional third constructor argument; legacy and Browser paths retain their existing writer.

The unpublished migration 52 adds `core_pending_extension_state`. A sealed proposal binds its state receipt, package/runtime identity, actual accepted Core turn operation, exact session/scene/take/turn and base revision. SQL allocates a unique bounded per-turn ordinal; the sealed body authenticates that ordinal. A turn can retain at most 64 proposals and at most the existing `MAX_VALUE_BYTES` aggregate encoded proposal bytes.

The scoped Core journal append accepts proposals in the same SQLite transaction as the exact matching successful model message, after rechecking the live state grant and turn identity. Stopped, interrupted, held/tail, failed, continue and foreign-owner paths cannot accept them. Failure rolls back both the message and acceptance.

Host repair consumes accepted rows in committed Core sequence and SQL admission order. It checks the committed message proof and exact Core-to-UI message/swipe mapping, invokes the existing fold/write owner, and marks applied in the same transaction. Repeated repair does nothing. Accepted proposals may repair after grant revocation; unaccepted proposals are never converted into writes during recovery. Dead/ended staged turns are discarded, while still-held live sessions are preserved. Malformed sealed proposals refuse commit and cleanup without deleting the damaged cell.

Host integration calls after projection: `chats.applyCoreExtensionState(sessionId, coreMessageId)`. Recovery uses the same method without a message filter. Finally, `discardCorePendingState(turnOperationId, turnId)` deletes only still-staged intent. CoreTurnOwner and host compositions are a different author's lane and require separate review.

## Evidence

- Actual runtime service plus real encrypted SQLite direct write captured RED at the previous Core refusal, then GREEN using exact mapped state.
- The final live state-grant fence was mutation tested: removing only that acceptance check allowed the Core message to commit after the state grant was revoked. The held-SQL regression failed, then passed after restoration.
- Root identified receipt-hash ordering as incorrect. A deterministic regression stages A then B while the actual keyed receipt hashes sort in the opposite order. It captured final A versus expected B before ordinal ordering, then passed with B and unchanged replay.
- That regression first exposed an existing fingerprint-trigger conflict when refreshing `branch_state` twice in one transaction. The canonical refresh owner now uses UPDATE then INSERT when absent, preserving one transaction and its existing payload. The actual UNIQUE failure was recorded before this correction; no catch, separate commit or trigger weakening was used.
- The new state file passes 11 tests/45 assertions: direct stale revision, pending ownership, exact regenerate swipe isolation, revoked state grant at final SQL, cancellation/stop/failure exclusion, foreign namespace/continue denial, byte/count ceilings, accepted-state snapshot repair, orphan discard, damaged-cell preservation, ordered replay and an actual QuickJS command through broker review into a Core message state write.
- Storage/upgrade/legacy/operation reconciliation passed 53 tests/214 assertions before the last three stale/active-session assertions. No failure was hidden by that count.
- Existing state reconciliation initially had 32 passes and one preexisting 2,000-message performance assertion failure during concurrent load. Retrying only that case without changing its assertion measured 123.1 ms against the existing 200 ms limit and passed. This is not a broad performance guarantee.
- Full TypeScript exited 0 at the prior checkpoint; final aggregate checks remain required after reconciliation.

## Pending review

Root approved the exact additive storage-shape pin `f1706f2b902d1e801429927ee4b7af908e70977950bca036a3e4338aded9ee06` after reviewing the pending table, ordinal, state contracts, shared refresh, snapshot, fingerprint, health and old-snapshot test fixture inventories. Existing migrations 1 through 51 retain their SQL; older hosts refuse the new schema before writing. The current storage tripwire passes. No self-approval of this migration, security boundary or release evidence.
