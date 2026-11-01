/** Strict source and output projection for approved piece summary fields. */
import { z } from "zod";
import type { PieceSummary } from "../../../stage/contracts/content-store-summary";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";

export const SUMMARY_FIELDS = ["id", "kind", "name", "updatedAt", "tags", "description"] as const;
export const summaryFieldSchema = z.enum(SUMMARY_FIELDS);
export const safeSummarySchema = z.strictObject({
  id: z.string().min(1).max(120),
  kind: z.enum(STUDIO_ENTITY_KINDS),
  name: z.string().max(500),
  updatedAt: z.number().finite().optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
  /** True when the bounded preview omitted or shortened source tags. */
  tagsTruncated: z.boolean().optional(),
  description: z.string().max(160).optional(),
});
export const contentKindSchema = z.enum(STUDIO_ENTITY_KINDS);
export const summaryFieldsSchema = z.array(summaryFieldSchema).min(3).max(SUMMARY_FIELDS.length).refine(
  (fields) => new Set(fields).size === fields.length
    && ["id", "kind", "name"].every((field) => fields.includes(field as typeof fields[number])),
  "id, kind, and name are required summary fields",
);

export function projectSummary(
  summary: Pick<PieceSummary, "id" | "kind" | "name">
    & Partial<Pick<PieceSummary, "updatedAt" | "tags" | "description">>
    & { tagsTruncated?: boolean },
  fields: readonly (typeof SUMMARY_FIELDS[number])[],
): z.infer<typeof safeSummarySchema> {
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in summary)) continue;
    if (field === "tags" && Array.isArray(summary.tags)) {
      const bounded = summary.tags.map((tag) => tag.slice(0, 80));
      selected.tags = bounded.slice(0, 20);
      if (summary.tagsTruncated || bounded.length > 20 || bounded.some((tag, index) => tag !== summary.tags?.[index])) selected.tagsTruncated = true;
    } else {
      selected[field as keyof typeof summary] = summary[field as keyof typeof summary];
    }
  }
  return safeSummarySchema.parse(selected);
}
