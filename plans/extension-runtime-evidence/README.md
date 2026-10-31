# Plan 001 execution ledger

Status: implementation and scoped normal-hook delivery are approved on `feature/unified-extension-runtime` in the isolated `Bunzai-extension-runtime` worktree. Base: `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`. The full-suite result, individually green gates and subsequent narrow UI validation are distinguished below; the aggregate wrapper did not exit zero before its path correction. No push or stable-API certification is recorded; the owner's original worktree remains untouched.

## Current implementation and evidence

- Generated catalog and SDK: 137 operations from 47 drop-ins; required-family matrix passes, including the five Terminal turn operations. Desktop/Browser alone own the mounted Scene composer control. Browser local prompt preview is explicitly connectionless, unshaped and unbudgeted; it makes no model call. Terminal has explicit resource arguments, not implicit focused-piece context.
- Runtime: fresh bounded QuickJS workers, host-reviewed capabilities, durable admissions, exact resource grants, bounded opaque file handles, saved-model configuration binding and revocation/cancellation fences. The code and focused tests establish specific boundaries, not a general security certification.
- Persistence: append-only migrations 47 through 50, Memory/SQLite native transaction checks, encrypted extension records and checkpoint owner, fingerprint v3. Two-process turn/provider/follow-on and checkpoint takeover tests pass. Old-snapshot and latest restore verification remains a final gate.
- Pending extension state is limited to the matching extension-owned reply/regenerate turn. Continue and unrelated first-party turns refuse it. Extension turns disable narrator tools, Director planning and shared-global macro writes; ordinary first-party turns retain their existing behavior.
- Legacy writable theme lifecycle is consolidated into ExtensionService. Manager, generated SDK, examples, host commands, approvals and SDK packaging exist. Cheap source guards, typecheck and documentation checks passed at checkpoints; current full-suite failures still need repair.
- Independent cold review: 104 runtime/boundary tests, 58 turn/provider tests and 28 receipt-transition tests passed; an additional real SQLite public-service lifecycle probe passed. Exact commands and limits are in `final-cold-runtime-review.md`. This is scoped independent code/test review, not release certification.

## Actual artifact proofs

- Standard compiled Windows Desktop: final artifact SHA-256 `A740FBF463900CCF3B394A72F0C4B42FC0E4909D670C51D1CF1F8D58F7E0FED2` opened without an external WEBVIEW_PATH override. The actual Extensions manager command returned `api.describe`, persisted receipts and closed with its runtime lease cleared. Small/large native window icons are set; the large icon's pixels match the executable's embedded bunny icon. This exact artifact includes the DLL-path and title-bar icon repairs.
- Standard compiled Windows Kit: actual TUI `/extension run` executed `api.describe` through the compiled worker; receipt persisted and `/quit` closed cleanly with the lease cleared.
- Built static Browser: real isolated QuickJS prompt contribution and disable flow, host-applied Scene composer draft across bundles, and grant-filtered invocation context passed in Chrome. Opaque sandbox origin, parent storage denial and zero guest off-origin requests were observed in that fixture.
- Exact artifact hashes, sizes, isolated profiles and commands are in `02-engine-spike.md` and `07-browser-host.md`. Later production changes require refreshed applicable artifact evidence.
- Native graphical file-picker read/write remains unverified: Computer Use stopped after intercepted picker attempts and inability to verify the browser URL. No whole-app offline guarantee is claimed. No paid model calls, real credentials or real user libraries were used in tests.

## Full verification gate

First coherent `bun run verify:ci` finished with exit 1: 16,352 passed, 55 skipped, 1 todo, 35 failed and 3 errors; 124,912 assertions across 16,443 tests / 1,734 files, 1,633.8 seconds. Raw log: `verify-ci-final.log` (not staged).

That failed suite covered stream/buffer ownership checks, kind/section inventories, locked-store inventory, theme fixtures, storage-shape review, legacy snapshot migration fixtures, extension-API UI mocks, draft-bus environment/contract tests and one regex error expectation. The source and fixtures were corrected; none was waived. Earlier source-churn and concurrent-performance failures remain historical evidence, superseded only for the gates actually rerun.

The final frozen-source run completed **16,400 passed, 55 skipped, 1 todo, 0 failed**, with 125,182 expectations across 16,456 tests / 1,737 files in 1,854.35 seconds. Typecheck, SQLite probe, performance gates, scale:fast, Node-core and license audit passed earlier in that same invocation. Log: `verify-ci-final-combined.log`.

The wrapper then exited 1 because Bun treated `scripts/extension-required-families.test.ts` as a filter. The immediate correction added the required `./` to that verification-script path. The corrected family gate passed (1 test, 7 assertions); every remaining 28 wrapper checks ran sequentially and exited 0, recorded in `verify-ci-tail-checks-exit.txt`. The unchanged 31-minute source suite was not repeated for this invocation-only fix. These results belong to the implementation committed as `43f90130d6e11516b7b00fec0fdc3af7f3f20b91`, not a claimed zero-exit rerun of the entire corrected wrapper. Interrupted invocations remain explicitly incomplete.

Post-suite review rejected a command-menu exemption that could render 6,400 rows. A narrow follow-up uses the existing `VirtualRows`, a bounded scroll region and stable running-command pinning, without changing services, grants or the broker. Its focused run passed 27 tests / 89 assertions, including bounded mounted rows and scroll-to-last invocation among 512 commands. Current typecheck, lint, list/line guards and component/docs projections pass. A fresh built Pages proof navigates the actual Library, stages its character and invokes the menu command; the guest verifies null input and exactly that character in invocation-scoped reads. This follow-up is targeted/current-Browser proven, not a claimed second full-suite run. The Desktop native/icon artifact above predates only this UI change; native loader/icon and runtime code are unchanged.

Root reviewed the version-aware shape pin, restored-state probes, native deltas and independent review findings. The final Desktop artifact passed native startup, icon and guest activation with no external DLL override. Root authorizes a scoped normal-hook commit, without bypassing hooks or pushing. Native graphical file-picker acceptance and an outside developer tutorial trial remain manual acceptance items. Landing curtain/preroll work is independently committed as `411c9f3` on `feature/landing-animation-restore`; its UI documentation overlap is documented in that branch.

## Deferred work

The owner requested roughly 65% fewer tests but explicitly deferred the harness redesign. Test deletion, harness reduction and CI redesign are outside this runtime cohort.
