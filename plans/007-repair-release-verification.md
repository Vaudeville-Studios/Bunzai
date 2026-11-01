# Plan 007: Repair the confirmed release verification failures

Status: owner-authorized release delivery, repair checkpoint in progress, 2026-11-01.
Planned at `2307cd60fc23fb0eed7de3853a715ce9bd6082d3` (immutable tag v0.1.43).
Priority P1; risk HIGH for native loading and locked-store contracts.

## Outcome and limits

The owner requested pushing Mainstage and publishing binaries, then explicitly chose
normal release verification. Reviewed source is pushed; no binaries have published.
Run 41275963827 was cancelled after its CURRENT log proved 1,253 failures across
224 groups. Preserve normal release acceptance. Fix authoritative boundaries and
test lifecycle owners; do not delete tests, suppress assertions/warnings, skip suites,
publish a preview, or implement the deferred 65% test reduction.

Read AGENTS.md, product/architecture/conventions, relevant security/distribution
contracts and existing test helpers. Advisor root writes plans only. A separate
executor implements in this isolated worktree, with independent source review.

## Evidence and current owners

- Fix checkout: `C:/Users/chiev/Documents/Bunzai-release-verification-20261101`,
  branch `fix/release-verification-20261101`. Original release checkout and binaries
  remain in `Bunzai-binary-release-20261101`; never overwrite that evidence.
- Raw current snapshot (do not commit 377 MB):
  `C:/Users/chiev/AppData/Local/Temp/codex-bunzai-release-41275963827-current.log`.
  Bounded contexts: sibling `codex-bunzai-release-current-failure-families.json`.
  Copy concise relevant excerpts under `plans/evidence/release-repair-20261101/`.
- At 05:14:15 UTC, `src/egress-doors.test.ts:56` rejected the newly introduced
  `src/site/docs-search.ts (1)` fetch. `src/site/docs-search.ts` fetches the static
  documentation index URL emitted in the generated page; queries search locally.
  The existing `ALLOWED` table is the explicit network-door policy owner. Do not
  exempt the site folder, weaken the scanner or authorize arbitrary typed URLs.
- At 05:14:18 UTC, `src/desktop-webview-lib.test.ts:106` observed a missing second
  WEBVIEW_PATH during concurrent Linux first launches. The owner is
  `verifiedLibrary` in `src/desktop-webview-lib.ts`; it publishes through the
  existing `writeAtomicReplace` owner in `src/studio/atomic-file.ts`, then verifies
  lstat, permissions/link count, size and hash. Do not relax those checks.
- `src/stage/store/locked-stores.sqlite.test.ts:228` found seven untested methods:
  createCoreChat, projectCoreMessage, projectCoreMessages, stageCoreExtensionState,
  recordCoreExtensionState, applyCoreExtensionState, discardCorePendingState.
  Its exhaustive inventory is not proof that those methods leak while locked.
  SQLite owners are `src/stage/store/sqlite/chat-store.ts`, chat-store-history.ts,
  chat-store-core-state.ts and their existing Core fixtures.
- The current browser beforeAll also failed. `scripts/mod-top-layer/run.ts` invokes
  check.ts; `scripts/theme-measure/driver.ts` spawns Chrome with discarded stderr,
  sleeps 2.5 seconds, then connects to a fixed CDP port. This is a lead requiring
  an actual current failure reproduction, not proof of the whole cascade.
- DOM owner: `src/ui/_shared/test-dom.ts`. Its asynchronous teardown deletes the
  live handle, awaits three immediates, then restores old globals. Many afterAll
  callsites discard that promise (light-rays, settings room, host-command-menu,
  ink-dialog among others). A previous teardown may overwrite the next installed
  DOM. Prove a small lifecycle counterexample before choosing the repair.
- Kit owner: `src/kit/render/test-render.ts`. `actSync` discards React act's result
  and resets IS_REACT_ACT_ENVIRONMENT immediately. This is an independent candidate
  for blank terminal frames, not automatically fixed by the JSDOM lifecycle repair.

## Preparation and commands

1. Confirm `git status --short` contains only this task plan; compare drift with
   `git diff --stat 2307cd6..HEAD -- src scripts package.json bunfig.toml .github`.
2. Initialize the existing pinned RP-Core submodule, then use the already verified
   Bun 1.3.14 distribution. Assert the selected executable prints 1.3.14. Initialize
   `vendor/rp-core` at 9cce0552df233c7185329d9cfc5473be67e2e821 and run frozen
   installs as required by existing repository setup. Do not change locks or vendor.
3. Run tests only in subprocesses with a task-specific TEMP profile and explicit
   HOME, USERPROFILE, APPDATA, LOCALAPPDATA, BUNZAI_HOME, CODEX_HOME,
   CLAUDE_CONFIG_DIR and XDG directories redirected there. The preload alone leaves
   HOME unchanged, so it is not sufficient isolation. No real providers or credentials.
4. Commands below use `bun` to mean that verified executable, not the ambient 1.4.2.
   Run focused suites with explicit `./` paths. A missing dependency/zero tests is
   not RED or GREEN. Preserve expectations between the honest failing and passing run.

## Lane A: narrow contract coverage repairs (executor may implement now)

1. Independently verify generated index URL ownership and the docs search test.
   Register exactly its one approved same-origin static-index fetch, with an accurate
   reason in ALLOWED. Keep exact counts and all refusal checks. If URL ownership is
   actually untrusted, stop and report instead of adding the entry.
   Verify `bun test ./src/egress-doors.test.ts ./src/site/docs-search.test.ts`.
2. Add valid, typed invocation cases for all seven Core methods to the locked-store
   exhaustive test, reusing existing Core fixture shapes. Keep the coverage inventory,
   LockedError checks and whole-database snapshot unchanged. Test malformed inputs
   separately if necessary; do not mistake argument validation for a lock leak.
   Verify `bun test ./src/stage/store/locked-stores.sqlite.test.ts` and relevant
   existing Core state/record-authority focused suites.
   If any method does not refuse while locked, stop for a reviewed production repair.

## Lane B: lifecycle and race investigations (no production edit until review)

Independent agents inspect native loading and DOM/Kit lifecycle owners. Once the
executor has prepared dependencies, run small deterministic counterexamples using
the actual public helper/store boundary in isolated profiles:

- Native: unchanged concurrent-first-launch regression on Linux where an existing
  runtime is available; also attempt the actual Windows API branch in temporary
  LocalAppData. Do not fake POSIX stat semantics and claim Linux proof. No global
  service/distro installation. Return exact race mechanism and proposed patch.
- DOM: use one actual discarded teardown caller followed by a rendering caller,
  plus a deterministic helper-level sequence proving the next DOM is overwritten.
  Preserve cleanup flushing; do not merely turn off act warnings or weaken frames.
- Kit: reproduce the actual turn/layout pair independently of browser globals.
  Inspect OpenTUI's supported act/settle lifecycle before changing helper timing.
- Browser startup: retain real browser assertions, profile isolation, owned child
  cleanup and bounded startup/exit diagnostics. No skip-on-failure fallback.

Root must review the counterexamples and update this plan with exact permitted
repair paths before runtime/native/harness implementation. Source-confirmed leads
alone do not justify editing hundreds of product components or test expectations.

### Reviewed DOM caller repair

The deterministic public helper probe confirms that starting B before A's asynchronous
teardown settles lets A overwrite B's globals. Exactly three real lifecycle callbacks
discard the cleanup promise. The first named light-rays/ink-dialog pair reportedly
failed once, but three subsequent reruns passed; do not describe that pair as a
deterministic reproduction. The helper race and actual discarded callbacks are
confirmed. This is a bounded repair of those unsafe lifecycle callers, not proof
that they cause every recorded UI/Kit failure.

The separate executor may change ONLY these three cleanup callbacks to return or
await teardown, preserving the existing three-immediate drain and all assertions:

- `src/ui/components/light-rays/light-rays.test.tsx`: await teardown before restoring
  settings and the mocked renderer in its afterAll callback.
- `src/ui/apps/settings/room.test.tsx`: await teardown before restoring the registry
  mock in its afterAll callback.
- `src/ui/apps/scenes/messenger/shell/shell-actions.test.tsx`: await teardown within
  its existing cleanup hook, keeping all other cleanup ordering intact.

Do not change `test-dom.ts` to synchronous restoration, touch production components,
or alter Kit actSync. Return-promise arrow callbacks elsewhere are already correct.
Record the exact inventory and probe under the existing DOM evidence note. Run all
three caller suites, the helper lifecycle tests, ink-dialog, and representative
previously failing virtual-list/Workbench/Scenes suites in the same process with
isolated profiles. If a group still fails, preserve it for diagnosis rather than
changing expectations. Run the Kit app/layout pair alongside the repaired caller
sequence, reporting it separately. Root reviews the complete diff before commit.

### Reviewed native cache repair

The independent reviewer reproduced the unchanged Linux concurrency failure in
2 of 30 runs on Bun 1.3.14. Instrumentation in a disposable source copy found
NO publication exception: concurrent atomic renames caused lstat to inspect an
inode that had become unlinked (nlink 0). The existing hard-link guard correctly
refused that stale inode. Do not implement the earlier publication-error fallback;
the observed mechanism contradicts it.

The executor may change only the verify loop in `src/desktop-webview-lib.ts` and
strengthen concurrency coverage in `src/desktop-webview-lib.test.ts`:

- Re-read the current pathname only when lstat returns nlink 0, at most six lstat
  attempts with a 1 ms yield between attempts. Use one named attempt bound, not
  independently maintained magic values.
- Every fresh observation must pass the UNCHANGED full safety predicate, size,
  bounded read and SHA-256 checks before returning its path. A persistent zero at
  the final attempt must fail that same predicate. Do not allow nlink 0 or 2.
- Keep all other unsafe metadata, symlink, directory, ownership, mode, hash,
  missing/read errors and publication failures fail-closed, without generic retry.
- Do not add a second writer, process-local approval cache, global bypass or lock.
  Path revalidation is not a claim of universal multi-process startup availability.

The disposable prototype passed 1,200 concurrent pairs across 30 reruns, a
16-caller burst and existing tamper/link/permission refusals. This is prototype
evidence, not canonical implementation evidence. Apply the reviewed loop without
instrumentation counters, reproduce the canonical baseline RED with unchanged
public expectations, then run the same canonical API tests GREEN on Linux and
Windows. Add a bounded multi-caller burst to improve the actual regression if
needed; avoid large routine stress counts merely inflating the harness. Record
extra repeated stress separately from the ordinary suite.

Keep the exact original Linux snapshot as baseline; apply only the reviewed
canonical diff for GREEN. Extra instrumented/prototype files remain task-local
and must not be included in test discovery or published assets. Cleanup was
policy-blocked; do not retry destructive commands through another shell. Use
explicit test paths or a fresh clean snapshot instead.

### Reviewed Unicode keyword repair

The unchanged key-word-boundary parity suite reproduces an ordinary matcher
accepting an ASCII key glued after U+10400 while the trie correctly rejects it.
Pinned Bun's negative lookbehind is inconsistent; codePointBefore/isWordCodePoint
are correct. Preserve the word-character contract and trie offsets.

Two exploratory candidates are rejected: a negative-assertion-plus-any-character
prefix remained RED, and a global literal loop introduced quadratic rescanning
of long repeated keys. Neither candidate is approved for commit.

The bounded TEMP prototype instead consumes a direct complementary character class:
`(?:^|[^BASE_WORD_CLASS]|[SPACELESS])`, followed by the escaped literal and the
existing right-boundary lookahead. Non-word means outside the base word categories
OR a spaceless-script character. Its 815 assertions include Unicode/trie parity,
ASCII differential cases and an astral keyword in both case modes. Repeated-a
measurements at 40k/80k/160k were 5.50/8.25/19.57 ms versus the rejected loop's
25/84/324 ms. These are spike measurements, not final canonical verification.

The final implementation factors base word categories into `BASE_WORD_CLASS`
and exports `WORD_PREFIX`, the complementary class
`(?:^|[^BASE_WORD_CLASS]|[SPACELESS])`. `triggers-keyword.ts` retains its
non-global cached `u`/`iu` regex, right-boundary lookahead, and single `.test()`
call. No trie implementation change was needed; the task's candidate `key-index.ts`
delta was restored to HEAD.

Regression coverage preserves the original parity expectations and adds astral
neighbors, an overlapping later occurrence, cache-repeat checks, and astral-key
glued-then-valid cases in both case modes. Potentially hanging astral-key and
repeated-candidate checks run in a 10-second child. Its parsed output verifies
the astral results and that the warmed matcher uses between one and eight
`RegExp.exec` calls, without pinning an exact internal count.

Pinned Bun 1.3.14 verification: the focused parity file passed 59 tests / 1,564
assertions. Core Lore plus `src/stage/crypto/keyring-heap-canary.test.ts` passed
422 tests / 21,114 assertions across 38 files. Root's pinned-runner typecheck
exited 0. Independent review marked the scoped Unicode change shippable. No full
repository suite was run for this repair. The bounded repeated-a timings above
remain exploratory measurements, not release performance claims.

### Reviewed fingerprint coverage and busy-test fixture

The independent storage review reproduced the missing-column failure. Migration 52
already defines `core_scene_creation_bindings.origin`; its FP_SPECS entry omits
that plaintext field. The authenticated body remains the source of authorization
origin; do not change that authority. Adding this field under fingerprint v1 would
misclassify existing valid rows, so use the existing version/adoption mechanism.

Executor may change:

- `src/stage/store/sqlite/row-fingerprints.ts`: add origin to that ONE spec's plain
  fields and bump that spec to v2. No other spec, schema, migration or birth-authority
  change. Preserve all coverage/refusal assertions.
- Add `src/stage/store/sqlite/row-fingerprints-core-origin.sqlite.test.ts` (or add
  the same cases to the existing row-fingerprints test while staying below 500 lines):
  create a real Core birth through existing fixture/store APIs; show current v2
  seals origin, and raw origin tampering is detected. Model a valid legacy v1
  fingerprint using the actual old v1 inputs and prove the real health scan calls
  it old/adoptable rather than damaged, explicit adoption signs v2, and a subsequent
  scan is clean. Reuse real health/store fixtures. Do not silently reseal corrupted
  encrypted cells; run the existing adoption-refuses-damaged-row regression too.

Root read the version contract in FpSpec and health-page.ts: stored.v < spec.v is
old. Existing health adoption signs old clean rows. Preserve applied migration 52
byte-for-byte and document that v1 could not authenticate the omitted plaintext
column historically; do not claim a new retrospective integrity guarantee.

The independent database wait test passed 20 focused reruns. Its current first
retry precondition is only a 30 ms sleep. Permit a TEST-ONLY change in
`src/stage/store/sqlite/database.test.ts` for that exact retrying-writer case:
replace the guessed sleep with a barrier confirming an actual failed busy write
attempt before starting exclusive(). Keep the real second SQLite connection,
exclusive hold past the original budget, success and row-count assertions. Do
not widen limits, fake success, alter patiently/database.ts, or suppress a real
busy error. Record this as a timing-sensitive fixture repair, not a proven
production database bug. Stop if the barrier uncovers a real contract defect.

Run row-fingerprint coverage, the new version/adoption case, existing health repair
and restore/adoption cases, Core birth authority and the unchanged busy refusal
cases. Obtain independent review before committing. Core QuickJS full-run failure
remains a lifecycle-corruption lead: its 28 focused checks pass. Do not change the
sandbox-origin requirement; include that file in the same-process UI replay.

## Consolidation and normal release

After approved repairs, run representative cross-file sequences, adjacent affected
suites and typecheck. Independently review the full diff, including refusal cases,
resource cleanup and any test-only lifecycle changes. Keep individual assertions
and the normal release gate. Do not rerun another hours-long wall until the known
failure families are addressed or explicitly explained with current evidence.

Use normal precommit hooks and scoped professional commits. The owner authorized
Mainstage push and publishing binaries; delivery occurs only after root review.
Do not move v0.1.43. A new release must use a new version/tag through the existing
train, omit Kit, and pass the complete existing release checks plus S21. Download
and smoke actual new artifacts in isolated profiles, then reconcile public docs.

## Stop conditions and done evidence

Stop for unrelated dirty files, real user profiles or credentials, unintended
provider/network access, changed frozen locks,
unknown failure ownership, migration changes, or a proposed weakened security check.
No blanket test deletion, timeout-only fix, unsupported skip, warning suppression,
retagging, fake helper pins, or publication from a failed gate.

Record exact source SHA, tool versions, RED/GREEN commands and counts, skipped or
unavailable platform proof, reviewer verdict, full workflow URL/result, asset
inventory/checksum proof and actual packaged acceptance. Local tests are not a
published release, and a cancelled job is not a passing verification.

### Approved bounded cross-file failure replay

After scoped commits, execute one pinned Bun 1.3.14 process using the task-local
Windows-layout isolated runner. Select the 217 existing files from the cancelled
run manifest: 181 failed UI files, 35 failed Kit files, and Core extension state.
The protected-browser file is excluded only because it is a separately tracked,
currently unresolved real-browser prerequisite; this subset cannot prove it.
Retain the actual emitted discovery order. No isolate, parallel or test-name
filter flags. Use the normal 120000ms per-test budget and diagnostic --bail=1.
Limit the diagnostic process to 300000ms and each captured stream to 64MiB.
On either limit stop only the verified owned runner PID tree; report stopped,
never passed. This does not change package scripts or the release gate.

Exact argument manifest: task-local codex-bunzai-actual-failure-replay-args.json;
verify file count/existence and argument length before launching. Runner:
codex-bunzai-repair-run-winlayout.ts with theme-measure-port-offset=14000.
Both files live under C:/Users/chiev/AppData/Local/Temp. All HOME, USERPROFILE,
APPDATA/LOCALAPPDATA, XDG and product profiles remain task-owned, with the Windows
AppData directories nested under the isolated USERPROFILE as required by Chrome.
No real user profile or credentials are inherited. Preserve exit, final summary,
first failure and any bounded-stop reason. A passing subset is evidence for only
that sequence, not the entire suite, Linux CI, or packaged release.

### Fail fast on a failing full CI suite

The cancelled release continued for hours after its first known failure because
verify:ci invokes the full test script without Bun's supported bail option. Make
the CI invocation stop after its first failing test, while preserving the entire
test selection and every subsequent gate on a successful run. Scope: only the
verify:ci script value in package.json, replacing `bun run test &&` with
`bun run test --bail=1 &&`. Do not alter the test script, timeouts, assertions,
release jobs, successful-run coverage, or gate ordering. No new script owner.

Pinned Bun 1.3.14 task-local package fixture confirmed forwarding: the emitted
test command included `--bail=1`. The passing `verify:ci` fixture exited 0 and
logged both test cases plus its post-test command. The deliberate-failure fixture
exited 1 after logging only the failing test; the next test and post-test command
did not run. The fixture lives in TEMP and adds no artificial failure to product
tests. The package diff retains all later verify:ci commands verbatim and in order.

One initial fixture invocation incorrectly passed `--cwd` as a Bun argument and
started the repository verify command at typecheck. It was immediately interrupted;
process inspection found no matching runner remaining. That attempt is not a gate
result or proof. Independent review approved the scoped change. No full suite was
run for this repair. A failed early run remains failed and skipped checks never
count as success.

### Bounded Linux browser diagnostic

The original Linux release's Chrome startup cause is still unknown because the
launcher discards stderr. The unchanged browser suite passes on an isolated
Windows fixture; that does not establish Linux behavior. Existing ci.yml's manual
entry invokes the full matrix, so it is not a bounded diagnostic substitute.

Permit one manual-only .github/workflows/browser-diagnostic.yml, following the
existing Actions versions. Single standard ubuntu-latest job, contents:read only,
checkout recursive with persist-credentials:false, Bun from .bun-version, exact
Node 22.23.4, frozen root/vendor dependencies. No publish, paid runner, secrets,
production state, sandbox bypass flags, test weakening or release gate changes.
Maximum job ten minutes and unchanged protected-browser test command three
minutes. Give all HOME/XDG/product/cache/profile paths task-owned directories.
Use runner's actual installed Chrome, failing clearly if absent. A task-local
executable shim may capture its bounded stderr and exit status while invoking the exact
original flags, with CHROME_PATH pointing only to that shim. The shim must preserve
argument boundaries and return the owned child's status; it must not attach a
foreign browser or alter sandbox flags/readiness behavior. Preserve runtime,
source SHA, original Chrome path/version, actual test exit, final summary, and
bounded logs as an always-uploaded diagnostic artifact. Limit each captured log
to 64MiB; hitting a size/time cap is a failed or stopped diagnostic, never a pass.
Clean up only owned child processes/profiles and do not include credentials.

Independent review and root diff inspection are required before commit/push.
Publish this workflow with skip-release and skip-ci commit markers to avoid an
accidental full release during investigation, then dispatch only this workflow
at the exact reviewed commit. Prior user authorization to push and deliver the
binaries covers this necessary free-runner diagnostic. Do not launch the full
release until its Linux result and broader replay have been assessed.

The Windows 217-file replay crashed in Bun after 101 passing entries with no
final summary. A root rerun of its last file reproduced the Windows crash in
isolation; the same file on the older Linux baseline passed 55 tests/291 asserts.
This is a runtime/platform contrast, not proof of the final Linux candidate.
Permit the same 217-file diagnostic in a fresh exact-HEAD Linux fixture, with
identical vendor gitlink/lockfiles verified and platform-correct frozen installed
dependencies. Do not include retained diagnostic prototype files. Reuse only the
verified pinned toolchain/download cache; isolate each run's profile and account
environment. Keep the same 300s overall cap, 64MiB stream caps, --bail=1, normal
120000ms per-test budget, single process and truthful stopped/failed result.
Capture exact source/vendor identity and final exit/summary. Executor must send
fixture preparation and exact command for root review before running it.

### Controlled runtime comparison after native test-runner panics

Pinned Bun 1.3.14 panics during the frame-matrix list-editor suite on Windows and
Linux. Root reproduced the Linux panic on the older baseline as well as observing
one earlier baseline pass; it is not established as introduced by these repairs.
The first 217-file Linux attempt incorrectly forwarded the task-runner-only port
offset to Bun, so it is invalid as an exact replay and cannot be counted green.
A corrected one-file run also panicked. Preserve both facts rather than erasing
an execution mistake. The Windows 217-file run likewise has no final summary.

Root used the already installed explicit Windows Bun 1.4.2 (744846f84) with the
same isolated runner and exact test arguments: all 55 tests/291 assertions passed.
This bounded contrast motivates another experiment; it does not approve a runtime
pin change, establish a general fix, or satisfy the release gate.

Permit a read-only inventory of known task-local Linux Bun executables, followed
if necessary by a task-local official Bun 1.4.2 download verified against its
published SHA256. No global install, privileges, dependency edits, replacement of
1.3.14, or changes to product source/pins. Send exact identity/preparation proposal
for root approval before download/run. Then compare the same exact fresh candidate
frame test with isolated profiles, actual Bun flags only, 120s overall cap and
64MiB output caps. Preserve version, source/vendor/lock identity and final exit.
If it passes, propose further bounded replay and toolchain compatibility review;
do not silently upgrade the release or alter tests to avoid the crash.

### Measure Linux Chrome readiness before changing the launcher

Manual diagnostic 41294103064 reproduced the original public failure on the exact
reviewed source: CDP refused at 2.5s, then owned cleanup terminated a still-live
Chrome at about 2.7s. Only a DBus warning was captured. That warning is not proven
the cause; eventual readiness remains unknown. No launcher fix is approved yet.

Permit one scoped extension of the existing manual diagnostic: after preserving
the unchanged public test's real exit, launch a separate owned Chrome under a new
fresh task profile, with the same original flags and isolated environment. Measure
first DevTools-listening/owned-CDP readiness for at most 15 seconds, capture bounded
stderr and actual exit, then terminate/drain only that owned process group. Record
flag/profile differences explicitly; never hide the public test failure or turn
it green based on a standalone probe. No sandbox disabling or ambient profile.
Reuse the existing capture/cleanup owner rather than adding a parallel supervisor.
Independent review and root diff inspection precede commit/push/one manual dispatch.
The top commit must retain skip-ci/skip-release markers. This diagnostic remains
manual-only, standard free runner, read-only, bounded and logs-only.

### Reset and unmount the Compendium test fixture

The controlled Bun 1.4.2 replay reached 1,211 tests/155 files without a runtime
panic, then failed the Compendium read-only assertion. That run used the pre-fix
snapshot copy of compendium-wing.test.tsx (SHA256
f7c1e6a52d94767016f25ccb218b373a04fe77fa65f36d2ce1384ffe3201137c), not the
canonical edited fixture. The pre-fix standalone file passed 18/80; the pre-fix
writer→consumer sequence scene-lore-entries.test.tsx then compendium-wing.test.tsx
failed on the writer's legitimate disabled-storm patch because the consumer did
not reset the shared rig. Its read-only API proxy rejects writes, so this was
fixture leakage rather than a product write.

The canonical fixture after repair is SHA256
5a48012bce62906aecb84cd3c6623ef9054c230c4b0e967d4a0a0c63917915c7. A temporary
one-file overlay verified that hash, ran the writer→consumer sequence on the same
Bun 1.4.2+744846f84 environment, then restored and reverified the original snapshot
hash. The corrected pair passed 37 tests/142 assertions; the corrected standalone
passed 18/80; the corrected immediate-predecessor pair passed 33/154. All three
exited 0. These are focused fixture checks, not a rerun of the 217-file set.

Authorize ONLY src/ui/apps/scenes/compendium/compendium-wing.test.tsx: import and
reuse existing resetLore() in beforeEach, then reset local calls; use existing
unmount(flushSync) in afterEach for each mounted root, before DOM teardown. Preserve
all existing assertions, three-read API contract and expected empty recorders.
No production behavior, shared-rig contract, test selection or timeout changes.
Run the unchanged two-file RED sequence GREEN, standalone suite and adjacent lore
fixtures with the same verified isolated Bun 1.4.2. Obtain independent scoped
review and root verification before normal-hook commit; do not call this a full
replay pass or silently change the release pin.

### Replace the Chrome startup guess with bounded owned readiness

Manual run 41295707733 preserved the public startup failure and measured a
separate owned Chrome: DevTools at 2.391s, nonce-matched CDP readiness at 4.423s,
clean shutdown. The identical flag list differs only by recorded fresh profile,
port and isolated profile paths. This proves a 2.5s fixed sleep is shorter than an
observed startup window; it does not identify a DBus warning as a fatal cause.
Other unchanged public runs pass, so retain the intermittent evidence honestly.

Authorize scripts/theme-measure/driver.ts's launch owner to wait for actual owned
Chrome readiness within a fixed startup deadline (20s), rather than sleep2500.
Preserve existing caller port semantics and all test assertions. Use a fresh
owned profile beneath work and consume bounded stderr (64KiB tail) to obtain the
complete DevTools websocket endpoint/nonce from THIS spawned child. Validate
loopback, requested port (or the actual assigned port if requested0), browser path,
and absence of credentials/query/fragment. Attach only that owned endpoint; no
fallback that could attach another process at a guessed port. Bound the CDP
handshake by remaining startup time; if needed retry only within that deadline
while the same owned process is alive. Detect spawn/early-exit errors promptly.
On every startup failure clean up this child and any partial browser connection;
retain safe bounded diagnostics and actionable error. Preserve Windows manual
launch support, Browser interface and all existing caller behavior.

Do not add a separate competing launcher or new dependency. If helper extraction
is necessary it must have one authoritative owner and keep authored files under
500 lines. Send exact source/test proposal before editing. Use the existing
public protected-browser suite as the real RED/GREEN boundary: old exact source
has the recorded startup refusal, final exact source must pass in isolated
Windows and on the standard Linux diagnostic runner. Include deterministic
coverage of delayed readiness, early child failure, nonce validation and cleanup
using existing testing patterns; do not merely mock a final successful result.
Obtain independent review and root verification before commit/push. The full
normal release gate remains required after this focused repair.

### Align the release toolchain with the verified Bun runtime

The official SHA-verified Bun 1.4.2 comparison passes the formerly crashing frame
suite on Windows and Linux (55 tests/291 assertions each), and the corrected
217-file replay with committed fixture repair passes all 1,785 tests/6,834 asserts.
The replay is not the full release gate. Bun 1.3.14 panics on old and new source;
there is no basis to weaken tests or attribute the native panic to a repaired
feature. The official 1.4.2 notes mention JIT/GC fixes, but matching a specific
upstream fix to this crash is an unproven hypothesis.

Authorize .bun-version to pin 1.4.2 and package.json's existing engines.bun floor
to become >=1.4.2. Existing CI/Pages/release workflows already derive their exact
runtime from .bun-version; keep that one build-pin owner. Do not add overrides or
change @types/bun, dependency versions, vendor gitlink, test flags or gates.

Update current development/install claims in docs/03-CONVENTIONS.md,
docs/guide/getting-started.md and docs/guide/installation.md to match. Preserve
historical evidence under plans/evidence. docs/reference/ui.md's earlier 1.3.14
native-cache proof must remain clearly historical, never be relabeled as 1.4.2
proof without running it. Use existing summary sidecar, receipt and docs-index
commands for changed docs; never hand-edit generated catalogs. Keep unrelated
installation/publication claims unchanged until a real release exists.

Before commit, prove a fresh isolated Linux candidate can install the SAME frozen
root/vendor lockfiles under the verified 1.4.2 toolchain without resolving new
dependencies or mutating the prior snapshots/shared node_modules. Run typecheck
and the existing SQLite runtime probe against this candidate. A necessary lock
format/dependency change is a stop-and-report condition, not permission to update
the dependency graph. Reuse the already measured frame and217 results rather than
rerunning unchanged groups needlessly. Obtain independent config/docs review and
root verification; commit with normal hooks, preserve concurrent launcher work.
After both repairs pass focused checks, the exact new release must pass the full
unchanged verify:ci (apart from approved fail-fast), packaged S21 and build matrix.
This runtime change does not authorize bypassing any release verification.

### Validate the reviewed combined commit before Mainstage delivery

The local Linux fixture has no Chrome; a skip cannot establish real-browser
success. The new source must exist on a remote ref for the existing manual
standard-runner diagnostic to execute it. Resolve that dependency by pushing the
independently reviewed, normal-hook combined runtime/startup commit to the precise
validation branch validate/release-startup-20261101, then dispatch only the manual
browser diagnostic against that exact branch SHA. Do not overwrite an existing
branch without verifying its ownership/ancestry; use a uniquely named task branch
if occupied. No force push, release, tag, publish or paid runner. Keep skip-ci and
skip-release markers so this does not launch an unrelated full matrix.

This reversible validation push is within the user's source-delivery authority;
it does not claim success before the run. Root and independent source review,
unit/Windows public checks, and combined typecheck precede the commit/push. The
Linux public suite and owned probe must report their actual results on that same
SHA. Once GREEN, fast-forward Mainstage to the exact validated commit (or revalidate
if its source changes), then start the one normal release gate. No pre-push hook
bypass beyond the owner's already authorized source-push exception; normal commit
hooks and all release checks remain required.

### Derive the docs-search fixture from the runtime pin

Normal v0.1.44 run 41298220078 stopped at its first failure after555 tests/71files:
site/docs-search.test.ts still queries Bun1.3.14 while the correctly regenerated
installation guide now says1.4.2. No binaries were built/published. The existing
held-fetch assertion and installation-link assertion are meaningful and unchanged.

Authorize ONLY src/site/docs-search.test.ts to read the query version from the
existing authoritative .bun-version, using its existing readFileSync/join/root.
No search implementation, assertion, timeout or gate change. Root also found the
only other source/scripts occurrence in src/site/pages.ts: the source-install
page hardcodes1.3.14 and incorrectly advertises optional Kit release builds. Keep
the pure page module pure: link to the authoritative .bun-version instead of a
second numeric version, and describe the existing CLI/desktop/helper release
matrix truthfully. Preserve no-published-assets claims until actual publication.
Use existing site tests for this reversible copy fix; no new low-value test.

Fast-forward the clean task branch to the bot's reviewed two-file0.1.44 bump
67a4b2c first; preserve v0.1.44 immutable. Run existing docs-search/site pages and
egress tests with verified1.4.2/isolated profiles. Root reviews diff and independently
reruns docs-search before normal-hook scoped commit/push with skip-ci/skip-release.
After that, dispatch exactly one new normal release (next available tag, never
retag v0.1.44). Its full gates remain required. No need to revalidate unchanged
Chrome/toolchain through another diagnostic branch for this test/copy-only fix.

### Acknowledge the reviewed fingerprint change in the storage tripwire

Normal v0.1.45 run41298785367 reached6176tests/655files before the storage-shape
tripwire failed; docs-search and all9 actual protected-browser cases passed.
No build/publish occurred. Root and an independent reviewer each recomputed the
unchanged88-file manifest against708e8d5: baselinef1706f2b902d1e801429927ee4b7af908e70977950bca036a3e4338aded9ee06,
currentdd80128451656e177f9fc720b6abbfd927ab061fd37fabb7c332ac67c36cb347.
The ONLY changed pinned owner is row-fingerprints.ts's previously reviewed single
Core-birth spec line: existing origin coverage plus own fingerprint version2.
Entity/cell shapes, applied migrations, manifest, health readers and switch policy
are unchanged. Existing v1-old/adoption, v2tamper and damaged-cell refusal tests
exercise the version mechanism. Independent review approves this compatible
acknowledgment; no SQL schema bump or applied-migration edit is warranted.

Authorize ONLY src/ui/switch/storage-shape-tripwire.test.ts: change the expected
hash to the reviewed current digest and add one concise dated compatibility note
(maximum two lines, staying within the actual500-line guard). Preserve every
manifest entry, runtime-schema count assertion, normalization and hash assertion.
Do not delete unrelated history or weaken detection. This is deliberate approval
of the already reviewed FPv2 delta, never a blind acceptance of CI's received hash.

Fast-forward the clean task branch to4d335825's two-file0.1.45 bump first; preserve
v0.1.45 immutable. Run the real tripwire, existing row-fingerprint coverage and
new Core-origin version/adoption/refusal tests with verified isolated1.4.2. Check
actual authored line count and normal hooks. Root reviews diff/reruns the tripwire
before scoped normal-hook commit/push and exactly one next normal release. Its
full gates still apply; no extra unchanged browser diagnostic is required.
