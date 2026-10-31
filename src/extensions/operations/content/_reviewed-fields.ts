/** Exact authored body paths readable only when an owning capability has reviewed extension exposure. */
import { allCapabilities } from "../../../generated/capabilities";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import type { ContentKind } from "../../../entities/capabilities/types";
import { isRecord } from "../../../core/guards";

const safePath = /^body\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const byKind = new Map<ContentKind, readonly string[]>(STUDIO_ENTITY_KINDS.map((kind) => [kind, [...new Set(allCapabilities
  .filter((capability) => capability.kind === kind && capability.extensionExposure)
  .flatMap((capability) => capability.extensionExposure!.fields.map(({ path }) => path))
  .filter((path) => safePath.test(path)))].sort()] as const));

export function reviewedFieldPaths(kind: ContentKind): readonly string[] { return byKind.get(kind) ?? []; }
export const REVIEWED_CONTENT_FIELD_PATHS: readonly string[] = [...new Set([...byKind.values()].flat())].sort();

export function areReviewedBodyFields(kind: ContentKind, paths: readonly string[]): boolean {
  const allowed = new Set(reviewedFieldPaths(kind));
  return new Set(paths).size === paths.length && paths.every((path) => allowed.has(path));
}

export function assertReviewedBodyFields(kind: ContentKind, paths: readonly string[]): void {
  if (!areReviewedBodyFields(kind, paths)) throw new Error("content field path is not reviewed for extension reads");
}

/** Projects only a field path validated against the same capability-owned catalog. */
export function projectReviewedBodyFields(kind: ContentKind, body: unknown, paths: readonly string[]): { path: string; value: unknown }[] {
  assertReviewedBodyFields(kind, paths);
  return paths.map((path) => {
    const value = path.slice("body.".length).split(".").reduce<unknown>((node, key) =>
      isRecord(node) && Object.hasOwn(node, key)
        ? node[key]
        : undefined, body);
    return { path, value: value === undefined ? null : value };
  });
}
