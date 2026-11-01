# Final cold runtime review

- **Review date:** 2026-10-31 (America/New_York)
- **Branch:** `feature/unified-extension-runtime`
- **Source base / checked `HEAD`:** `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`
- **Reviewer:** independent read-only source and fixture review
- **Verdict:** no independently confirmed concrete blocker in the scoped runtime boundaries

## Scope and source findings

Reviewed current source for teardown admission and begun native file-write receipt settlement, live-lease checks at native host-action claim and file-write begin, frozen host-selected invocation context and per-operation grant checks, provider configuration and credential projection, broker authority checks, and extension-turn provider/write boundaries.

The inspected implementation blocks package dispatch during package stop and blocks all dispatch during close; it records begun file writes as ambiguous before aborting workers. Host-action claim and file-write begin renew/check the live runtime fence before entering their native ports. Invocation resource references are bounded, copied, frozen, and filtered to the package grant union for the guest, while each broker operation still resolves its own exact grant and target scope. Model operations expose bounded saved-connection metadata and model lists; provider configuration stays within host services. Extension turns use explicit follow-on scopes and shared limits, and the existing scene turn engine suppresses narrator tools, Director planning, and shared-global writes for extension commits.

No source edits were made by this reviewer. No new finding is carried forward from this pass.

## Reproducible test commands and results

Run from the repository root (`C:\Users\chiev\Documents\Bunzai-extension-runtime`).

### Runtime, broker, action, context, worker, route, and admission boundaries

```powershell
bun test src/extensions/runtime/service.test.ts src/extensions/runtime/file-action-port.test.ts src/extensions/runtime/host-action-port.test.ts src/extensions/broker/invoke.test.ts src/ui/extensions/file-actions.test.ts src/ui/extensions/file-handles.test.ts src/extensions/runtime/service-close-admission.test.ts src/extensions/runtime/host-action-live-fence.test.ts src/extensions/contracts/invocation-context.test.ts src/sandbox/javascript/engine.test.ts src/sandbox/javascript/run-in-worker.test.ts src/ui/server-extension-runtime.test.ts src/ui/server-extension-owner.test.ts src/ui/extensions/host-action-gesture.test.ts src/extensions/runtime/turn-services.test.ts
```

Result: **104 passed, 0 failed, 373 expectations**, across:

- `src/extensions/runtime/service.test.ts`
- `src/extensions/runtime/file-action-port.test.ts`
- `src/extensions/runtime/host-action-port.test.ts`
- `src/extensions/broker/invoke.test.ts`
- `src/ui/extensions/file-actions.test.ts`
- `src/ui/extensions/file-handles.test.ts`
- `src/extensions/runtime/service-close-admission.test.ts`
- `src/extensions/runtime/host-action-live-fence.test.ts`
- `src/extensions/contracts/invocation-context.test.ts`
- `src/sandbox/javascript/engine.test.ts`
- `src/sandbox/javascript/run-in-worker.test.ts`
- `src/ui/server-extension-runtime.test.ts`
- `src/ui/server-extension-owner.test.ts`
- `src/ui/extensions/host-action-gesture.test.ts`
- `src/extensions/runtime/turn-services.test.ts`

This batch includes the two-package close-admission case, runtime lease takeover before claim, failed live-fence check before file-write begin, invocation-context validation, worker cancellation, typed host gestures, and public service/route fixtures.

### Scene turn, explicit follow-on, model configuration, and network egress boundaries

```powershell
bun test src/studio/scene-turn.test.ts src/studio/scene-summary-extension-commit.test.ts src/studio/compendium-extension-scope.test.ts src/extensions/operations/turns/operations.test.ts src/extensions/runtime/model-services.test.ts src/extensions/runtime/turn-services.test.ts src/kit/providers/egress-vetted.test.ts
```

Result: **58 passed, 0 failed, 208 expectations**, across:

- `src/studio/scene-turn.test.ts`
- `src/studio/scene-summary-extension-commit.test.ts`
- `src/studio/compendium-extension-scope.test.ts`
- `src/extensions/operations/turns/operations.test.ts`
- `src/extensions/runtime/model-services.test.ts`
- `src/extensions/runtime/turn-services.test.ts`
- `src/kit/providers/egress-vetted.test.ts`

This batch includes provider-config review mismatch rejection, scene-specific model handling, shared turn limits, extension narrator-tool suppression, revoke/cancel behavior for summary follow-on writes, exact lorebook scope, and vetted destination handling.

## Receipt-lifecycle delta follow-up

Reviewed the current shared `receiptUpdate` transition rule in `src/stage/store/extension-store-rules.ts`, its Memory and SQLite `appendReceipt` callers, and broker receipt construction in `src/extensions/broker/invoke.ts`. The broker captures one `createdAt` value per operation before admission and reuses it for the admitted and final receipt. The shared rule treats exact replays as idempotent, permits only an identity-preserving `admitted` to non-`admitted` transition, and rejects terminal rewrites or receipt identity reuse.

### Store parity and broker tests

```powershell
bun test src/stage/store/memory/extension-store.test.ts src/stage/store/sqlite/extension-store.sqlite.test.ts src/extensions/broker/invoke.test.ts
```

Result: **28 passed, 0 failed, 202 expectations**, across:

- `src/stage/store/memory/extension-store.test.ts`
- `src/stage/store/sqlite/extension-store.sqlite.test.ts`
- `src/extensions/broker/invoke.test.ts`

### Public broker-to-real-SQLite lifecycle probe

```powershell
bun test ./src/extensions/runtime/receipt-lifecycle-probe.test.ts
```

Result: **1 passed, 0 failed, 13 expectations**. The isolated fixture activates a package through the public `ExtensionService.activate` entry point, uses the real `storage.set` operation and encrypted in-memory SQLite `ExtensionStore`, and advances a deterministic clock. The probe asserts the durable `admitted` row is visible before mutation execution, the mutation executes once, a saved value is durable, and the receipt settles to `committed`. It then replays the exact final receipt (accepted idempotently) and verifies that an admitted replay, conflicting terminal status, changed timestamp, and changed operation are rejected. The receipt and stored value remain unchanged and the mutation count stays one.

The regression is retained in the normal runtime test inventory at `src/extensions/runtime/receipt-lifecycle-probe.test.ts`. It uses only fixture package data, a fresh in-memory database, and a fresh test cipher; no provider or external service is called.

### Delta verdict and limits

No concrete blocker found in the receipt transition. Durable pre-effect admission and final broker settlement behaved as intended in the SQLite lifecycle probe; store parity checks reject terminal receipt rewrites. This proves the named Memory/SQLite fixture paths and one public activation-to-SQLite mutation path. It does not establish behavior of a disk-backed production library, packaged/deployed runtime, or provider integration.

## Proof limits

This is an independent source and isolated-fixture review of the current worktree at the listed `HEAD`. The tests exercise Bun/QuickJS and test doubles or in-memory stores where indicated by their fixtures. They do **not** establish behavior of a packaged desktop artifact, deployed/browser runtime, production library, or external provider. No actual home/library/vault, paid provider, UI desktop automation, push, deployment, or security certification was involved. Passing test counts are evidence for the named cases only and are not release approval or a general security guarantee.
