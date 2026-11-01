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
