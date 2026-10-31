/** The single approved character identity projection for extension reads. */
import { z } from "zod";
import { parseCanonicalEntity } from "../../../entities/runtime-schema";

export const CHARACTER_IDENTITY_GROUP = "character.identity" as const;
export const CHARACTER_IDENTITY_FIELDS = ["name", "nickname", "tagline", "description", "characterVersion"] as const;
export const characterIdentityGroupSchema = z.strictObject({
  id: z.string().min(1).max(120),
  kind: z.literal("character"),
  group: z.literal(CHARACTER_IDENTITY_GROUP),
  identity: z.strictObject({
    name: z.string().max(500),
    nickname: z.string().max(500).optional(),
    tagline: z.string().max(2_000).optional(),
    description: z.string().max(100_000).optional(),
    characterVersion: z.string().max(500).optional(),
  }),
});

/** Decode canonical input and explicitly omit identity attributes outside this grantable group. */
export function projectCharacterIdentity(raw: unknown, expectedId?: string) {
  const entity = parseCanonicalEntity(raw);
  if (entity.kind !== "character" || (expectedId !== undefined && entity.id !== expectedId)) return null;
  const identity = entity.body.identity;
  return characterIdentityGroupSchema.parse({
    id: entity.id,
    kind: entity.kind,
    group: CHARACTER_IDENTITY_GROUP,
    identity: Object.fromEntries(CHARACTER_IDENTITY_FIELDS.filter((field) => identity[field] !== undefined)
      .map((field) => [field, identity[field]])),
  });
}
