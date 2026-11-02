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
