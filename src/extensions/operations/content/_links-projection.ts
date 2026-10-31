/** Reviewed character link projection paired with character.links.update semantics. */
import { z } from "zod";
import { parseCanonicalEntity } from "../../../entities/runtime-schema";

export const CHARACTER_LINKS_GROUP = "character.links" as const;
export const characterLinksSchema = z.strictObject({
  id: z.string().min(1).max(120),
  kind: z.literal("character"),
  group: z.literal(CHARACTER_LINKS_GROUP),
  links: z.strictObject({
    worldName: z.string().max(200).optional(),
    knowledgeRefs: z.array(z.string().max(200)).max(100).optional(),
    behaviorRefs: z.array(z.string().max(200)).max(100).optional(),
    truncated: z.boolean().optional(),
  }),
});

export function projectCharacterLinks(raw: unknown, expectedId?: string) {
  const entity = parseCanonicalEntity(raw);
  if (entity.kind !== "character" || (expectedId !== undefined && entity.id !== expectedId)) return null;
  const { worldName, knowledgeRefs = [], behaviorRefs = [] } = entity.body;
  const refs = (items: readonly string[]) => ({ values: items.slice(0, 100).map((item) => item.slice(0, 200)), clipped: items.length > 100 || items.some((item) => item.length > 200) });
  const knowledge = refs(knowledgeRefs);
  const behavior = refs(behaviorRefs);
  const clippedName = worldName !== null && worldName !== undefined && worldName.length > 200;
  return characterLinksSchema.parse({
    id: entity.id, kind: entity.kind, group: CHARACTER_LINKS_GROUP,
    links: {
      ...(worldName !== undefined ? { worldName: worldName.slice(0, 200) } : {}),
      ...(entity.body.knowledgeRefs !== undefined ? { knowledgeRefs: knowledge.values } : {}),
      ...(entity.body.behaviorRefs !== undefined ? { behaviorRefs: behavior.values } : {}),
      ...(knowledge.clipped || behavior.clipped || clippedName ? { truncated: true } : {}),
    },
  });
}
