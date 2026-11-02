# Plan 010: Resume normal Bunzai binary publication

Owner steering on 2026-11-01 returns to binary publication, the task paused for
test reduction. Preserve all unfinished Plan009 changes in their separate tree.
Repository: Vaudeville-Studios/Bunzai. Published Mainstage/tag v0.1.46 is
70ab382c1827721004912eb8f613baf4da4901c0. No binaries or active release currently.
The last auto-release 41300095236 failed verification at the Kit queued frame.
The owner chose normal release verification; no gate bypass or preview release.

## Isolation and scope

Use a new isolated worktree/branch from exact70ab, not the dirty user's Mainstage,
nor the broad test-reduction checkout. Existing release-verification tree contains
uncommitted advisor plans and must not be reset. Do not touch other worktrees.
Read AGENTS.md, vision, architecture, conventions, CONTRIBUTING, accepted decisions,
distribution/install docs and existing test/helper ownership before implementation.
Root advisor edits plans only; separate executor implements and commits after review.

First source scope is exactly two already reviewed Plan008 test repairs copied
byte-for-byte from Bunzai-test-reduction-20261101:
- src/kit/render/app.test.tsx: settleUntil actual two calls/no QUEUED frame instead
  of a fixed180ms delay, keeping all final assertions.
- src/studio/scene-turn-prompting.test.ts: compact real overflow payload and both
  original/pre-send and reviewed-edit refusal boundaries, no production change.
Do NOT import broad Plan009 reductions, hooks, package command changes or helpers.
Preserve the release workflow and supported Bun1.4.2 pin, vendor9cce and locks.

Investigate the known scripts/extension-required-families.test.ts mismatch through
the actual scenes.create runtime and both Desktop/Terminal integration boundaries.
The matrix currently claims native scene creation is unavailable while the published
catalog/docs advertise it. Reproduce unchanged RED in fresh profiles. Trace commit
authorization, frozen cast, RP-Core session linkage and rollback/refusal before
proposing a matrix correction. A stale exception may be removed only if existing
real integration proof demonstrates the implemented native contract; do not change
expected hosts merely to match generated output. Return exact proposed scope and
proof for root review before editing the matrix or production.

## Execution and proof

Use existing pinned C:/Users/chiev/.bun/bin/bun.exe1.4.2. Fresh allowlisted TEMP
profiles must redirect HOME/USERPROFILE/APPDATA/LOCALAPPDATA/BUNZAI_HOME/CODEX_HOME,
CLAUDE_CONFIG_DIR and XDG directories BEFORE imports, BUN_OPTIONS=--no-env-file,
PATH prefixed exact runtime. Never use user libraries or credentials. Reuse frozen
dependencies with a read-only junction only after package/lock/vendor hashes agree;
do not install into that shared junction. No dependency/version/vendor changes.
Capture command, cwd, source hashes, logs, exit, actual pass/fail and outer bound.
No empty manifest accidentally launching the full suite. Focused runs retain
--timeout120000 with bounded outer120s; no unexplained baseline reruns.

Run focused Kit/prompting and required-family/native scene creation proofs first.
Root source review and independent adversarial review precede a scoped normal-hook
commit. Update generated docs only via the existing owners when required. User's
prior push/release authorization remains valid for this repository and destination.
No force, no bypassing test gates. Validate exact source locally before one normal
release attempt; repeated old failing dispatches are not progress.

After scoped fixes pass, run unchanged verify:ci once with captured logs and fresh
profile on the exact candidate, bounded to45min overall but report progress at least
every60s. Stop on actual first failure and diagnose the owning boundary. Do not hide
failures, alter assertions, delete tests or bypass acceptance to get assets uploaded.
Only the reviewed candidate may be delivered to Mainstage with the existing release
workflow. Tag/version bumps remain owned by auto-release. Existing v0.1.46 immutable.
Observe Linux/macOS/Windows builds, packaged S21 and artifact checks; published means
actual GitHub assets plus SHA256SUMS, not merely source push or a local Windows exe.

If executor availability is blocked, preserve prepared results and report the exact
block without claiming release success. No paid service/toolchain change.

## Reviewed matrix reconciliation scope

Independent review confirms the old browser-only exception contradicts the current
native binding and durable Core birth path. Existing integration proves Terminal
creation but its Desktop section proves preview only. Executor may extend ONLY
src/kit/extensions/core-scene-guard.integration.test.ts after Terminal closes:
use the existing persisted, granted package and actual Desktop route owner to
activate its create command; observe and answer the actual pending confirmation;
assert no scene created before approval, completed output, frozen approved cast,
and exact scene/take Core linkage. Retain all current refusal/legacy/preview
assertions and cleanup. No stub native writer, new runtime or production edit.
After this boundary is GREEN, remove ONLY the stale scenes.create exclusion row
from scripts/extension-required-families.json. Expected hosts still derive from
the fixed acceptance rules; retain the test and all other rows unchanged. Record
the unchanged matrix RED, native proof GREEN and corrected matrix GREEN. This is
an evidence-backed reconciliation of an implemented accepted contract, not a
blanket approval to change gates to match a received value.

## Reviewed source-ownership repair

The unchanged live single-source-core test reproduced11 findings on the isolated
candidate (25pass/1fail/100assertions). Independent review approves canonical reuse
in these TEN product owners only; the guard itself remains byte-unchanged:

- src/extensions/runtime/turn-services.ts, scripts/theme-measure/driver.ts and
  src/ui/apps/scenes/scene-core-wing.tsx: import existing toErrorMessage and replace
  handwritten Error/message/fallback conversions. Preserve exact fallback strings.
  The canonical policy deliberately uses fallback for an empty Error message,
  already proven by src/error-message.test.ts; do not claim strict identity there.
- src/studio/core-scene.ts and scene-core-wing.tsx: replace copied object/string
  readers with existing recOr/str, aliases permitted to keep scope small. Preserve
  arrays/null fallback behavior. No new shared helper or decoder change.
- src/studio/core-inspect.ts: use isRecord in its nullable object adapter; preserve
  null for absent/nonrecord values. recOr is NOT equivalent to this contract.
- src/ui/server-chats-turn.ts: reuse hasErrorName while retaining the original
  instanceof Error requirement. Do not broaden error-class recognition.
- src/stage/store/sqlite/chat-store-core-state.ts, chat-store-state.ts and
  core-record-projection.ts: substitute existing LIVE/liveOf only for literal
  SWIPE live predicates. Preserve all message/branch/chat checks, query params,
  transactions, lease/fence assertions and returned columns. Emitted swipe SQL
  must be identical; do not alter migrations or shared LIVE definitions.
- src/ui/apps/docs/docs-core.ts: external-href classification uses existing
  safeOutwardHref(rawHref)!==null. Do not use isSafeHref, which would prevent
  relative and anchor links from reaching their existing rewriting branches.

Verify unchanged live guard RED→GREEN; guards/error-message; docs-core/render-policy;
core-inspect/scene-core-wing; turn-services/server-chats-turn; Chrome startup;
real core-record-authority/core-extension-state and ChatStore state SQLite owners.
Keep real cut-swipe refusal/identity and native Core birth proof. Root and independent
review actual diff before scoped normal-hook commit. No gate exception, no broad
test reductions, no unrelated cleanup. Stop for a semantic mismatch rather than
adjusting assertions. Existing schema/locks/vendor remain untouched.

### Uncut timestamp owner clarification

The guard is table-blind and also reports message.cut_at predicates. Independent
review traced migration9 and migration29: swipes.cut_at explicitly follows the
message epoch-ms/null-uncut convention. The actual shared contract is the uncut
timestamp predicate, not complete message visibility. Executor may therefore use
liveOf("m") in the TWO existing message predicates as well, producing identical
SQL. Update only LIVE/liveOf comments in swipe-sql.ts to describe that shared
uncut timestamp behavior; remaining positional helpers stay swipe-specific.
Preserve every separate cut_id, ownership, lease, fence and deletion condition.
This supersedes the earlier swipe-alias-only restriction for these exact two
predicates. No guard edit, parser, allowlist, ISNULL spelling evasion or migration.

## Reviewed checkpoint and nonduplicate delivery sequence

Final15-file source diff (+90/-68) independently approved. The unchanged ownership
guard is GREEN26/100. Root independently reran native Desktop/Terminal Core birth,
browser broker, acceptance matrix, Core SQL authority and docs rewriting:25pass,
161assertions, fresh profile, Bun1.4.2. Executor final affected-owner checks and
whole typecheck remain required before a normal-hook scoped commit.

Avoid an extra standalone full-suite run immediately before the existing push hook,
which ALREADY runs typecheck, extension gates and the complete test suite. After
focused checks/review/commit, the executor may make ONE normal, nonforce push of
this task's exact HEAD to Vaudeville-Studios/Bunzai Mainstage, only if the remote
still equals70ab (or is verified ancestor with no unreviewed source drift). Retain
all pre-push hooks, exact Bun PATH, no dotenv, and fresh test profiles; retain Git
authentication config without exposing credentials to test environment. Capture
hook logs and progress rather than bypassing/replacing the hook. Failures stop
delivery and require owner-grounded repair, not skips.

That push starts the existing normal auto-release. Its unchanged verify:ci is the
complete release-wall execution, so no additional local full wall is needed before
the push hook. This supersedes the earlier extra local-wall step only; NO gate is
removed or bypassed. Observe exact tag/source identity and all build/S21/publish
jobs. Keep the broad reduction checkout unmodified. No duplicate manual release
dispatch if the push already started one. Existing tags remain immutable.

## Director-list correction before delivery

Normal precommit found three unbounded JSX maps in scene-core-wing. Fixed five
collection sections and the existing inspected-memory PAGE_SIZE20 are genuinely
short by construction and may retain precise bounded-ok comments. The Director
entry bound annotation is REJECTED: records.read yields raw JSON-cast entries,
directorOnPath does not call checkRecord/checkState, and RP-Core accepts dir as
anyObj. Private vendor validators are not a supported import or an existing bound.
Commit1e5ca2b contains that unsupported annotation; its push was stopped in the
pre-push typecheck BEFORE remote mutation. Preserve that commit, do not reset or
amend history; correct it in a second normal-hook scoped commit before delivery.

Executor may change scene-core-wing.tsx to replace ONLY the unbounded Director
entries.map renderer with the existing VirtualRows from ui/_shared/virtual-list.
It auto-discovers the panel scroller and supports variable measured row heights.
Keep each existing entry text, seed payoff, status, ordering, section count and
empty state. Stable key is existing id with existing index fallback. Do not
truncate, add a second virtualizer, import private vendor modules or change Core
state persistence. Remove the unsupported annotation; retain proven short maps.
Use the established VirtualRows estimate/measurement conventions; no new CSS,
dependencies, hardcoded colors or layout primitives unless a measured need appears.

Extend existing scene-core-wing.test.tsx with a public rendered large-list case
that would mount all rows before this fix, retain all existing switch/seed/wiring
tests. Reproduce RED before applying windowing, then GREEN. Demonstrate scrolling
to a late entry in an actual browser using the real component with isolated fixture
data and the actual panel scroll styling; capture first/last visibility, bounded
mounted rows and browser errors. This is component browser proof, not packaged
Desktop or full user-journey certification. Update the RP-Core wing paragraph in
docs/reference/ui.md and required generated docs through existing scripts.
Root/independent review actual source and live evidence before committing. Rerun
affected wing/shared virtualizer checks plus final typecheck when sources freeze.
Do not repeat unchanged database/Chrome campaigns for this renderer-only delta.

## Compatible SQL source-pin acknowledgement

Root isolated tripwire RED found the expected source digest changed. Independent
comparison confirms identical88-path manifests (LF-list SHA256
c07c23e65fcbe4fc05e5443500d9bb2bdacf0eeccc90d8e8355553697e9ddb80).
Only chat-store-core-state.ts, chat-store-state.ts and core-record-projection.ts
differ among pinned owners: imports plus the reviewed byte-identical SQL predicate
substitutions. No schema, migration, fingerprint, manifest or assertion changes.
Baseline dd80128451656e177f9fc720b6abbfd927ab061fd37fabb7c332ac67c36cb347
becomes556c09498d8feac7e5fdc869874e48d9bdbea2b3152b85e36eaa307287442595.
Executor may change ONLY that expected digest in storage-shape-tripwire.test.ts
and add ONE dated compatibility-comment line (file499→500lines maximum).
Do not alter SCHEMA_BUMPS, applied migrations, manifest, runtime-schema count or
hash assertion. Run focused tripwire GREEN plus line guard; no whole typecheck
rerun for this comment/literal-only test acknowledgement. Root reruns the tripwire
before normal-hook scoped commit and the normal push. Preserve previous commits.

The task-only hook launcher now uses env-i explicit OS/profile allowlist, exact
Bun1.4.2 and isolated Git config, preserving parent Git authentication. Its
dirname-owned profile avoids ambient control variables. MSYSTEM=MINGW64 is an
explicit platform marker. Actual nested bun-run→Node/bunx/compiler probe passed;
no bunx wrapper is needed because the sanitized parent environment is inherited.
All repository hooks and source commands remain unchanged. Use a fresh task
profile for the actual run; previous owned aborted profiles remain archived.

## Boot fixture fetch ownership investigation

Full pre-push attempt3 first failed at chrome-startup's real delayed-child case:
the owned child announced its endpoint, but the unchanged10s test timed out.
Exact isolated case passed1/17 in3.58s. Push stopped/drained; remote stays70ab.
Code read found App.boot-retry.test.tsx and App.boot.test.tsx mutate global fetch
but afterAll only tears down DOMs, whose current owned globals omit fetch.

Executor may reproduce the actual ordered two boot files followed by a task-only
copy of ONLY the unchanged first Chrome case, retaining assertions/10s deadline and
the actual production driver. Run all predecessor callbacks, not a global test-name
filter. Temporary diagnostics may record fetch identity/attempt errors/HTTP status
and child receipt; do not edit canonical sources or increase timeouts for diagnosis.
No repeated entire suite to establish this small cross-file failure.

Independent lifecycle review approves the minimal repair IF ordered RED confirms
the leak: add `fetch: globalThis.fetch` to BOTH existing beforeAll installDom
options.globals. The existing authoritative owner snapshots that descriptor and
awaited teardownAllDoms drains then restores it. Preserve all other setup, behavior,
assertions, retry delays and timeouts. No new helper, manual parallel restore,
production fetch replacement, new test registry or Chrome gate relaxation.
Prove ordered cohort GREEN with actual local-server readiness, then root and
independent source review. Root runs a bounded ordered replay before normal-hook
scoped commit and the next normal push. Preserve prior commits. Full gates remain.

### Second fetch fixture owner confirmed

After boot cleanup, the next normal full run still hit the same Chrome case.
The32-file default-order diagnostic campaign reproduced228pass/1fail: the connector
received mock200{"phase":"unlocked"}140times, with no HTTP request reaching its
owned child. A63-file probe campaign (260pass/646assertions) traced native fetch
through probe10 after App.boot; probe11 after library-gate-mount.test.tsx introduced
the exact impl hash e0921a9b2d7691b614e60aabfb0d4bcb9a09b685823e07bf3d79ada5138826a0.
All later probes retained that responder. Canonical source stayed unchanged.

Executor may change ONLY library-gate-mount.test.tsx's existing installDom globals
to also own fetch:globalThis.fetch and EventSource:globalThis.EventSource. Its
beforeEach currently replaces BOTH globals; awaited teardownAllDoms must restore
their prior descriptors, including deleting a previously absent EventSource.
Preserve all beforeEach behavior, test assertions, polling and deadlines. Reuse
the existing global owner; no new helper, registry, Chrome transport or timeout.
Run the same31mutator→firstChrome default cohort GREEN and a final probe proving
fetch and EventSource return to their original values/descriptors. Root and
independent actual-source review precede scoped normal-hook commit/push. No
entire suite retry until this full bounded mutator cohort passes.

## Reconcile observed remote publication and release47

GitHub is authoritative over the earlier local stop reports: Mainstage is now
fb562e0d6fab79d42ed978447af47311bfd84d0d, releasebot v0.1.47 with EXACT parentae75f09.
Compare70ab..fb562 confirms our four source commits plus ONLY the bot's package.json
and src/version.ts bump. Thus ae75 reached Mainstage; do not claim it stayed local.
Pages41384961386 succeeded on ae75. No binary assets exist. Auto-release41384961495
failed verify after9596tests at real Lua WASM loading (not an asm header), which may
share the now-proven leftover global-fetch mock cause; investigate before naming
that linkage proven or changing production WASM loading.

Pending55419cf is the independently reviewed library-gate cleanup with all31mutator
cohort/root229tests GREEN. Fetch the exact remote Mainstage, verify bot-only diff
and ancestry, then integrate it via a normal non-rewriting merge into the isolated
candidate. Preserve all source/evidence/untracked plans. No resets, force pushes,
retags, removal of bot version, or production/dependency changes. Confirm both
version homes remain0.1.47 and all actual product source changes relative tofb562
are ONLY the approved library-gate globals snapshot (plus task documentation).

Root/independent merge review and focused version-parity/cohort proof precede a
normal-hook delivery to Mainstage. This starts the next normal release train;
existing v0.1.47 is immutable. Observe native hook final summary/exit AND actual
remote SHA, then GitHub run/tag/source identities. Buffered or mixed progress
output cannot establish that a push did not happen or that a gate passed.

## Repair confirmed CI prerequisite setup

Primary completed job logs from CI41384961478 show ALL FOUR configured packaged
SQLite jobs passed the standalone compiled SQLite probe, then failed compiling
the background-lane probe because zod/fflate/noble/scure dependencies were absent.
The obsolete no-install comment predates that application's import graph.
Executor may change ONLY ci.yml setup: preserve the standalone builtin-only
compile AND native run BEFORE dependency installation; add frozen ROOT
`bun install --frozen-lockfile` immediately before background-lane compilation.
Do not add vendor installs without an actual graph need. Preserve all targets,
compile entrypoints, artifact execution, timeouts and refusal assertions.

Linux keychain job failed actual seal/open because its default login collection
did not exist; it invoked a GUI prompter without DISPLAY. Current stdin is EMPTY.
Ubuntu's official gnome-keyring-daemon manpage documents that --unlock reads a
password from stdin and creates the login keyring if absent:
https://manpages.ubuntu.com/manpages/stonking/man1/gnome-keyring-daemon.1.html
Executor may replace only empty printf input with a fixed, clearly synthetic CI
password, consistent with macOS's existing ci fixture. Keep private dbus-run-session,
the real Secret Service daemon and existing probe; no session-only alias, fake
backend, skipped check, display prompt bypass, credential change or acceptance cut.
No local Linux package/global-service installation is authorized. WSL lacks the
keyring tools, so real keychain success remains pending the actual CI job.

Validate YAML and dependency/step order through existing tools; compare the exact
two-job delta. Root and independent actual-source review precede normal-hook
scoped commit/delivery. Run the existing version parity test for the bot merge;
reuse unchanged31-file cohort hashes rather than repeating unrelated campaigns.
New CI must compile AND run both native artifacts and pass the actual keychain
probe before those platform claims become verified. Do not claim the proposed
setup fix already passed remote CI. No release-workflow acceptance changes.

Message-only exception: the unpublished task CI commit c1188 received a truncated
subject through shell quoting. Executor may preserve its exact SHA under the
precise task safety ref, then amend ONLY that latest task commit's message using
an owned --file input and normal hooks. Verify identical tree and parent before
and after, no remote publication/force push, and preserve every earlier commit.
This narrowly supersedes the earlier no-amend caution for that message only.

### Attempt3 native failures and bounded follow-up

Preserve the complete attempt3 native summary and Git exit before editing source.
An abandoned attempt2 hook was proven by its exact task profile and process
ancestry to be running concurrently. Executor terminated only that prior owned
tree; current attempt3 remains intact. Do not treat the interrupted attempt2 as
verification. Before another full run, prove no prior task-owned full suite remains.

Observed attempt3 failures: crypto responsiveness 101.96 ms against <100 ms;
2,000-message state rebuild 225.04 ms against <200 ms; extension manager revision
refresh still enabled after a guessed 2,100 ms; effect review still loading after
a guessed 30 ms. Do not increase performance limits or infer production faults.
After native exit, run the unchanged failed owners singly in the same isolated
environment, with no competing verification. Record exact results.

For `src/ui/apps/settings/sections/extensions.test.tsx`, authoritative DOM wait
owner already exists: `waitFor` in `src/ui/_shared/test-dom.ts`, which flushes React
and fails with a named condition after a bounded wait. Production revision owner
is `checkRevision` plus `useVisibleInterval(..., 2_000)` in extensions.tsx.
Executor may repair only the two failed fixtures after honest mounted-component
RED evidence of the race. Wait for initial visible state AND completion of the
initial revision request before changing the revision fixture; then await actual
disabled state and absence of Go. Await actual reviewed targets before clicking
the real approval control, then await the recorded exact ticket answer. Preserve
all original assertions, approval identity, real manager path and real polling.
Use the existing DOM helper, not Kit render helpers or a new timer utility. Ensure
roots unmount and hosts are removed in finally, including failing assertions, so
a failed test cannot leave an active manager polling into later tests. No broad
fixture rewrite, production polling change, fake approval or weakened check.

Review exact test-only diff independently, run focused owners and typecheck, then
normal scoped commit/push hooks and the actual release workflow. A clean focused
timing rerun alone does not satisfy the required full release gate.

### Remote v0.1.48 verification follow-up

Attempt5 normal push passed all hooks and 16,520 tests, 55 skips, one todo,
zero failures (1,737.25 s); remote c6029b8 triggered tag v0.1.48 at fc533738.
Pages deployed. Four compiled SQLite/background probes and both actual keychain
backend jobs passed. No release assets were published: first release verification
failed Chrome readiness, while both the exact-tag browser diagnostic (9/33 plus
owned CDP readiness) and normal Ubuntu CI browser passed. A single unchanged
failed-jobs rerun passed browser but failed a different UI fixed-sleep fixture.
Do not retry v0.1.48 again without a reviewed correction or change Chrome flags.

Native remote RED: job125117649421 failed
`src/ui/apps/scenes/scene-prompting.test.tsx:248`, the inline/status Scene Note
save-refusal case: after settle(1100), state was Unsaved without the required
error. Reuse existing DOM waitFor to await actual refusal state and status
receipt, preserving both original assertions and actual one-second autosave.
Inspect this file's root ownership: it has many mount calls, only one explicit
unmount, and no per-test root cleanup. Repair the existing mount lifecycle with
one authoritative per-test cleanup so all owned roots and host nodes are removed
even on assertion failure. Remove redundant manual cleanup when subsumed. Do not
rewrite unrelated cases or debounce production behavior. Native CI failure is
the RED receipt; verify focused full file and cleanup after the exact failed case.

Mac CI job125114742995 aborted Node22.23.2 at its ~2GB V8 heap limit during tsc,
not on a TypeScript diagnostic. Official GitHub runner reference lists macos-14
ARM standard runners with 7GB RAM; Node CLI documents max-old-space-size:
https://docs.github.com/en/actions/reference/runners/github-hosted-runners
https://nodejs.org/api/cli.html
Executor may add a 4096MiB NODE_OPTIONS heap allowance scoped to the existing Mac
typecheck step (matrix conditional preserves Windows's current environment).
Keep the exact command, runner, job limits, matrix, subsequent tests and all
release gates unchanged. Validate YAML and exact diff; actual Mac success remains
pending the next CI job. No dependency, paid runner or global setting change.

Separate Ubuntu CI job125114742841 failed a keychain fixture's maximum observed
wall-clock lock age 325ms against <250ms; stale threshold400ms, heartbeat50ms.
Record this separately; no threshold or production-lock change is authorized by
that timing observation alone. The v48 release rerun passed that boundary.
Do not import the broad paused test-reduction work. After focused evidence,
independent actual-source review and normal scoped hooks, integrate the bot's
version-only remote commit without rewriting history, then push once for the
next normal release. Preserve every earlier failed run and never retag v48.

### Rebuild benchmark fixture preparation, only after attempt6 exits

Attempt6's dense-rebuild failure is 210.8899ms versus <200ms; Bun's 741.87ms
case duration includes setup and is not that measurement. One full suite was
active. The same unchanged owner passed attempt5 and measured127.9ms alone.
No production regression or GC causal attribution has been established.

The measured section follows allocation of 2,000 messages and 6,000 encrypted
delta rows. Existing authoritative benchmark conventions explicitly collect setup
garbage before timing: scripts/perf-gate.ts, perf-gate-health.ts, and
perf-gate-lore.ts. Do not change source until the current hook's native exit and
complete failure list are preserved. If this remains its only failure, executor
may run a bounded sequential comparison of the original exact benchmark and a
task-only copy with only Bun.gc(true) immediately after fixture insertion, before
the existing performance.now. Preserve source identity, normal preloads, real
cipher, original semantic/keyframe assertions, raw actual ms and native exit.
No simultaneous verification, new dependency, warmup rebuild, sample cherry-pick,
median/min substitute, changed payload, fake cipher or relaxed200ms limit.

If evidence and independent review support aligning fixture preparation with the
existing benchmark convention, permit that single GC call plus a concise reason
in the original benchmark. This is an explicit measurement-boundary correction,
not proof of a faster implementation or a general responsiveness guarantee.
No storage source/pin/migration change. Run the focused owner, review the actual
test-only diff, then normal scoped hooks and one push. Do not silently loop full
push attempts on marginal timing failures without examining the measured cause.

### Batch the autosave assertion class before another release attempt

Attempt7 normal push passed16,520 tests/zero failures and published76fb9a4.
Tagv0.1.49 is80eb5904. Its release verify job125147022584 failed a DIFFERENT
Scene Note completion sleep: default-note autosave had sent its patch but still
rendered Unsaved at scene-prompting.test.tsx197. Separate Ubuntu CI job125146921998
failed scene-lore-entries.test.tsx165 because the expected saved notice had not
rendered after PAUSE. Do not perform another immediate full push/release retry.
The user explicitly asked to fix and continue rather than repeat the whole suite.

Meanwhile Levi merged PR1, eb4e9a64, adding layouts/themes; the bot cutv0.1.50 at
290c2d3c. This cancelled old CI platform jobs via concurrency, not a completed
non-bail result. Preserve this collaborator work. Before edits, fetch and inspect
ancestry/file list; fast-forward the clean candidate through this normal descendant
chain. Verify the bot commit changes only both version homes. Do not force/reset,
revert PR1, cancel its release, or attribute its source to this task. Test the
actual integrated source; older clean results do not cover the new layouts.

Batch fixture corrections in scene-prompting.test.tsx and scene-lore-entries.test.tsx:
inventory ALL waits whose purpose is autosave completion, refusal, conflict reload,
or saved-status rendering. Replace guessed completion sleeps with existing
test-dom.waitFor (already re-exported by fake-lore-rig). Wait for the actual required
state/receipt before retaining each original assertion. Preserve deliberate
negative-window sleeps proving no premature write, typed-back no-op checks,
flush-on-close timing, exact patch counts/payloads/revisions and real production
debounce. Never wait for a positive state in a negative test. No production edits.

Use the existing fake-lore-rig unmount owner for reliable cleanup on failure;
if necessary make it idempotent and track actual mounted ownership, then invoke
that owner from this file's afterEach. Preserve tests deliberately unmounting
mid-case to prove flush-on-close. Do not replace the canonical helper or create
a second root registry. Run all callers of any modified shared rig.

Collect the remaining failures before another final full run: derive an explicit
ordered manifest from the actual Linux job log's file headers, including the
failed two owners and the still-unrun suffix, without dropping failing cases or
using bail. Preserve exact source/vendor/runtime/dependency identities, normal
preloads and120000ms test budget. Reuse existing isolated Linux diagnostic tooling
from Plan007 if available; a fresh task-only official Bun1.4.2 executable may be
downloaded only with its published checksum verified. Frozen dependencies belong
in that owned fixture, never global/user locations. Do not install a global
browser or change sandbox flags; this suffix is a diagnostic, not full release
verification. Bound the campaign to15minutes and64MiB per raw stream; hitting a
bound is incomplete/nonpassing. No concurrent local test campaigns. Prefer an
already sufficient real platform non-bail result over another diagnostic run.
Send exact manifest/preparation/command for root review before running. Batch
observed related repairs with focused RED/GREEN and independent exact-source
review. Broader new owners require a concrete scoped plan amendment, not guesses.
Only then one normal final push/full release gate. Keep all failed runs and
incomplete CI results visible; do not claim assets until actually published.

### Deterministic heartbeat regression after repeated real CI failures

v0.1.50 release job125151146899 failed the same heartbeat fixture at exactly250ms
versus strict<250, this time in its Mac-tool fake on Ubuntu. Prior Ubuntu CI had
325ms. Both are native RED receipts. Do not raise the250ms bound, drop the sample
count, fake the cipher, touch actual OS keyrings, or globally mock Date/timers.

Proposed narrow owner amendment requires independent plan review BEFORE source
editing: existing KeychainDeps may accept trusted optional now():number and
heartbeat(tick,intervalMs):cancel dependencies. Their defaults must be exactly
the current Date.now and setInterval/clearInterval behavior. Use the clock only
at existing age/deadline/timestamp reads in keychain-key.ts; substitute scheduler
only for its existing owned heartbeat. No expiry/period/default/locking/key-
creation/token/takeover/error change, no new subsystem or generic clock registry.

Replace ONLY the flaky own-heartbeat fixture with controlled logical time and
the real callback supplied by the owner. Hold the actual fake OS-tool marker
write behind a gate, after the real lock has been acquired. Establish that owned
lock's mtime at the exact chosen logical baseline (otherwise a future real mtime
could make negative ages pass a broken heartbeat). Advance at least six50ms ticks;
sample age BEFORE each callback, invoke the real callback, verify same owner
token and updated mtime. Preserve >5 samples and strict maximum<250. With a
disabled callback six steps reach300ms, so the original bound must actually fail.
Assert requested interval50ms; release gate, verify successful sealed/opened
value and one key creation, and verify cancellation. Always release/settle owned
work in finally so assertion failure cannot leave a pending creation or lock.

Keep the real-timer fresh-holder, stale takeover, replaced-token/lost-lock and
concurrent creation tests unchanged. The shared loop runs this fixture against
both Mac and Linux tool protocols using temporary files only. Prove adversarial
mutation: a callback that does not refresh mtime and an incorrect scheduling
period must fail deterministically; restore exact reviewed source afterward.
Do not commit mutation files. Focused complete keychain suite plus actual-source
independent adversarial review are required. This is test determinism/default-
preserving dependency injection, not a claim that real OS scheduling is bounded
by250ms. Keep it with the autosave batch before ONE final full delivery attempt.

### Accepted scope: publish Windows/Linux first; macOS held back

The user explicitly selected Windows/Linux first. Preserve all collaborator
layouts/themes and macOS source; do not undertake the separate Mac WAL/SQLite,
keychain-selection or native platform repair in this task. Record its actual
failures separately. Release.yml must build/publish only Windows desktop,
Windows CLI/helper and Linux x64/arm64 CLI/helpers: seven binaries plus SHA256SUMS.
Remove the Mac build job and its publish dependency/assets/checksum rows, without
changing the shared verify gate or Windows exact-artifact S21 produce/consume
steps. Update the release installation asset table and directly affected public
download instructions truthfully: Mac binaries are held back. Do not change
capability/target catalogs that also describe source-build support, or add a
parallel availability registry. Check existing consumers/tests of release assets.

Existing Windows platform CI was cut off at its30minute job limit while still
running passing cases. Permit a bounded45minute job allowance ONLY for Windows
in the existing tests-per-os matrix; leave Mac30 and all commands, assertions,
test selection and120000ms case budget intact. This enables complete verification,
does not claim faster tests, and does not resume broad test reduction. Standard
runner only; no paid infrastructure. Final Windows/Linux release verification,
native packaged probes and actual published artifacts are still required.

### Complete the related editor fixture owner, not one case per release

Observed13-file caller run is203pass/1fail, scene-lore-editor title/content still
original after helper's80ms sleep; isolated28/64 pass does not erase that RED.
Permit extending ONLY this owning edit helper and the one remaining two-switch
completion wait in scene-prompting. Trace shows LoreBookSession.save queues a
patch and fake-lore-rig applies it and increments the held book revision before
returning; use that committed revision as the readiness fence, not request count
alone and not repeatedly executing runLore. For expected-write edit calls,
snapshot rig.held book revision, perform the existing interaction, unmount via
the existing owner, await actual revision advance with shared waitFor, then
retain every original held-field assertion. Always clean up the mounted helper
in finally, including assertion failures. No production autosave/queue changes.

The only truly UI-only/refusal cases are invalid regex and expanded keyword
display. Give those explicit no-persist intent, retain their existing short
settling window and prove patch/revision remain unchanged. Do not opt out the
Condition test (it inserts Recency), the mixed boost-refusal test (it acceptskey2),
or boost-add/remove: source scene-lore-advanced.tsx sets boostAmount0.2 and
boostIds[], both absent in emptyLoreEntry, and the canonical diff preserves those
optional authored fields. These are actual writes.

Make the existing fallback/position fixtures nonvacuous rather than broadly
opting out: start the emptied-Order case at an authored order different from100,
and start the position-card loop at depth so World is a real change too. Preserve
all interactions and expected fallback100/card values. No new permutations or
tests. Replace the remaining two-guide switch settle200 with actual two-patch
readiness followed by the original exact ordered assertion; its existing
pre-debounce negative checks and real save period stay unchanged. Run the
existing13-file direct-caller cohort once after this batch, plus independent
actual-source review. Do not rerun just to fish for green if another cause appears.

### Canonical Escape owner in the collaborator layout

Actual source guard flags desktop98.tsx77 manually checking e.key. Permit only
the existing shared isEscapeClose(e.nativeEvent) import/call used by other JSX
owners, preserving menu-close action/layout. Keep guard rules unchanged and run
the existing layout/keyboard checks plus guard. No broad PR1 restyling/refactor.

### Remaining shared Windows/Linux fixture blockers from the complete Mac log

These are not the deferred Mac WAL/platform repair. Each is a concrete common
fixture mismatch or containment defect relevant to the shipped platforms.

1. scripts/hooks/pre-commit-merge.test.ts sandbox writes .githooks/pre-commit
without executable mode. POSIX Git warns and ignores it, so the real hook/staged
docs assertions fail. Create that fresh fixture file with mode0755. Keep hook
execution, stderr assertions, merge parents, staged-snapshot and untracked-work
checks unchanged; do not bypass the final hook or relax the warning assertion.

2. scripts/macro-oracle/load-source.test.ts says current-platform root in its
header but converts a native POSIX temporary root into backslashes. The loader
correctly joins native paths through pathToFileURL. Repair the fixture to pass
its actual native root and name the test accordingly. Windows mkdtemp already
returns the Windows path this regression must cover. Preserve real dynamic
import and expected exported42. Do not alter production path semantics or turn
valid POSIX backslashes into separators to accommodate the incorrect fixture.

3. scripts/test-sandbox.ts claims no per-user writes yet deliberately leaves
HOME/USERPROFILE unchanged; actual Mac post-check recorded .bunzai/sessions and
kit-vault.json there. Fix this existing authoritative preload to isolate HOME,
USERPROFILE and APPDATA, plus relevant XDG config/data/cache/runtime paths in its
owned sandbox, reusing inSandbox. Create both standard Windows home/AppData/Local
and home/AppData/Roaming directories so headless Chrome/PowerShell can resolve
their profile. Existing LOCALAPPDATA should point at that owned local directory.
Keep BUNZAI/CODEX/CLAUDE/STATE isolation and ORIGINAL-location breach snapshots,
assertions and cleanup. Do not suppress the breach audit, modify appDataDir or
redirect production defaults. Do not nest TMPDIR/TMP/TEMP anew: the documented
Unix socket path-length failure makes that an unrelated regression risk. No
user/global environment change; this applies only inside test processes. Existing
strict-profile full Windows runs provide evidence that Git/DPAPI need not use
the real user's HOME, contrary to the preload's obsolete comment. Verify actual
Kit session/vault tests and real browser smoke under fresh outer task profiles,
and record all resulting paths inside the owned sandbox. No actual credentials.

4. messenger/settings/row-view.test.tsx40 still assumes exactly two layout
radios and index0 means Messenger. PR1's authoritative LAYOUT_OPTIONS now offers
nine. Repair the test's actual semantic contract: exactly one selected option,
Full Chat selected by default, Messenger found by its visible/accessibility name,
and the original stored messenger preference/repaint behavior after clicking it.
No hardcoded nine-element boolean vector or second layout catalog. Keep the
actual RowList/RadioCards components and clean the mounted root in finally.

5. messenger/settings/scene/writing.test.tsx64 reads a missing setScenePreset
record after wait900. Source saved.tsx has SAVE_MS400 and useDraft/useDebouncedSave;
this IS the same positive completion class. Batch that file's positive sampler/
prefill/custom-request completion sleeps (400/450/900) into shared DOM waitFor
with flushSync and actual expected API call/receipt, followed by every original
payload/count/order assertion. Keep initial control readiness truthful, negative
no-send/no-preset checks and real production debounce unchanged. Clean modified
mounts in finally. No production writer/event/provider changes without separate
RED boundary evidence. Run the complete Writing owner and adjacent row tests.

Existing doc availability statements should remain true both before and after
publication: link to published assets and give conditional source-install fallback
when assets are absent. Do not commit 'there is currently no public release' as
an enduring claim that becomes false as soon as this same commit publishes one.
Keep Windows/Linux target names and Mac holdback explicit. Update summaries and
review stamps through existing docs owners; independent semantic review precedes
generation. Limit copy edits to the directly affected release/Kit availability.

Use focused existing checks and the already collected full platform result to
batch these changes. Linux suffix may run once after refreshed source overlays
and manifest review if needed. Its source must be a genuine native Linux Git
checkout, not Windows .git path references. Task-only official Node22.23.4 is
also permitted if existing native Node cannot execute the source TS helpers;
verify its published SHASUMS and exact version, no global installation. Preserve
15minute/64MiB bounds, explicit ./ paths and non-bail diagnostic semantics.
Do not restart a full push/release until this common batch is source-reviewed.

### Additional Windows evidence from v0.1.50

The completed partial Windows log for job125151150872 contains a Cast Character
Lorebooks count failure at scene-cast-character.test.tsx182 after mount's fixed
80ms settling. Authorize the existing shared waitFor(flushSync, ...) to wait for
the actual bundled/added count line before retaining every original assertion.
Use existing afterEach unmount ownership. No production UI changes. Run the whole
Cast Character owner with the already changed lore cohort as a focused diagnostic.

The same log has the real on-disk ContentStore differential200-seed case timing
out at its existing60000ms boundary (native duration119414ms). Investigate fixture
setup cost before changing it. Preserve all200seeds, independent stores, real disk
WAL/FULL durability and cipher, semantic assertions and existing time budget.
Do not raise thresholds or retire scenarios. A derived empty migrated database
image is only a candidate, not an approved implementation until measured and
reviewed. No production storage changes are authorized by this finding.

### Generated component catalog sidecar reconciliation

Global docs generation exposed one existing stale sidecar from collaborator PR1:
reference/components source gained AdditionalLayout, Desktop98, FullChatWings,
Storybook and ChatLayoutRow styles; its semantic sidecar still has prior hashes.
Authorize only docs/summaries/reference/components.json reconciliation to the
current generated catalog (generic discovery description remains accurate, name
new layout entries where useful), existing author stamp, independent semantic
review and existing review receipt. Do not hand-edit generated components.md or
change runtime/component behavior. Regenerate derived summary/index outputs only
through their existing owners after exact-hash approval. This is a required
freshness repair discovered before the final gate, not expanded UI work.

### Measured on-disk fixture setup optimization

Setup-only probe on pinned Bun1.4.2 compared20 independent file stores: canonical
migration replay1361.3ms; canonical in-memory schema serialization34.2ms plus
cloned-file normal opens158.4ms. Schema SQL, every table count,52 migration rows,
derived_usage(1,0), user_version and normal WAL/FULL/FK/secure_delete matched.
This demonstrates avoidable setup work, not a whole-property time guarantee.

Authorize minimal test-only change in src/stage/store/content-store.sqlite.test.ts:
lazily derive immutable serialized bytes once from openStageDatabase(':memory:',
MIGRATIONS), always close that source handle, then write those bytes into each
unique new onDisk fixture path before existing normal openStageDatabase(path,
MIGRATIONS). Keep unique dirs, fresh testCipher/backend per rig, afterEach closes
and removals, full canonical schema and all production durability settings. Reuse
one owner in this file; no generated fixture committed, no production option.
Stay under500 authored lines. Do not change the shared200-seed property, its
assertions,60s budget or migration-specific tests. Run the full SQLite owner once
in strict isolated profile, capture actual duration and result; stop on failure
and report rather than repeat. Independent review required before delivery.

### Final static guard reconciliation

Non-bail static preflight finds authored conventions that have not yet been
reached by failed full CI runs. Minimal fixes authorized after root source reads:
- layouts/desktop98.tsx title and matching additional-layout.test.tsx accessible
  labels: replace em dash with a plain separator in both, preserving close/
  minimize/maximize/restore assertions and actual accessible names.
- src/site/docs-search.test.ts, guides.test.ts, documentation.test.ts: add truthful
  opening file-purpose docblocks only; no test assertion/behavior changes.
- scene-page.tsx448 compares the chat layout preference from chatLayoutOf, not a
  theme identity. Preserve its runtime selection. Use existing documented
  theme-key-ok reason on that exact branch explaining this domain distinction;
  do not add a broad allowlist entry or weaken the scanner. chat-layout.ts is
  the authoritative independent preference catalog.
Collect other static failures before expanding scope, preserve guards and run
these focused existing scans after the batch. Changes require final diff review.

The same collected static run also reports docs:parts:check stale. Authorize the
existing bun run docs:parts owner to regenerate docs/generated/theme-parts.md
from actual component data-part attributes and SLOT_IDS. Inspect generated diff;
no manual parts catalog or runtime changes. If semantic metadata exists and
becomes stale, report exact source delta for the same independent review before
restamping approval. All other static checks should be retained as collected,
with only failed/changed derived checks rerun after these scoped repairs.

### Linux diagnostic result and final ordering repair

The approved521-file native Linux non-bail diagnostic finished with4389pass,
1fail,58582 assertions; native exit1, supervisor monotonic476.953s, no timeout,
log-cap or drain issue, all46overlays unchanged. Raw logs/receipt live under
/tmp/codex-ci-v50-linux-suffix-20261102/attempt-290c-20261102-r3/suffix-run-20261102.
This is diagnostic coverage, not a whole-suite green result. Its sole failure is
scripts/hooks/single-source-syntax.test.ts135: same three reviewed streamBodyToFile
callers, different native filesystem enumeration order. Authorize local callers
helper sorting its collected path array before comparing the original exact list.
Keep strict membership, original assertions and production/shared walker intact.
Run the whole syntax test owner on this Linux checkout after copying only that
reviewed test change, bounded120s with native exit and raw logs. Do not rerun521
files for this deterministic comparison repair. Independent final diff review.

After focused repair passes, sync canonical Plan010, record concise current proof
and remaining macOS limitations, and prepare one scoped normal-hook commit of
reviewed files plus existing-authority generated docs. Exclude all eight untracked
probe/evidence files and task-local tooling; no source/version/vendor/lock drift.
Check actual origin/Mainstage and preserve collaborator work. Exact new commit
and unchangedremote preflight go in the normal push runner. Reuse the successful
approved200F shim env logic with a fresh task profile and exact Bun1.4.2, no hook
bypass and no concurrent full campaigns. Retain raw stdout/stderr, actual native
Git exit and query actual remote after completion. Then monitor the automatic
Windows/Linux release, including normal verify:ci and S21; no duplicate dispatch.
Publication means eight actual assets, checksums and exact-artifact proof.

### Normal push completed, binary publication still pending

On2026-11-02 the reviewed normal-hook commit17f9d9f7e5dee365371906866ea510d4b2ceda8b
was pushed to Mainstage with native Git exit0. Full local hook:16553pass,55skip,
1existingtodo,0fail,148346 assertions,16609 tests/1765files,1673.68s.
Raw logs/exit: %TEMP%/codex-release-mainstagepush-17f9d9f-20261102/.
Root independently read actual summary, Git exit and remote. No bypass.
Auto-release41425545109 cut v0.1.51 at c07a805bbca6ba0df4ee5238aaf0bca888bd84b7,
whose parent is17f9 and whose only changes are package.json/src/version.ts.
The release verify/build/publish remains pending at this checkpoint; no claim
of available binary downloads follows from this successful source push alone.
Mac binaries remain deferred per the owner's Windows/Linux-first decision.

### v0.1.51 publication held by two actual verification failures

No binaries were published. Auto-release41425545109 verify job125211334102
failed after13055 tests/1363files at core-extension-state.test.ts277: actual
Terminal QuickJS command returned RUNTIME_UNAVAILABLE: isolated sandbox origin
required. Separate CI Windows packaged job125211153724 built/ran both native
probes; ordinary SQLite runtime passed, lane probe preserved10000rows/password
but maxheartbeat122ms exceeded100ms. AGENTS139-143 requires packaged proof and
fixing gate causes. Do not waive thresholds, retagv51, rerun for luck or claim
S21 substitutes for the failed lane contract. The release ended with builds/
publish skipped, so no cancellation or restart is needed. CI41425545009 remains
running to collect all failures.

Authorize bounded diagnostics only before any next full run:
1. In a disposable task-local source copy at exact shipped-tag sourcec07a805b
(parent17f9 plus version metadata), copy lane-probe.ts and add observational
phase labels/timestamps around cold-read,20k insert/delete setup, rebuild,
newDataKey, password wrap/open and30ms drain. Record each >threshold/max heartbeat
phase, start/end and synchronous call-return spans. Keep exact real workers,
workload, password/10000rows assertions and strict100ms bound. Compile the
instrumented copy with pinnedWindowsBun1.4.2 and same --root src/worker entrypoints;
run ONCE in fresh ownedprofile, bounded120s, rawlogs/nativeexit/binary+sourcehashes.
No production/source candidate edits, no GC injection or threshold change.
A local green result is not proof of the remote failure cause. If it cannot
reproduce, report the limitation and propose deterministic causal evidence.
2. Read authoritative DOM/global override helper and exact Terminal test/worker
owner. Reproduce ambient-document failure through actual Terminal test without
weakening the browser origin refusal. Independent reviewer traces ownership.
Propose a scoped native-host fixture isolation using the existing reversible
global override owner only if appropriate; no production origin guard bypass.
No implementation until reviewed plan scope. Batch all completed CI failures
before one subsequent final gate; never launch another full push as a diagnostic.

### Reviewed native-host fixture repair, gated on honest RED

Independent review and root source reads confirm the Terminal integration test
requires a headless host but never establishes that precondition. Ambientdocument
makes the sharedworker runner correctly refuse missing isolated origin. The exact
prior DOM producer is not proven; do not blame or alter nearby UI teardown based
on order. Authorize a task-local wrapper that installs an actual JSDOM through
existing installDom before importing/running the exact QuickJS Core test. Capture
ambient document.URL/descriptor, then show the unchanged actual test RED with the
required-origin error. No new production bypass or fake guest result.

Only after that RED, authorize the actual Terminal test in
src/stage/store/sqlite/core-extension-state.test.ts to scope native-host globals
with existing installDom(undefined,{globals:{window:undefined,document:undefined,
navigator:undefined}}). Use that authoritative descriptor-restoration owner;
ensure runtime closes and fixture teardown is awaited in finally even if setup/
activation/close fails. Keep every review/commit/state assertion. No new generic
helper or ad-hoc delete/overwrite of globals; no production runtime/routing change.
Run the same ambient-document wrapper GREEN and whole actual owner plus existing
browser origin-refusal owner to prove native setup and browser refusal coexist.
If scoped fixture cannot isolate without affecting other tests, stop and report.
Independent actual diff review before any next commit/full check. A broad test-DOM
lifecycle refactor is outside this release batch. Continue Windowsphaseprobe in
parallel only as separate independent bounded diagnostics, no full campaign.

### Bounded contention diagnostic, not a speculative production fix

The first phase-instrumented compiled Windows probe passed at12ms max, measured
in rebuild; it cannot explain hosted122ms. Source read finds scrub still sets
SQLite busy_timeout20 on the main thread, while patiently uses0 with a documented
Windows timeout inflation defect. Authorize one TEMP contrastive compiled probe
with a real registeredreader transaction held during rebuild and released by an
owned250ms timer. Preserve20ksetup,10000rows/password checks,workers, strict100ms;
record phase and synchronous checkpoint spans. Bound120s, clean ownedreader/timer
in finally, no production edits/GC injection/repeated attempts for a green result.
Report whether a real >100ms public-boundary responsiveness RED occurs. Absence
of a RED is not permission to alter the gate or claim hostedcause established.
The direct TEMP JavaScript missing-origin check has now passed against the actual
runner, along with8 existing JSworker tests; no new permanent test is required
for this fixture-only change. Independent reviewer approved exactTerminalfixture
05025f9f636d951be12aadca966b4005a7c62375fa64237cb2ba0b0026b4b499.
CI job125211153485 rawlog is4393122bytes and actualSHA256 is
F475C388F539BCA84E9EFB8DD8383431B8181D40588341F54F1338BF44081E94;
an earlier agent report reused an unrelated stdout hash and was corrected.

### Reviewed scrub nonblocking correction

Independent source review approves a minimal production correction in
src/stage/store/sqlite/database.ts scrub: busy_timeout20→0, correct itscomment
to describe immediate busy return and existing asynchronous retry. This removes
SQLite's demonstrated85/69ms synchronous waits (20ms requested onWindows),
matching patiently's existing zero-busy policy. Preserve8attempts,40*n backoff,
finally restoration to5000, nativeTRUNCATE, busy0&log0success and namedreadererror.
No migration/schema/persistence-format changes. This is independently justified
by the real contention probe, NOT proof that it caused CI's original122ms sample.

Before production edit, enhance the existing real-reader scrub test in
src/stage/store/sqlite/database.test.ts (no addedcasepermutation/newwalltimegate):
realfile,registeredreaderBEGIN/SELECT,newwrite remain. Narrowlyobserve actual
PRAGMA busy_timeout at the instant the real wal_checkpoint Statement.get executes,
using test-only db.prepare/Statement proxy with originalnativeget and result.
Do not substitute rows/results, inspectsource text, stubSQLite or changequeries.
Baseline must RED actual20 vs requirednonblocking0. Assert each busyattempt's
policy0, existing8tries/namedreadererror/WAL nonzero whileheld, default5000restored;
releaseactualreader thenoriginalscrubsuccess/WAL0. Alwaysrestoretestinstrumentation.
Afterminimalfix run full database owner and appropriate linked scrub/keyring/
rebuild checks; mutation0→20mustRED policyassert. Run unchangedcompiled laneprobe
and samebounded held-readerdiagnostic once afterfix, preserving100ms and real
20k/10k/password workload. No repeat-untilgreen.

Independent actualdiff review and storage-shape-compatible pin acknowledgement
through the existing owner are required before commit; no SCHEMA_BUMPS or broad
stamp. Run affected static guards/focusedchecks before one subsequent normalfull
push. FirstcollectremainingWindowsCI results to batch any additional failures.
No newmanualworkflow or automaticrelease retry authorized at this stage.

Correction after root vetting: database.ts is NOT in shapeFiles()'s persisted
schema pin list; storage-shape-tripwire.test.ts113 explicitly documents it as
not pinned. The review's pin requirement was misattributed. Run the existing
tripwire check after the change, but do not modify its hash or add an unnecessary
acknowledgement if it remains green. No schema or migration change is authorized.

### Completed Windows CI adds one cross-drive bundler family

Windowsfulljob125211153728 completed with6failures, all extension-bundler(2)/
extension-pack(4). Sharedowner scripts/extension-bundler.ts127 treats Bunmetafile
input keys as cwd-relative filepaths; on checkoutD/tempC it attempts lstatD:\C:.
Raw5523782byte logfile windows-test-job-125211153728.log SHA256
BB328EB5A4B40E4827B298AD25BADBFA25E91DB25F6980AE6ECE22E8F08CD18E.
No other Windowsfull failures reported. Batch this genuine cross-drive family
before another fullpush; do not weaken validatedgraph/SDK/containment to pass.

Authorize bounded TEMP-only reproduction/capture of actual Bunmetafile keys with
repo cwd/sourcefixtures on different Windowsdrives. An unused task-only SUBST
letter is permitted only after proving it is unused; map solely to an owned
fixture directory, record target, and remove ONLY that exact mapping in finally
if it still matches. No globalpersistentconfig/userdata/source edits. Alternatively
use an alreadyavailable second drive only for an isolatedfixture directory.
Run with pinnedBun1.4.2/freshprofile, rawkeys/nativeexit/hash, compare same-drive
versuscross-drive once. Do not normalize/strip arbitraryinputstrings on speculation.
Review authoritative known sources/SDKidentity graph and Bunmetafile representation
before proposing implementation. Independentsecurityreview required; imported
content remains data and outside/symlink/snapshot-mutation/budget tests stay intact.

### Reviewed cross-drive bundler correction

Actual Bun1.4.2 metadata receipt now confirms Windows cross-drive keys such as
../../../../../R:/fixture/main.js; resolve incorrectly yieldsC:\R:\... . Same
fixture actualbundleAPI succeeds Cdrive and fails Rdrive beforefix. Independent
review verified metadata.stdout.log SHAc830dbe87c03296a7a3d4b603b931957ca506ea42668f18ce337e1a7767de5db
and confirmed ownedR mapping removed.

Authorize minimal scripts/extension-bundler.ts post-build input adapter ONLY:
onWindows, recognize exact leading ../segments followed by drive-letter:/ and
remove only those ../segments; then existing resolve→realpathSync→sources.has
validation applies unchanged. Example anchored pattern
/^(?:\.\.\/)+(?=[A-Za-z]:\/)/. Otherplatforms/ordinarypaths unchanged. Do not
strip arbitraryprefixes, accept unknown paths, drop the postcheck or loosen
onResolve/onLoad/capturedSDK/symlink/byte/file/source limits. One inline owner is
sufficient; no newdependency/export/options/manualregistry.

Beforechange actualcrossdriveownerRED is preserved. Afterchange run complete
existing extension-bundler and extension-pack owners, plus boundedactualpositive
SDK/localmodule and captured-byte cases with different cwd/source drives under
exactownedSUBST rules/finallycleanup. Keep outside/junction/builtin/asset/dynamic
import negatives and captured-source mutation semantics. ExistingWindowsCI
positivecases already provide permanent crossdrive regression inDcheckout/Ctemp.
No addedtestpermutation is necessary for countconsolidation. Independentreview
actualdiff and exactnativeproof before commit. No fullpush until scrubproof,
this family and all completed shippingplatform failures are reconciled.

### Three-family repair batch approved for next normal delivery

Final exact authoredsource approval hashes:
- Terminalfixture05025f9f636d951be12aadca966b4005a7c62375fa64237cb2ba0b0026b4b499.
- database.ts fb597321e3d97f5721fdcc4fc8c0dec340698af04eb0c00e6caa80ac8d4723e6.
- database.test.ts1851b0b99a6593afff148ccfcaba33fe43b03a5ffabd45a178f27054e23e3b7f.
- bundler5a337d5ea9ba76edd44972120981e1fee96d8794d1a7829855c7e696c353cc34.
Independent integration_review approved all actualdiffs and verified ownedSUBST
cleanup. Nativefocusedproof: TerminalambientRED then11/45GREEN, actualJSworker
8/10GREEN+exactoriginrefusalTEMP1/1GREEN; scrub20/47GREEN,20msmutationRED,
linkedkeyring/health34/95GREEN, unchangedtripwireGREEN; compiledcanonicalprobe
11ms max and heldreader10ms vs baseline88ms, strict100/workloadunchanged;
bundler/pack9/54GREEN and actualcrossdriveSDK/capturedbytes8811byteoutput0.
The hosted122ms sample remains specificallyunattributed; newstrictnativeCI
mustpass on the repairedrevision. No acceptance waiver or threshold change.

Freeze exactly these4sourcefiles plus canonicalPlan010/conciseevidence. Root
verified origin/Mainstage c07a805bbca6ba0df4ee5238aaf0bca888bd84b7 on2026-11-02.
Fast-forward local17f9 to c07 metadata withoutstash/reset or unrelatedchanges;
commit approvedbatch normally. No vendor/lock/manualversion/schema/pin changes.
Then one newfreshprofile normalpush, pinnedBun/approved200Fshim, exactnewcommit
andremote preflight, rawstdout/stderr/nativeGitexit+actualremote, bound45min.
No concurrenttests, no repeatedfullrun forindividualassertionrepair. Auto-release
owns the nexttag; v0.1.51 staysimmutable. Normalreleaseverification and shipped
platformpackagedCI/S21 mustpass beforeclaimingactual8assets+checksums publication.
Macdownloads remainheldback, no expansiontoMacrepair/testreduction.

### v0.1.52 held for ARM64 native pause, scope question pending

Normal789push passed16553tests/0fail,16609cases1765files148345asserts1658.85s.
Auto-release41437322168 cutv0.1.52 atc75be802512faf552333a33b9949507f510979f7.
CurrentCI41437321942 packagedWindows/Linuxx64/macOS checks passed. ARM64 job
125250284803 failed strict100ms at213ms (2088ms total,10000rows/password correct).
Raw43064byte log SHA4E23CFBD9B5C74B10FB9D890C8BC16B543915D30A22107B7CA4F73766DFD3571.
Linuxx64 sameprobe measured7ms max/3222ms total. These are observations, notcause.
Rootrequested cancellation of ONLYownedauto-release beforepublication; cancellation
confirmed duringverify beforebuilds/publish. No releaseobject/assets forv52.
CIremainsrunning tocollectallresults. Userwasaskedwhetherx64downloadsfirstwith
ARM64heldback orallheldforARM64; noanswer/approvalyet. Do NOTsilentlydropARM64,
waive100ms, substituteemulationperformance, orrepeatgreenfishing.

Independentprogress whilewaiting: prepare minimal canonical lane-probe diagnostic
instrumentation fornativeARM64. Preserve exactsetup/workload/timer5ms/startpoint/
awaitordering/30msdrain/100msassertions and data/password checks. Onlyrecord fixed
phase labels and monotonicphase durations/maxgapstart/end/phase; print AFTERtimer
clear. No newwaits,GC, workerpolicy, retries or threshold changes. Avoid per-tick
logging, secrets or unboundedarrays. Reviewactualdiff andlocalcompiledprobeproof
beforecommit. This is observability, NOTa performancefix or releaseacceptance.
Further remoteexecution must honor normalhooks; use skiprelease diagnosticcommit
if publishing additional source whileARM64 remainsunresolved. Nofullpushyetuntil
reviewed diagnosticsource is concrete. Currentproduction789fixesstayunchanged.

### Confirmed shared fixture HOME loss, complete CI results

RootpureBunLinux1.4.2probe in two existingOWNED profilepaths confirmedhomedir()
staysatstartupHOME afterprocess.env.HOME changes. No files/userhome werewritten.
Therefore preloadHOME redirects do not repair a later lost BUNZAI_HOME override.
Independentinventory identified14unconditionaldeleteowners:
Kitproviders/vault.test.ts,sessions/store.test.ts,render/settings/settings-screen.test.tsx;
UIserver-chats-{tracker-refresh,summary,tracker-item,forecast,trace,local-tools,
final-cut,turn,lore,draft,ollama}.test.ts. Twoothers overridewithoutrestore:
Kitrender/app-gate.test.tsx andrender/safety/use-gate.test.tsx. All aretestfixture
ownership bugs, notpermission tochangeproductionconfigDir/identityPath/homedir.
FullCIWindows job125250284914 isGREEN:16609cases/1765files,55skip,1todo,0fail,
148350asserts,1847.08s. Linuxallcasescompleted, soleend-auditfailure. Macdeferred.
Thus allremainingactualshipping failures are the sharedfixtureisolation andARMpause.

Authorize onepure shared test helper scripts/test-home.ts to own temporary
BUNZAI_HOME override/restoration: capture exactprior value atCALL/setup time,
setprovidedownedfixturehome, returncleanup restoringexactprior (deleteONLYif
priorabsent). No import-time effects, folderownership, productionuse or arbitrary
profilepolicy. This replaces16copiedsetup/teardown patterns, not16newhelpers.
Use helper insideexistingbeforeAll/beforeEach lifetimes ofthese16owners; restore
infinally even ifserverstop/foldercleanup throws. Keep eachcaller's existingowned
homepath/resourcecleanup; addmissingownedtemp cleanup toapp-gate/use-gate. Never
remove a path readfrom current/restoredprocess.env (maybelongtoanotherfixture).
Keep allactions/assertions/providerfakes and testcounts. Otheralreadycorrectenv
lifecycles remainuntouched unlessactualrelatedfailure evidence appears.

Strengthenexisting scripts/test-sandbox.ts endaudit to also requireBUNZAI_HOME
restoredtoitscanonicalpreloadhome, usingonenamedcanonicalhomevalue asauthority.
Keep originalreal-location snapshots,before/after breach detection,ownedroot
cleanup and realwriteerror. Wrongenv alonemustfail evenifnowrite occurs, sofuture
lostoverrides identifycausewithoutwritingoutside. Do notmakeenvreadonly, mock
homedir, deletebreaches orsilenceaudit. No new general envframework.

Beforefix establishboundednativeLinux orderedRED with ONLY anownedouterHOME and
BUNZAI_HOME omittedbeforeBunstarts: existingvault/sessionorroutefixture thenactual
defaultkeystore/sessionwriter. Allpossiblehomedir/configDir resolutions mustbe
verified under theoutertaskroot BEFOREwrites; abortifnot. Currentunconditional
delete+cachedfallback shouldproduce auditRED or missingcanonicalhomeRED. After
sharedhelper/16callers/audit correction exactsamecohortGREEN. Captureactualenv/
homedir/root paths,sourcehashes,rawnativeexit. DonotrunagainstWSLuserrealhome.
Runaffected16-owner cohort once and focusedhelper/nativeconsumer checks; root
andindependentactualdiff review before commit. No broadtestreduction/migrations/
releasearchitecture changes. Phaseobservability canjointhisrepairbatch afterreview.
Userarchitecturechoice stillpending; do notdropARM64 orpublishuntilauthorizedscope
andactualgatespermit. Diagnostic-onlycommit mustskipautomaticrelease ifARMunfixed.

### Shared HOME correction and native diagnostic batch ready

Independent review approved sharedhelper5c8c7d8984ce17de350a4867cd4e3483ceeb344ed1bc68c36aa928e05ff8959a,
preloadaudit0ecbd68120f93e5df44c7e88d4a0a2a3f5a98141fbfcc05e4df1ce9ebb40763b,
all16callerfixtures and phaseobserver4aecfc738d9ff597a2cf0f667b0e4fb21fe3283c7c2a0b6900f501355213cf34.
Rootcold-readsharedowner/audit/cleanup/observer actualdiffs. Finalturncleanup is
semanticallysamefinallychain,hash2e1988fdb13e643d407bccb50ff5d5ae4d45125e0e84c7e65d078a49212cf8d6,
existinglinecap500andwholeowner21/98GREEN. Sourcehelperpurposeheaderadded.
SafeRED =unchangedvaultcases6pass+1globalnewcanonicalinvariantfailure,16asserts;
no defaultwriters oroutsidewrites/ordertricks. Overlayhash0ecbd..., NOToriginal
daf580...baseline. SAMEvaultGREEN6/16,16ownercohort121/480LinuxGREEN withowned
outerHOME/BUNZAI_HOMEinitiallyabsent/noOSsecrettoolPATH. TSC/headers/lines and
source-boundary8/179GREEN. PhaseinstrumentationcompiledWindowsGREEN unchanged
workload/limit, notnativeARMcauseproof. Production789fixesunchanged.

Freeze19authoredpaths (18HOMEharness/fixtures includingnewhelper +laneobserver),
pluscanonicalPlan/conciseevidence. Normalcommit mustinclude[skip release] while
ARMperformance anduserarchitecturechoice remainunresolved: this sourcepublication
is toobtain native phaseattribution and validate the actualHOMErepair, NOTa claim
of readybinaries or permissiontodropARM. Preservev51/v52tags andallvendor/locks/
manualversion/schema/gates. Rootreviewexactcommit+freshnormalpushrunner before
onefullhook. No concurrentcampaigns; allpriorCIresultsnowcollected. Do not rerun
oldfailedARMjob foracceptance. SubsequentnativeCI trace guidescausefix. Userchoice
stillpending; do notinterpret elapsedtimeasapproval.
