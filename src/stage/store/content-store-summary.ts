/** Decodes a derived summary cache without making one corrupt cache row break the listing. */
import type { PieceSummaryContent } from "../contracts/content-store";

export function parseSummaryContent(text: string | null): PieceSummaryContent | null {
  if (text === null) return null;
  try { return JSON.parse(text) as PieceSummaryContent; }
  catch { return null; }
}
