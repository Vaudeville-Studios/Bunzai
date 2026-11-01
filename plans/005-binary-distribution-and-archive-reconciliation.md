# Plan 005: Deliver Bunzai binaries and reconcile archived plans

Status: Windows artifacts built; basic compiled checks pass; public release not verified or published.
Priority P1. Effort L. Risk HIGH for release claims. Planned at Mainstage
`9f8e8571929e32fc8e65ad721a13b653c1aa787f`, 2026-11-01.

## Intent and authority

The owner requested binaries comparable to Hoplight and a check of the Bunraku
archive plans. The existing build and release scripts own distribution. Reuse them;
do not introduce a parallel packager, engine, helper downloader, or release registry.
Archived designs are evidence of intent, not authorization to implement every feature.

The user previously deferred test-harness reduction and authorized skipping the full
suite for source pushes. That does not make failed release verification pass. Prepare
reviewable binaries now; report the publication constraint without silently weakening
the release workflow or launching another hours-long suite.

## Current state and drift check

Work in the isolated executor checkout
`C:/Users/chiev/Documents/Bunzai-binary-release-20261101`.
Before changes run `git diff --stat 9f8e857..HEAD -- .github/workflows scripts
sidecar src/ui/remote docs package.json src/version.ts`; investigate drift before acting.

- `.bun-version` pins `1.3.14`; use that toolchain, not ambient Bun 1.4.2.
- `scripts/build-desktop.ts` bakes UI, docs, extension worker, QuickJS WASM and
  platform WebView resources into compiled artifacts. Its temporary generated
  source must be restored after the build.
- `.github/workflows/release.yml` has recursive submodule checkout in all six
  checkout steps. RP-Core gitlink is `9cce0552df233c7185329d9cfc5473be67e2e821`.
- The release workflow builds Windows desktop, five CLIs, four Kits, five helpers
  and SHA256SUMS. It does not build macOS/Linux GUI applications.
- Its verification gate runs `bun run verify:ci`. Windows additionally consumes
  S21 low-end 10,000-piece evidence against the exact compiled artifacts. Desktop
  identity checks there do not prove a functioning native window.
- Bunzai has no published Release. Existing `v0.1.42` points to older source;
  do not move it. Its failed release run is 41183434135. Mainstage 9f8 has focused
  checks and deployed Pages evidence, not a successful full release gate.
- `src/ui/remote/sidecar-pins.ts` has an empty map. Its documented contract offers
  no helper download until published helper assets are pinned.
- `scripts/pin-sidecar.ts` accepts a published tag, reads SHA256SUMS and verifies
  each downloaded helper. Never replace this with hashes of local unpublished bytes.
- ADR-003 is accepted distribution design, explicitly not shipped-feature proof.
  Minisign and atomic installed-binary replacement are not proven by current Releases.

## Scope

Artifact preparation uses the existing build scripts and isolated fixture homes.
Expected ignored outputs: `dist/Bunzai.exe`, `dist/bunzai-cli-windows-x64.exe`,
`dist/bunzai-kit-windows-x64.exe`, and helper outputs from `sidecar/build.ts`.
Record evidence under `plans/evidence/binary-release-20261101/`.

Do not modify product source, workflow gates, locks, version numbers or tags during
the preparation checkpoint. Do not touch dirty Bunraku-publish, user libraries,
credentials, saved providers, real scenes, or remote-access settings. Publication
and any gate redesign require a separate reviewed implementation checkpoint.

## Execution

1. Read repository instructions, ADR-003, release/build scripts and helper contract.
   Verify exact HEAD, clean initial tree, pinned toolchain provenance, frozen install
   and initialized RP-Core. Keep all evidence tied to the exact source SHA.
2. Run the pinned equivalent of `bun run scripts/build-desktop.ts
   --cli-targets=bun-windows-x64 --kit`. Expected: Desktop, CLI and Kit outputs;
   no tracked generated-source changes. Hash every artifact with SHA-256.
3. Smoke actual compiled CLI help/version, isolated fixture import/SQLite read-write,
   and packaged Studio HTTP product identity/resources. Exercise the compiled
   extension worker and QuickJS WASM with a bounded offline guest, no ambient authority.
   Test Kit help/startup without contacting a real provider. Record native-window
   creation separately from browser fallback; never equate HTTP success to GUI success.
4. Review artifact evidence independently. Report failures and exact paths rather
   than publishing a stable release from unverified artifacts.
5. Prepare a publication proposal using the existing release matrix. Resolve helper
   bootstrap concretely: a separately published helper-only prerelease outside the
   `v*` app train may permit reviewed real-asset pins before one app release. Verify
   compatibility with current tag/pin contracts before selecting it. Otherwise report
   the two-release requirement. No fake pins, mutable tags or replacement assets.
6. Before publication reconcile release documentation with measured support:
   Windows desktop versus other-platform CLI/Studio; Kit packaging versus terminal
   acceptance; available checksums versus absent signatures. Fix documentation through
   an executor only after the artifact checkpoint. Do not claim pending features ship.

Commands already present in this repository: `bun install --frozen-lockfile`,
`bun run typecheck`, `bun run verify:ci`, `bun sidecar/build.ts --target=windows-x64`,
`bun scripts/pin-sidecar.ts <published-tag>`, and the build command above.
Read the exact workflow for S21 arguments; do not guess an abbreviated release gate.

## Archive reconciliation

Read-only sources inspected on 2026-11-01:

| Source | Meaning today |
| --- | --- |
| `C:/Users/chiev/Documents/VAUDEVILLE-archive/worktrees-20261002/README.md` | Preserved snapshots, not active worktrees. Archived commits do not prove features are missing or deployed. |
| `C:/Users/chiev/Documents/Bunraku/docs/ROADMAP.md` | Separates implementation from release proof. Reproducibility, signatures, packaged smoke and terminal acceptance remain relevant; source-only Kit and embedded-helper statements need current-source reconciliation. |
| `C:/Users/chiev/Documents/Bunraku/docs/KINTSU-PLAN.md` | Explicit draft: terminal Stage, headless Runner and extension Workshop. Current CLI documents conversion/Studio commands, not this full product. Keep as a future proposal, not a required rename. |
| `C:/Users/chiev/Documents/Bunraku/docs/BUNRAKU-PLAN.md` | Historical draft. Many original extension/library/chat decisions have since advanced or been superseded. |
| `C:/Users/chiev/Documents/Bunraku/specs/features/world-forge.md` | Draft future worldbuilding over canonical lorebooks. Not current shipping functionality. |

Current `docs/reference/entities/promptbook.md` documents implemented phases, cards,
board and turn integration with explicit limits. Do not reopen Promptbooks as absent.
The archive review also located overlay/navigation repair evidence and RC parity
surveys: require current-owner evidence before deriving new work from dated branches.
Archives/World Forge, Runner/Workshop and installed update/signing work are candidate
next projects. They are outside this binary preparation task.

## Done criteria and stop conditions

- Windows artifact paths, source SHA, toolchain versions and hashes recorded.
- Packaged checks have explicit pass/fail/unverified labels; isolated homes only.
- No source changes hidden by the bake, no generated output committed.
- Public release status recorded truthfully, with remaining gates and helper bootstrap.
- Archive inventory distinguishes drafts, implemented features and remaining proposals.

Stop and report unexpected tracked changes, toolchain/hash mismatch, real-home access,
missing packaged worker/resources, native startup failure, gate failures or a request
to change a published tag. Do not improvise a bypass, new runtime or broad test rewrite.

Future releases must rerun artifact checks after any baked-source, vendor or toolchain
change. Old local evidence cannot certify a newly compiled or remotely built binary.

## Execution checkpoint, 2026-11-01

Pinned Bun 1.3.14 produced all three Windows artifacts at the exact planned source SHA.
Root independently recomputed their hashes and matched the executor ledger:
`C:/Users/chiev/Documents/Bunzai-binary-release-20261101/plans/evidence/binary-release-20261101/windows-basic.json`.

| Artifact in executor `dist/` | Bytes | SHA-256 |
| --- | ---: | --- |
| Bunzai.exe | 464129536 | b5e61e384f634090de011df7939db5bd044f36435304f04c897adab25f6a1ef3 |
| bunzai-cli-windows-x64.exe | 461639168 | cab4a8b7954faf233e6c77f9cc2de71383c2d7fb2128456485e618c2e398b3b0 |
| bunzai-kit-windows-x64.exe | 474245120 | 868374141ac09d7fd8ea33a0c040e0af23deac3082f4887e60b656c4e3aeffe4 |

Compiled CLI help, JSON version, JSON formats and sample-card validation passed.
Compiled Kit help and invalid-argument rejection passed. Separate compiled SQLite
and lane probes passed; those are not proof that the actual Desktop window works.
Native window, live terminal session, provider turn, complete packaged extension
flow, cross-platform runtime acceptance and release gates remain unverified here.

Size finding: the current build scans all `docs/media` and base64-embeds 231655454
bytes in every executable, including 183335404 bytes under `book-covers`. This
accounts for much of the difference from Hoplight's published downloads. Before
removing media, trace actual documentation and runtime references; do not strip
required covers or substitute a second independently maintained asset list.

### Reviewed follow-up: packaged activation failure

The executor's actual compiled CLI opened the isolated library, and extension
preview/install/enable succeeded. `/api/extensions/activate` then returned HTTP 500.
Evidence: executor `plans/evidence/binary-release-20261101/windows-http.json` and
`http-smoke.ts`. These binaries are candidates, not ready releases.

This checkpoint extends preparation scope narrowly to fix the confirmed failure.
First prove the fixture follows the activation contract using the interpreted host
or the existing public-boundary tests. If the fixture is invalid, correct the fixture
and retract the product diagnosis. Otherwise trace the internal exception in an
isolated profile. Inspect `scripts/build-desktop.ts` compile entry lists and
`src/sandbox/javascript/run-in-worker.ts`'s compiled worker startup; the former
explicitly includes the JavaScript worker for Desktop/Kit but not the CLI. This is
a hypothesis, not a confirmed cause. Reuse authoritative worker ownership rather
than adding a parallel runtime or broad fallback.

Executor may change the confirmed packaging owner and its meaningful focused
regression. Changes outside build/worker packaging require root review first.
Run typecheck and relevant focused checks, rebuild with the pinned official script,
then rerun actual compiled activation through HTTP. Expected: successful bounded
offline command result, with fetch/process ambient access unavailable. Record exact
new source diff and artifact hashes; original hashes above describe the initial RED
build only. Keep public tags, release gates, versions and real profiles untouched.

Confirmed cause and fix: the source guest succeeded; compiling the diagnostic
without its worker entry produced ModuleNotFound. Executor added one shared worker
path in `scripts/build-desktop.ts`, reused it for Desktop/Kit and included it in CLI
compilation. Independent engine review approved the narrow diff. The actual public
CLI regression failed against the original artifact and passed against rebuilt CLI
SHA-256 `f2a69c0ababa97b5d51b55d1cdee863bc125a611005d7eda2e3884aa4eb55d64`.
Activation returned 200 with `{sum:4,fetch:'undefined',process:'undefined'}`. This
proves that bounded guest on the checked CLI, not universal extension isolation or
native Desktop acceptance. Source provenance is 9f8 plus the reviewed packaging diff;
record the final commit separately once committed.

## Local artifact checkpoint

Exact Windows artifact inventory and bounded verification are in evidence/binary-release-20261101/README.md. The original compiled CLI failed offline extension activation because its compile command omitted the explicit JavaScript worker entry. The minimal build-owner correction reuses one worker path across Desktop, CLI and Kit. The same actual CLI HTTP regression is RED on the original binary and GREEN on rebuilt SHA256 f2a69c0ababa97b5d51b55d1cdee863bc125a611005d7eda2e3884aa4eb55d64, including absent ambient fetch/process. Root independently reran it successfully (root-review.json). This does not satisfy full release gates, native-window, Kit-interaction or provider/Core turn acceptance. No publication occurred.


Post-fix pinned-runtime TypeScript check passed (exit 0); worker-boundary focused suite passed 8 tests/10 assertions. Root's independent packaged CLI regression passed. Existing release gates remain pending.
