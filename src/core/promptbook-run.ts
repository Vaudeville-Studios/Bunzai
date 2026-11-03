/** Saved Promptbook provenance shared by execution recovery and the Inspector's strict read boundary. */
import { z } from "zod";
import { promptAttachmentInfoListSchema } from "./media/prompt-attachment";
export const phaseRunSchema = z.strictObject({
  id: z.string(), name: z.string(), role: z.enum(["private", "reply", "after"]), status: z.enum(["ran", "skipped"]),
  why: z.string(), text: z.string(), request: z.array(z.string()), files: promptAttachmentInfoListSchema.optional(), model: z.string().optional(),
  promptTokens: z.number().nonnegative().optional(), outputTokens: z.number().nonnegative().optional(), ms: z.number().nonnegative().optional(),
}).superRefine((phase, ctx) => {
  phase.files?.forEach((file, index) => {
    if (file.message >= phase.request.length) ctx.addIssue({ code: "custom", path: ["files", index, "message"], message: "attachment message is outside the phase request" });
  });
});
export type PhaseRun = z.infer<typeof phaseRunSchema>;
export const bookRunSchema = z.strictObject({ status: z.enum(["running", "complete", "stopped"]), phases: z.array(phaseRunSchema) });
export type BookRun = z.infer<typeof bookRunSchema>;
export function readBookRun(raw: unknown): BookRun | undefined {
  const result = bookRunSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
