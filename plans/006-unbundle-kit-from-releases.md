# Plan 006: Remove Kit from Bunzai release downloads

Status: implemented and locally verified, 2026-11-01; not published. Planned at `def23fd3d89e19b6935d0046ff6fccb487809daa`.

The owner requested unbundling Kit for now. The authoritative owner of release
artifacts is `.github/workflows/release.yml`. Keep Kit source, development commands,
and optional developer `scripts/build-desktop.ts --kit` support. Remove Kit from the
normal public binary release, not the CLI that serves browser Studio. Do not touch
Hoplight or remove shared dependencies/runtime capabilities merely used by Kit.

Executor works in `C:/Users/chiev/Documents/Bunzai-binary-release-20261101`.
Before editing, read applicable AGENTS instructions and relevant product/convention,
distribution and installation documentation. `git status --short` must show only
this task-owned plan; do not overwrite unrelated work. Compare any drift from def23fd.

## Exact scope and steps

1. In `.github/workflows/release.yml`, remove `--kit` from Windows/Linux/macOS
   build commands; remove their Kit upload paths. Remove the Kit-only
   `build-linux-arm64` job and its `publish.needs` dependency. Linux ARM64 CLI and
   helper remain built by the ordinary Linux cross-compilation job.
2. Remove all four Kit names from the checksums command and published asset list.
   Rewrite comments/step names accurately. Retain Windows Desktop, five CLIs,
   five helpers and SHA256SUMS. Preserve verify:ci, S21 evidence, toolchain pins,
   recursive RP-Core checkout and all other release gates.
3. In `.github/RELEASE-NOTES-INSTALL.md` and `docs/guide/installation.md`, remove
   Kit download promises and state Kit is available from a source checkout for
   development. Reconcile `docs/02-ARCHITECTURE.md` only if needed; its statement
   that current release binaries exclude Kit now agrees with the release decision.
   Inspect other current release/install docs for the same promise; avoid changing
   historical plans/evidence or every mention of Kit. Regenerate required docs
   metadata through existing owner scripts if hooks/checks require it.
4. Validate YAML through an existing available parser, inspect every jobs.needs
   reference, and compare checksum/upload/publish sets. Expected public inventory:
   11 executable assets plus SHA256SUMS, zero Kit assets. Verify source-only Kit
   and explicit optional local build support still exist. Run relevant documentation
   checks and `git diff --check`; no full suite, source typecheck, artifact rebuild,
   S21 rerun or new low-value workflow text tests are needed for this configuration
   change. Do not claim a new binary or remote release has been produced.
5. Record exact verification results and update this plan/index. Normal precommit
   hooks apply. Commit only scoped changes. Do not push, tag, dispatch workflows,
   publish releases or deploy Pages during this checkpoint.

## Stop conditions

Stop for unrelated dirty files, an unexpected dependency on the removed job,
required generated-doc ownership ambiguity, or a proposed change to release gates.
Do not delete Kit binaries/source or rewrite historical evidence to imply they
never existed. This decision changes future distribution, not the archive.

## Done

- Release YAML parses; all remaining dependency names resolve.
- Build/upload/checksum/publish inventory agrees and contains no Kit artifacts.
- Windows, both Linux architectures and both macOS CLI architectures remain.
- Current installation copy describes source-only development Kit.
- Focused checks and normal hooks pass, or failures are reported precisely.

## Execution evidence

Removed all four Kit release assets and the Kit-only Linux ARM64 runner. The
remaining workflow parses with Bun 1.3.14's YAML parser; every job dependency
resolves. Build upload, checksum and publish inventories agree on 11 executable
assets plus SHA256SUMS: Windows Desktop, five CLI targets and five helpers.
Linux ARM64 CLI/helper cross-builds remain. Full verify:ci and both S21 release
evidence steps are unchanged. Kit source, its development command and explicit
local --kit build support remain unchanged.

The existing helper workflow suite passed 7 tests and 28 assertions. The focused
installation summary author check passed with three existing warnings. No
binary rebuild, full suite, source typecheck or publication was performed for
this configuration/documentation change. Historical Plan005 artifacts remain
intact and are not a promise that Kit will ship in the next release.
