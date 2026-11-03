/**
 * The remote-access helper, pinned like a dependency.
 *
 * WHY COMMITTED RATHER THAN BAKED AT BUILD TIME. Computing each hash during the release build meant only a
 * CI-built binary carried one: a source checkout got nothing, so the download button existed for packaged
 * users and silently did not for everyone else. Committing the pin makes the answer the same everywhere -
 * source, CLI, packaged app - because the trust anchor travels with the repository, not with one build.
 *
 * THE HELPER IS NOT TIED TO AN APP VERSION, which is what makes a single pin serviceable indefinitely. It is
 * a separate process speaking one small stdio protocol (see sidecar-status.ts), so a v0.1.53 helper works
 * with a much later studio. The coupling is to the PROTOCOL, not the version number, and a protocol change
 * is exactly when bumping this should be a deliberate, reviewed act.
 *
 * WRITTEN BY `bun scripts/pin-sidecar.ts <tag>`, which reads the release's published SHA256SUMS and
 * re-downloads each asset to confirm it matches before writing. Review the diff like any other lockfile
 * change: these hashes are the only thing standing between a download and an executed binary.
 */
import type { SidecarPins } from "./aux-download";

/** The repository the pinned assets are published from. */
export const SIDECAR_REPO = "Vaudeville-Studios/Bunzai";

/** Pinned helpers, keyed by `${process.platform}-${process.arch}`. */
export const SIDECAR_PINS: SidecarPins = {
  "linux-arm64": {
    asset: "sidecar-linux-arm64",
    sha256: "1f9cb95eb98b4184f5c7b8270e8ccbbf7ef697790a7ac6efbe5bbbd97f1d49c4",
    tag: "v0.1.53",
  },
  "linux-x64": {
    asset: "sidecar-linux-x64",
    sha256: "5aa5739cc826f586ab212903c84781cfa12935548b0bf656b841864951e942b8",
    tag: "v0.1.53",
  },
  "win32-x64": {
    asset: "sidecar-windows-x64.exe",
    sha256: "4a59e1b18eed27ab843abf690c337bffa88b31825090355f316b996eba337a34",
    tag: "v0.1.53",
  },
};
