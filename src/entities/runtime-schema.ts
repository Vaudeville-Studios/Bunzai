/**
 * The only public untrusted-JSON parse boundary for canonical pieces. Each kind's whole-entity decoder lives in its
 * own folder (src/entities/<kind>/runtime-schema.ts, built from the shared envelope in _shared/envelope.ts);
 * src/generated/kind-schemas.ts collects them, so a new kind needs no edit here.
 */
import { z } from "zod";
import type { AnyKindEntity } from "../generated/kinds";
import { ENTITY_SCHEMAS } from "../generated/kind-schemas";

export const canonicalEntitySchema = z.discriminatedUnion("kind", ENTITY_SCHEMAS);
const canonicalBodyProjections = ENTITY_SCHEMAS.map((schema) => z.strictObject({
  id: schema.shape.id,
  kind: schema.shape.kind,
  body: schema.shape.body,
}));
/** Canonical authored body without escrow, notes, platform profiles or host-owned config. */
export const canonicalEntityBodySchema = z.union(canonicalBodyProjections as [typeof canonicalBodyProjections[number], ...typeof canonicalBodyProjections]);

/** Any canonical piece of any kind. */
export type ParsedCanonicalEntity = AnyKindEntity;

/** Parse untrusted JSON once into the known canonical union. */
export function parseCanonicalEntity(raw: unknown): ParsedCanonicalEntity {
  return canonicalEntitySchema.parse(raw);
}

/** Non-throwing detector for request boundaries that need a bounded client error. */
export function safeParseCanonicalEntity(raw: unknown):
  | { ok: true; entity: ParsedCanonicalEntity }
  | { ok: false; issues: string[] } {
  const parsed = canonicalEntitySchema.safeParse(raw);
  if (parsed.success) return { ok: true, entity: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      return `${path || "entity"}: ${issue.message}`;
    }),
  };
}
