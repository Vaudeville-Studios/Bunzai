/** Stable compatibility paths for the former guide-only website. */
export interface GuideRedirect {
  readonly slug: string;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
}

/** docs/guide/lorebooks.md -> "lorebooks", nested README -> its folder. */
export function guideSlug(path: string): string | null {
  const match = /^docs\/guide\/(.+)\.md$/.exec(path);
  if (!match) return null;
  return match[1] === "README" ? "index" : match[1]!.replace(/\/README$/, "").replaceAll("/", "-");
}
