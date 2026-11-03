/**
 * Pure guards for downloading a packaged release build: which asset matches THIS binary, and whether a
 * download URL points at a trusted GitHub host. Both stand between a version switch and running a fetched
 * executable, so both fail closed. (safeExternalUrl is the general http/https link check; this is the
 * stricter https + GitHub-host allowlist a binary download demands, a distinct concept.)
 */
import { APP_ASSET_NAMES } from "../../packaged-app";

/**
 * Which release asset matches the running binary. Exact basename match: the desktop app is "Bunzai.exe",
 * Old and new Linux x64 app names may match each other when updating or rolling back. No other
 * architecture or entry point is interchangeable; unknown builds fail closed to a manual download.
 */
export function resolveAsset(assetNames: readonly string[], execBasename: string): string | null {
  const exact = assetNames.find((name) => name === execBasename);
  if (exact) return exact;
  const linuxNames = [APP_ASSET_NAMES.linux, "bunzai-cli-linux-x64"];
  return linuxNames.includes(execBasename) ? assetNames.find((name) => linuxNames.includes(name)) ?? null : null;
}

/** GitHub hosts a release download may legitimately come from (the asset URL and every redirect hop). */
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

/** True only for an https URL whose host is a known GitHub release host. Deny by absence. Pure. */
export function isAllowedDownloadHost(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.has(u.hostname);
}
