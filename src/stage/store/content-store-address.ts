/** Canonical entity and address validation at the ContentStore boundary. */
import { parseCanonicalEntity, type ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { StudioValidationError } from "../../studio/errors";
import { assertSafeStudioId, assertStudioEntityKind } from "../../studio/path-policy";
import type { EntityKind } from "../contracts/content-store";

export function parseContentInput(raw: unknown): { entity: ParsedCanonicalEntity; kind: EntityKind; id: string } {
  let entity: ParsedCanonicalEntity;
  try { entity = parseCanonicalEntity(raw); }
  catch { throw new StudioValidationError("invalid canonical entity"); }
  const kind: EntityKind = entity.kind;
  const id = assertSafeStudioId(entity.id);
  return { entity: { ...entity, id }, kind, id };
}

export function contentAddress(kind: unknown, id: unknown): { kind: EntityKind; id: string } {
  return { kind: assertStudioEntityKind(kind), id: assertSafeStudioId(id) };
}
