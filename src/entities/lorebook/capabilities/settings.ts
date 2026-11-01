/**
 * Semantic capability for updating portable lorebook-level settings.
 */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CanonicalLorebook } from "../schema";
import { updateLorebookSettings } from "./operations";
import {
  canonicalPlatforms,
  change,
  lorebookBody,
  targetSchema,
  withLorebookBody,
} from "./shared";

const settingsPatchSchema = z.strictObject({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  lorebookType: z.enum(["world", "character", "scenario", "rules", "utility", "other"]).nullable().optional(),
  genre: z.string().nullable().optional(),
  fandom: z.string().nullable().optional(),
  globalCaseSensitive: z.boolean().optional(),
  globalMatchWholeWords: z.boolean().optional(),
  globalScanDepth: z.number().int().min(0).optional(),
  globalRecursion: z.boolean().optional(),
  tokenBudget: z.number().int().min(0).optional(),
  budgetMode: z.enum(["token", "entry"]).optional(),
  entryBudget: z.number().int().min(0).optional(),
});

const input = z.strictObject({
  target: targetSchema,
  patch: settingsPatchSchema.refine((patch) => Object.keys(patch).length > 0, {
    message: "at least one setting must change",
  }),
});

const capability = defineContentCapability<z.infer<typeof input>, CanonicalLorebook>({
  id: "lorebook.settings.update",
  kind: "lorebook",
  area: "settings",
  action: "update",
  summary: "Change portable lorebook settings such as its name, matching defaults, or budget.",
  aliases: ["edit lorebook", "change book settings", "rename lorebook"],
  extensionExposure: {
    operationId: "content.draft.lorebook.settings.update",
    fields: Object.keys(settingsPatchSchema.shape).map((key) => ({ input: `patch.${key}`, path: `body.${key}` })),
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview(entity, { patch }) {
    const before = lorebookBody(entity);
    const body = updateLorebookSettings(before, patch);
    const changes = Object.entries(patch)
      .map(([key, after]) => change(`body.${key}`, key, before[key as keyof typeof before], after))
      .filter((row) => row !== null);
    return {
      entity: withLorebookBody(entity, body),
      changes,
      warnings: [],
      platformImpact: [],
    };
  },
});

export default capability;
