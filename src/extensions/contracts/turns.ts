/** Bounded non-content DTOs for extension-owned access to the canonical roleplay turn loop. */
import { z } from "zod";

export const extensionTurnKindSchema = z.enum(["reply", "continue", "swipe"]);
export const extensionTurnOutcomeSchema = z.strictObject({
  sceneId: z.string().min(1).max(120),
  status: z.enum(["completed", "failed", "conflict", "stopped"]),
  turnId: z.string().max(120).nullable(),
  messageId: z.string().max(120).nullable(),
});
export const extensionTurnStatusSchema = z.strictObject({
  sceneId: z.string().min(1).max(120),
  status: z.enum(["idle", "running"]),
  turnId: z.string().max(120).nullable(),
  kind: extensionTurnKindSchema.nullable(),
});
export type ExtensionTurnKind = z.infer<typeof extensionTurnKindSchema>;
export type ExtensionTurnOutcome = z.infer<typeof extensionTurnOutcomeSchema>;
export type ExtensionTurnStatus = z.infer<typeof extensionTurnStatusSchema>;
