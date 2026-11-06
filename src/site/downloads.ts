/** Published app links come from the same GitHub release response as the website's release feed. */
import { APP_ASSET_NAMES } from "../packaged-app";
import { isRecord } from "../core/guards";
import { resolveAsset } from "../ui/_shared/release-download";
import { isReleaseTag } from "../ui/_shared/version-history";

type AppDownload = { name: string; url: string };

/** Only actual assets of the selected release can become download links; no future URL is invented. */
export function publishedAppDownloads(raw: unknown, tag: string | undefined): Partial<Record<keyof typeof APP_ASSET_NAMES, AppDownload>> {
  if (!tag || !isReleaseTag(tag) || !Array.isArray(raw)) return {};
  const release = raw.find((item) => isRecord(item) && item.tag_name === tag && item.draft !== true && item.prerelease !== true);
  if (!isRecord(release) || !Array.isArray(release.assets)) return {};
  const assets = release.assets.filter(isRecord);
  const result: Partial<Record<keyof typeof APP_ASSET_NAMES, AppDownload>> = {};
  for (const os of ["windows", "linux", "mac"] as const) {
    const names = assets.map((asset) => typeof asset.name === "string" ? asset.name : "");
    const name = resolveAsset(names, APP_ASSET_NAMES[os]);
    const asset = assets.find((item) => item.name === name);
    const url = asset?.browser_download_url;
    if (name && typeof url === "string" && url === `https://github.com/Vaudeville-Studios/Bunzai/releases/download/${tag}/${name}`) result[os] = { name, url };
  }
  return result;
}

/** A failed release read leaves usable GitHub/source links, never a broken direct download. */
export function fillAppDownloads(root: Document, raw: unknown, tag?: string): void {
  const downloads = publishedAppDownloads(raw, tag);
  for (const os of ["windows", "linux", "mac"] as const) {
    const link = root.querySelector<HTMLAnchorElement>(`[data-app-download="${os}"]`);
    if (!link) continue;
    const asset = downloads[os];
    if (asset) {
      link.href = asset.url;
      link.removeAttribute("aria-disabled");
      link.textContent = `Download for ${os === "windows" ? "Windows" : os === "linux" ? "Linux" : "macOS"}`;
    } else {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.textContent = "Check GitHub releases below";
    }
    const filename = root.querySelector<HTMLElement>(`[data-download-name="${os}"]`);
    if (filename) filename.textContent = asset?.name ?? "No matching file found";
  }
}
