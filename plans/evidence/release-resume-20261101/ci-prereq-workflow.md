# CI prerequisite setup change

Candidate: `f28dad8b3d719772aff9e20b45e57ccfb4294190` (merged Mainstage v0.1.47 metadata; package and source versions agree).

The only source change is `.github/workflows/ci.yml`:

- Linux keychain initialization now feeds the fixed synthetic password `ci` to the existing private `dbus-run-session` and real `gnome-keyring-daemon --unlock`; the existing `scripts/probe-keychain.ts` invocation is unchanged.
- The packaged SQLite job still compiles and runs the builtin-only SQLite artifact before dependency installation. It then runs root `bun install --frozen-lockfile` immediately before the existing background-lane compile. The compile entries, native run commands, matrix, timeouts and artifact assertions are unchanged. The obsolete no-install comment now describes the standalone probe only.

Local bounded verification:

- `bun test ./src/ui/_shared/update-check.test.ts ./scripts/ci-sidecar.test.ts --timeout 120000` passed 18 tests / 51 expectations using pinned Bun 1.4.2 through the approved isolated shim. This includes the existing `APP_VERSION === package.json.version` assertion for 0.1.47.
- PyYAML 6.0.1 parsed the workflow; an explicit structure/order check verified standalone compile/run precedes the frozen install and background-lane compile/run. It also checked that the Linux command feeds `ci` and still executes the real probe.
- WSL Ubuntu has `dbus-run-session` and `dbus-daemon`, but no `gnome-keyring-daemon` or `secret-tool`. An ephemeral private D-Bus session works, but cannot exercise Secret Service locally. No package install or global service was attempted.

GitHub CI has not yet run this workflow change. The packaged worker artifact and real Linux keychain probe remain unverified until the next CI run of these changed jobs.
