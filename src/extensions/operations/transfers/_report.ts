/** Bounded public projection of the canonical serializer's fidelity report. */
import { z } from "zod";

const paths = z.array(z.string().max(180)).max(256);
export const transferReportSchema = z.strictObject({
  counts: z.strictObject({ escrowed: z.number().int().nonnegative(), dropped: z.number().int().nonnegative().nullable(), escrowShadowed: z.number().int().nonnegative(), warnings: z.number().int().nonnegative() }),
  escrowed: paths, dropped: paths, escrowShadowed: paths, warnings: paths,
  coverage: z.enum(["declared", "native", "unknown"]),
});
