/** Strict public projection for a persona's shelf identity, excluding injected content. */
import { z } from "zod";
import type { ParsedCanonicalEntity } from "../../../entities/runtime-schema";

export const PERSONA_IDENTITY_GROUP = "persona.identity" as const;
export const PERSONA_IDENTITY_FIELDS = ["persona.name", "persona.brief"] as const;
export const personaIdentitySchema = z.strictObject({ id: z.string().min(1).max(120), kind: z.literal("persona"), group: z.literal(PERSONA_IDENTITY_GROUP), identity: z.strictObject({ name: z.string().min(1).max(120), brief: z.string().max(2000).optional() }) });
export function projectPersonaIdentity(entity: ParsedCanonicalEntity, id: string) {
  if (entity.kind !== "persona" || entity.id !== id) return null;
  const { name, brief } = entity.body;
  return personaIdentitySchema.parse({ id, kind: "persona", group: PERSONA_IDENTITY_GROUP, identity: { name, ...(brief === undefined ? {} : { brief }) } });
}
