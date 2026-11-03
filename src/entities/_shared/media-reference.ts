/**
 * Canonical media slots shared by part encoding and light-read projection. Each kind declares where it keeps binary assets
 * in its kind.ts (`media`, dotted paths with `#` for an array index and `*` for any key); every kind's escrowed source
 * picture (original.<format>.sourceMedia.b64) is one too. A hot path, so the patterns are split once, here.
 */
import { KINDS } from "../../generated/kinds";

const SOURCE_MEDIA = ["original", "*", "sourceMedia", "b64"];
const PATTERNS = new Map<string, string[][]>(KINDS.map((k) => [k.id, [SOURCE_MEDIA, ...(k.media ?? []).map((p) => p.split("."))]]));
const DIGITS = /^\d+$/;

const matches = (pattern: readonly string[], path: readonly string[]): boolean =>
  pattern.length === path.length && pattern.every((seg, i) => seg === "*" || (seg === "#" ? DIGITS.test(path[i]!) : seg === path[i]));

export function isCanonicalMediaReference(kind: string, path: readonly (string | number)[]): boolean {
  const p = path.map(String);
  return (PATTERNS.get(kind) ?? [SOURCE_MEDIA]).some((pattern) => matches(pattern, p));
}

/** The kinds whose image slots belong in Kit's gallery and art tools; document attachments are not gallery art. */
export const ART_KINDS = KINDS.filter((k) => k.gallery === true).map((k) => k.id);
