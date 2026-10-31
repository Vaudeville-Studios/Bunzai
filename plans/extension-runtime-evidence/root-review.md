# Root review and verification evidence

Implementation worktree: `C:\Users\chiev\Documents\Bunzai-extension-runtime`.
Branch: `feature/unified-extension-runtime`.
Initial source baseline: `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`.

## Existing-boundary baseline

Command executed by root reviewer on 2026-10-31:

```powershell
bun test src/extensions/theme-contract.test.ts src/extensions/theme-lifecycle.test.ts src/extensions/theme-mods-lifecycle.test.ts src/kit/capabilities src/kit/tools/safety src/sandbox/lua/protocol.test.ts src/ui/sandbox-host.test.ts
```

Result: 154 pass, 0 fail, 534 assertions, 18 files, Bun 1.4.2. These existing-boundary suites passed before integration; this is not verification of the new extension runtime.

## Early contract review

Root inspected the first operation/wire/value contracts. Requested a correction before integration: bound depth/cycles/plain-object shape and exact encoded UTF-8 aggregate bytes before recursive parsing; ensure wire schemas do not bypass the bounded decoder. Lead executor owns the correction and regression tests.

No independent implementation security approval or packaged runtime evidence exists yet.

## Early integrated focused check

Command: `bun test src/sandbox/javascript src/extensions/catalog src/extensions/contracts src/extensions/broker`.

Result on the evolving implementation: 22 pass, 0 fail, 53 assertions across six files. This includes a real Bun Worker, boundary decoder regressions, broker principal binding, request grants and receipt admission tests. It does not prove browser/WebView2 loading, all API families, durable lifecycle integration or readiness.

Additional review requests sent to executors: actual requested field/destination checks; immutable creation-principal binding; stable pre-effect receipt IDs; no automatic no-effect claim after abort; exact host semantics; timed async VM callbacks; safe JSON reply conversion; namespace/digest validation on storage reads; aggregate quotas; and source-discovered inventory tests.

## Actual Chrome host-adapter proof

The first scratch browser probe timed out and was not counted as passing. Direct construction of a cross-origin module Worker is unsupported by Chrome, so the production adapter now uses a trusted frame on the separate sandbox origin. The frame constructs its own same-origin worker; extension source still executes only in QuickJS.

Root reran the production-adapter fixture:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
bun run extensions:engine-browser
```

Result: exit 0, Chrome 156.0.8078.73. Guest returned `{ok:true,fetch:'undefined'}`; cancellation aborted the host signal and ignored a delayed response. This used disposable ephemeral loopback hosts, no user Studio or library. This proves this development adapter path at the evolving worktree only, not a packaged desktop artifact, full extension lifecycle, or Browser Studio support.

Root requested stronger forged-frame fixture evidence (prove the forged event actually executed/arrived), correct timeout option placement, and startup-failure cleanup before final validation.

## Live Studio and static Pages checkpoints

Root exercised a disposable encrypted SQLite library through Studio at loopback port 8395. The real packed inspector artifact was reviewed, installed disabled, enabled and invoked in QuickJS. An admitted operation receipt appeared. Revocation removed the command and output, and enabling remained blocked until renewed review. This is development-host evidence only. The fixture used a fake vault and isolated session directories, and was closed after the check.

The live check also exposed and caused fixes for a pack/service envelope mismatch, mixed runtime/theme example discovery, optional handler-registration keys, SDK naming, and retrying the same uploaded filename. Earlier failed runs are retained as failures, not counted as passes.

Root independently ran `bun run extensions:pocket-browser` against the built Pages artifact in Chrome 156.0.8078.73. It passed: opaque iframe origin, inaccessible parent/frame storage and DOM, no guest fetch/document/window/parent/localStorage/process, no external HTTP(S) requests, cancellation on page reload, and volatile packages absent after reload. This checkpoint does not prove the still-missing Browser API families or native memory commit fences.

Native file selection is not yet live-proven. Playwright's chooser interception produced an explicit failure; the subsequent Sky interaction did not successfully open a chooser. Mock handle tests must not be substituted for actual native selection proof.

## Integration gates and adversarial findings

Root's broad focused test checkpoint produced 255 passes, 7 failures and 6 errors across 53 files. Failures included a mid-edit missing semantic resource enum and an event subscription schema fixture mismatch. Exact log: `root-focused-latest.txt`. A later complete rerun is required.

The root full typecheck failed; exact diagnostics are in `typecheck-root-latest.txt`. Executors are correcting the integration failures. No complete green typecheck or CI claim exists yet.

Guard checkpoints also failed: authored `library-root.ts` and `server.ts` exceeded 500 lines, generated metadata exceeded the guard, and 21 new files lacked required purpose headers. Logs are `lines-root-latest.txt` and `headers-root-latest.txt`. These are assigned to their source owners; no guard bypass or baseline expansion is authorized.

Additional source-grounded review findings assigned to executors:

- Bind host confirmation to the exact draft fingerprint, show all composed changes, and reject amendments after review. Preserve drafts across separate commands while invalidating changed package/grant generations.
- Bind model execution to the reviewed saved connection configuration; account for prompt and output tokens. An enforceable dollar cap remains unproven without a trustworthy price source.
- Apply live control/lease checks at admission and synchronous mutation guards in the memory backend as well as SQLite.
- Bound active workers and event cascades, reject malformed events without consuming queue capacity, and prevent nested event-tail deadlocks.
- Resolve pending worker reply IDs exactly once, cap all relay paths, and revoke Blob worker URLs on every exit.
- Correct persisted-enabled extension output after page reload and retain existing access scopes when reviewing them.
- Prove the compiled Windows WASM loading path. The executor's first actual package run failed with a missing embedded WASM file; development tests had not exposed it.

These findings and assigned fixes do not constitute independent final security approval. Full required API coverage, host parity, fresh documentation execution, complete CI, and final independent review remain completion gates.

## Whole-repository exploratory test run

`bun run test` completed in 1730.91 seconds: 15,958 passed, 194 failed, 6 errors, 55 skipped and 1 todo across 1,668 files. Exact log: `full-tests-root-latest.txt`. This is a failed checkpoint, not a release gate pass.

The source tree was evolving during this run. Many later UI failures share a cached-module missing-export error for `MAX_EXTENSION_CLIPBOARD_BYTES`; parent/child migration versions also diverged while migration 48 was being added. These explain cascades, but do not establish that all affected tests will pass on a frozen snapshot. The final wall must run after source/API generation is stable.

Actionable guard findings were assigned to owners: new whole-buffer readers and actual ceilings, stale API-door entries, capability helper accidentally discovered as a capability, missing kind catalog updates, new locked-store door coverage, ordinary slot ID widening, shared primitives copied instead of reused, timer ownership, and generated inventory drift. No baseline inflation or assertion weakening is authorized.

Further root regressions were reproduced and then independently rerun green: canonical null-prototype wire values accepted by the interactive descriptor decoder, inert accessor rejection, and bounded event cascades. Combined focused checkpoint: 9 passed, 0 failed, 61 assertions. The runtime executor also added a real packed worker/public-route UI-envelope regression; final aggregate verification remains pending.

Root found `regex.preview` directly executing guest regex through `applyRules` on the host thread. That implementation was removed before adversarial runtime input was tried. The existing regex execution door guard passed independently afterward. The operation remains a required coverage gap until its isolated worker path is implemented and proven.

The engine executor reports a successful compiled Windows inspector activation and a separate compiled Terminal worker/WASM fixture. These are executor-reported artifact checkpoints; they do not replace the final packaged UI/offline host matrix or an independent release review.

## Integration checkpoint after host matrix review

- Required-family fixture was temporarily weakened to match unbound ports. Root rejected this and catalog restored the owner-authorized expectations. Current missing implementations and host mismatches remain red; no scope amendment was approved.
- License audit passed with the QuickJS dependencies present.
- Full typecheck remains failed; exact current diagnostics are in typecheck-lead-latest.txt and assigned to source owners.
- Broker pre-effect exception handling still needs fault-injection coverage: reservation precedes receipt/context construction and initial admitted receipt write. Every failure before effects must release reserved usage.
- QuickJS raw JSON argument text must be bounded before host JSON.parse, and log truncation must obey UTF8 wire limits rather than UTF16 character count. Engine owner has these findings.
- Legacy writable theme lifecycle must be removed once all production callers use the unified service, retaining only truthful read-only migration adapters.
- Source/API freeze has not occurred. A new full test wall would be premature while public exports and migrations are still changing.

## Current independent and live boundary findings

- Independent cold Luna review found SECURITY-01: stale host-action snapshots could perform native effects before answer-time principal validation. Executors added a one-use server claim before action, exact-ticket comparison, stale service/UI regressions, and explicit ambiguous settlement. Focused suites reported green; final source/artifact review remains required.
- Root live fixture installed and enabled the packed file-reader through the actual manager. Native chooser attempts in MCP-controlled Chrome were intercepted by automation (`AbortError: Intercepted by Page.setInterceptFileChooserDialog()`), not successful native reads. A separate headful fixture was started, but Computer Use then stopped because it could not verify the browser URL. No native picker/read/write proof is claimed. Owned fixture server and browser sessions were stopped; the user's 8321 library was untouched.
- Root live fixture reproduced all builtin themes falling back to Core: unified DTO uses saved alias `greenroom` plus canonical `bunzai.host.theme.greenroom`, while renderer required identical IDs and imported-only package grammar. Lead added one authoritative alias mapper, canonical asset URLs and real service-to-renderer regressions for all four builtins (executor report:19 passes/262 assertions). Live post-fix proof is still unverified.
- Root source tracing found operational registration updates self-invalidated workers because refresh compared the whole control CAS revision. Lead is separating operational revision from authorization identity, with lifecycle grantRevision invalidation and packed service regressions required.
- Fresh root contracts/broker/permissions/QuickJS suite passed54 tests/142 assertions across11 files, including actual Bun worker cancellation and late replies. This is source test evidence, not a full release gate.
- Whole-source single-source guard was red; cleanup is underway. A scan:clones result initially excluded untracked runtime files because it used git ls-files, so that result is not evidence for new runtime duplication coverage.

## Cold review round 2

Independent Luna reviewer confirmed SECURITY-01's initial claim ordering is corrected on code read, and found four still-actionable current-source issues (assigned to engine):

1. Terminal file apply can retain a captured handle across async suspension after invalidatePackage/revoke and still mutate disk. A live authority/ticket/handle check is required before each irreversible stage, with honest ambiguity after a write has begun.
2. Claimed native host action expiry/lost final answer may resolve undefined; clipboard.write returns a normal false value and broker records committed rather than ambiguous. Claimed uncertain outcomes must reach durable effect settlement.
3. Expired Terminal file handle entries are never pruned before the shared64-entry limit, causing lasting capacity exhaustion and unnecessary native path retention.
4. Terminal snapshots and overwrite use unrestricted FileHandle.readFile after stat, allowing growth races or post-preview oversized files to be loaded before stale rejection. Explicit bounded reads are required.

Root additionally identified ignored partial-write counts and missing final native target revalidation in the Terminal writer. These are not resolved by the existing small-file happy-path TUI proof. No release approval is recorded.

## Post-wall reconciliation, 2026-10-31

The first coherent full verification failed with 35 failures / 3 errors (16,352 passed). These findings were retained, not waived. Executors corrected exact stream/buffer ownership inventories, strict new-method lock checks, canonical theme package fixtures, extension API test ports, and versioned snapshot fixtures. Root approved the storage-shape pin only after reading migrations 47-50, the strict checkpoint owner decoder, fingerprint v3, native transaction changes and the real restore probe. Approved hash: `c46f83a2e92c5233877c862ba77d3718da562c23cc383dc6294cd9df5309ce12`. Prior applied migrations remain unchanged.

The pre-health fixture had deleted new migration records without removing the corresponding new columns/tables, creating an impossible historical schema. The correction removes those structures, rather than weakening migration execution. A new real snapshot test recovers extension package/control/data, logs and encrypted checkpoint ownership. The public service-to-SQLite receipt regression was promoted into the ordinary source suite.

The pre-health restore test exceeded its unchanged 5-second timeout. Root reviewed and approved replacing its second duplicate full scan with exact adopted-row/fingerprint count and empty-dirty-queue assertions. The first post-restore scan still must report clean unsigned adoptable rows; the separate adoption test still verifies a subsequent clean scan with no adoptable rows. Database counts alone are not evidence of correct HMACs. This narrow fixture correction is not the deferred test-harness redesign.

Independent final-delta review found no concrete source blocker in the shared bounded reader, captured Window cleanup or isolated persistence probes. It found that the same-module draft callback test did not exercise the cross-bundle event bridge. A fresh built Browser E2E subsequently exercised host Apply into the mounted SceneComposer across bundles; its exact artifact evidence remains in the engine ledger. Full verification and fresh Desktop launch evidence remain outstanding at this checkpoint. No release approval or commit authorization is recorded here.

## Native Desktop packaging follow-up

The refreshed standard Desktop executable failed to open its embedded WebView DLL with Windows error 126. The physical source DLL and exact extracted DLL both loaded successfully, and a child-only explicit physical WEBVIEW_PATH opened a native window and closed cleanly. This diagnostic is not a standard launch pass. The historical successful executable's transient launch environment was not retained, so it cannot establish that no override was present.

Root approved extending the existing desktop-webview-lib owner to materialize the embedded Windows DLL under LocalAppData, validate bytes/hash/file identity and refuse junction/tampered cache paths, then provide the physical path only to the window worker. Independent lead review found no concrete blocker. Root additionally required retaining null/fallback behavior on asset-read errors, simplifying the duplicated Linux condition and removing an unverified ACL guarantee. Those corrections were read back in source. Actual standard compiled activation with WEBVIEW_PATH absent from the launching environment is still required before calling this repair verified.

The second verify run was deliberately interrupted after the packaging bug was confirmed, early in full tests, with its log preserved as incomplete. It is neither a green verification nor an additional test failure. A new coherent full run must cover the corrected loader.

The final combined Desktop proof passed on executable SHA-256 `A740FBF463900CCF3B394A72F0C4B42FC0E4909D670C51D1CF1F8D58F7E0FED2`. With no WEBVIEW_PATH override, it opened WebView2, activated the real extension command and closed with no remaining app listeners and a cleared lease. User-requested title-bar repair was independently reviewed: canonical executable resource, correct pointer width/UTF-16 path, extracted HICONs retained through the window loop, idempotent post-close destruction and best-effort failure handling. WM_GETICON changed from all-zero to nonzero small/big/small2; the large icon's pixel digest matches the embedded executable icon. Native file-picker and whole-app offline behavior remain unverified. Root approves these native deltas by code-read plus the specified artifact evidence; full verification and normal hooks remain outstanding.

## Final source verdict

APPROVE scoped normal-hook commit, no push. The final source suite completed 16,400 passed / 55 skipped / 1 existing todo / 0 failed, 125,182 expectations. Typecheck, SQLite probe, performance, scale, Node-core and license gates passed in that same invocation. The wrapper exited 1 afterward only on a Bun CLI path filter; root read and approved the exact `./scripts/extension-required-families.test.ts` invocation correction. That gate and all 28 remaining checks then passed individually. Root explicitly declined a redundant 31-minute suite repeat for the invocation-only change. Do not describe the corrected aggregate wrapper as having been run end-to-end with exit 0.

The final packaged Desktop proof includes the Windows DLL-path and bunny window-icon repairs. Browser and compiled Kit proofs are recorded separately with exact identities. Independent reviews are scoped code/test evidence, not security certification. GUI file-picker behavior and outside-developer tutorial acceptance remain manual checks. Original Library/media/design work is preserved. No push is authorized. The approximately 65% test-harness reduction remains deferred.
