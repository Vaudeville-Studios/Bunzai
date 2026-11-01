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
