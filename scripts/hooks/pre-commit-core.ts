/** Pure parsing and staged-path routing decisions for the fast pre-commit hook. */
import { onMap } from "../code-map-core";

export interface StagedPath {
  status: string;
  path: string;
  previousPath?: string;
}

const normalize = (path: string): string => path.replace(/\\/g, "/");

/** Parse NUL-delimited `git diff --name-status -z`, keeping rename/copy destinations. */
export function parseNameStatusZ(raw: string): StagedPath[] {
  const fields = raw.split("\0");
  const paths: StagedPath[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) break;
    const firstPath = fields[index++];
    if (!firstPath) break;
    const renamed = /^[CR]/.test(status);
    const path = renamed ? fields[index++] : firstPath;
    if (!path) break;
    paths.push({
      status,
      path: normalize(path),
      ...(renamed ? { previousPath: normalize(firstPath) } : {}),
    });
  }
  return paths;
}

/**
 * Whether any staged change touches a docs-index corpus file. The generator's corpus is every `.md`
 * under docs/ EXCEPT the generated/ and media/ directories (SKIP_DIRS in scripts/docs-index.ts), so
 * the predicate must match that exactly. FORMAT-SUPPORT.md lives directly under docs/ and IS in the
 * corpus (it has a record in the committed index), so editing it must trigger a regen too. When true
 * the hook regenerates docs/generated/docs-index.json + docs/llms.txt and stages them, so
 * docs:index:check in verify:ci can never go stale from a forgotten regen. Add, edit, rename, and
 * delete all count (moving a doc out of docs/ changes the index too).
 */
export function needsDocsIndex(paths: readonly StagedPath[]): boolean {
  const affects = (rawPath: string): boolean => {
    const path = normalize(rawPath);
    if (!/^docs\/.*\.md$/.test(path)) return false;
    return !path.startsWith("docs/generated/") && !path.startsWith("docs/media/");
  };
  return paths.some((entry) =>
    affects(entry.path) || (entry.previousPath !== undefined && affects(entry.previousPath)));
}

/**
 * Whether the code map (docs/generated/CODE-MAP.md) may change: any staged source file it covers
 * (code-map-core.ts decides which), the map itself, or its generator. The hook then regenerates it
 * from the staged snapshot and stages it.
 */
export function needsCodeMap(paths: readonly StagedPath[]): boolean {
  const affects = (rawPath: string): boolean => {
    const path = normalize(rawPath);
    return path === "docs/generated/CODE-MAP.md" || path === "scripts/code-map.ts" || path === "scripts/code-map-core.ts" || onMap(path);
  };
  return paths.some((entry) => affects(entry.path) || (entry.previousPath !== undefined && affects(entry.previousPath)));
}
