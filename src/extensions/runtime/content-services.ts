/** Scoped, bounded operation adapters over the canonical ContentStore. */
import type { ContentStore } from "../../stage/contracts/content-store";
import type { PieceSummary } from "../../stage/contracts/content-store-summary";
import type { ContentKind } from "../../entities/capabilities/types";
import type { ExtensionContentServices, ResourceRef } from "../contracts/operation";
import { decodeJsonValue } from "../contracts/value";
import { CHARACTER_IDENTITY_FIELDS, projectCharacterIdentity } from "../operations/content/_identity-projection";
import { projectCharacterLinks } from "../operations/content/_links-projection";
import { PERSONA_IDENTITY_FIELDS, projectPersonaIdentity } from "../operations/content/_persona-projection";
import { canonicalEntityBodySchema } from "../../entities/runtime-schema";
import { assertReviewedBodyFields, projectReviewedBodyFields } from "../operations/content/_reviewed-fields";

const libraryRef = (ref: ResourceRef): boolean => ref.kind === "library" && ref.id === "library";
const hasRef = (scope: readonly ResourceRef[], kind: string, id: string): boolean => scope.some((ref) => libraryRef(ref) || ref.kind === kind && ref.id === id);
function projected(row: PieceSummary, fields: readonly string[]): PieceSummary {
  return {
    id: row.id, kind: row.kind, name: row.name, tokens: row.tokens, version: row.version, writeId: row.writeId, revision: row.revision, updatedAt: row.updatedAt,
    ...(fields.includes("tags") && row.tags ? { tags: row.tags } : {}),
    ...(fields.includes("description") && row.description ? { description: row.description } : {}),
  };
}
async function scopedRows(store: ContentStore, scope: readonly ResourceRef[], kinds: readonly ContentKind[]): Promise<PieceSummary[]> {
  if (scope.length === 0) throw new Error("content scope is required");
  const allowed = new Set(kinds);
  if (scope.some(libraryRef)) {
    if (scope.length !== 1 || !libraryRef(scope[0]!)) throw new Error("mixed library and selected-piece scope is invalid");
    const rows = await Promise.all(kinds.map((kind) => store.summaries(kind)));
    return rows.flatMap((result) => result.entities);
  }
  const rows = await Promise.all(scope.filter((ref) => allowed.has(ref.kind as ContentKind)).map((ref) => store.summary(ref.kind as ContentKind, ref.id)));
  return rows.filter((row): row is PieceSummary => row !== null);
}

/** Scope filtering precedes search scoring, result count and limit; detail reads never open whole entities for summaries. */
export function extensionContentServices(store: ContentStore): ExtensionContentServices {
  return {
    async listSummaries(scope, kinds, limit, fields) {
      return (await scopedRows(store, scope, kinds)).sort((a, b) => b.updatedAt - a.updatedAt || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).slice(0, limit).map((row) => projected(row, fields));
    },
    async searchSummaries(query, scope, kinds, limit, fields) {
      const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
      return (await scopedRows(store, scope, kinds)).map((row) => {
        const haystack = [fields.includes("name") ? row.name : "", ...(fields.includes("tags") ? row.tags ?? [] : []), ...(fields.includes("description") ? [row.description ?? ""] : [])].join(" ").toLocaleLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { row, score };
      }).filter(({ score }) => score === terms.length).sort((a, b) => b.score - a.score || b.row.updatedAt - a.row.updatedAt || a.row.id.localeCompare(b.row.id)).slice(0, limit).map(({ row }) => projected(row, fields));
    },
    async readSummary(kind, id, scope, fields) {
      if (!hasRef(scope, kind, id)) throw new Error("content scope is outside the approved grant");
      const row = await store.summary(kind, id);
      return row ? projected(row, fields) : null;
    },
    async readBody(kind, id, scope, fields) {
      if (!hasRef(scope, kind, id) || fields.length !== 1 || fields[0] !== "body") throw new Error("canonical content body is outside the approved grant");
      const held = await store.readHeld(kind, id);
      return held ? decodeJsonValue(JSON.parse(JSON.stringify(canonicalEntityBodySchema.parse({ kind: held.entity.kind, id: held.entity.id, body: held.entity.body })))) : null;
    },
    async readSelectedFields(kind, id, scope, fields) {
      if (!hasRef(scope, kind, id)) throw new Error("content scope is outside the approved grant");
      assertReviewedBodyFields(kind, fields);
      const held = await store.readHeld(kind, id);
      if (!held) return null;
      const body = canonicalEntityBodySchema.parse({ kind: held.entity.kind, id: held.entity.id, body: held.entity.body }).body;
      return projectReviewedBodyFields(kind, body, fields).map(({ path, value }) => ({ path, value: decodeJsonValue(value) }));
    },
    async readFields(kind, id, group, scope, fields) {
      if (!hasRef(scope, kind, id) || kind !== "character" || group !== "character.identity") throw new Error("content field group is outside the approved grant");
      if (fields.some((field) => !CHARACTER_IDENTITY_FIELDS.includes(field as typeof CHARACTER_IDENTITY_FIELDS[number]))) throw new Error("content fields are outside the approved grant");
      const held = await store.readHeld("character", id);
      return held ? projectCharacterIdentity(held.entity, id) : null;
    },
    async readPersonaIdentity(kind, id, group, scope, fields) {
      if (kind !== "persona" || group !== "persona.identity" || !hasRef(scope, kind, id)
        || fields.some((field) => !PERSONA_IDENTITY_FIELDS.includes(field as typeof PERSONA_IDENTITY_FIELDS[number]))) throw new Error("persona identity is outside the approved grant");
      const held = await store.readHeld("persona", id);
      return held ? projectPersonaIdentity(held.entity, id) : null;
    },
    async readLinks(kind, id, scope, fields) {
      if (kind !== "character" || !hasRef(scope, kind, id) || fields.length !== 1 || fields[0] !== "links") throw new Error("content links are outside the approved grant");
      const held = await store.readHeld("character", id);
      return held ? projectCharacterLinks(held.entity, id) : null;
    },
    async listHistory(kind, id, scope, fields) {
      if (!hasRef(scope, kind, id) || fields.length !== 1 || fields[0] !== "history") throw new Error("content history is outside the approved grant");
      return (await store.versions(kind, id)).versions;
    },
    async readHistory(kind, id, version, scope, fields) {
      if (!hasRef(scope, kind, id) || !fields.includes("history")) throw new Error("historical content is outside the approved grant");
      const paths = fields.filter((field) => field !== "history");
      assertReviewedBodyFields(kind, paths);
      const entity = await store.readVersionHeld(kind, id, version);
      if (!entity || entity.kind !== kind || entity.id !== id) return null;
      const body = canonicalEntityBodySchema.parse({ kind: entity.kind, id: entity.id, body: entity.body }).body;
      return projectReviewedBodyFields(kind, body, paths).map(({ path, value }) => ({ path, value: decodeJsonValue(value) }));
    },
    async trash(kind, id, expectedRevision, scope, commit) {
      if (!hasRef(scope, kind, id)) throw new Error("content target is outside the approved grant");
      return (await store.deleteWithReceipt(kind, id, expectedRevision, commit)) !== null;
    },
    async readGrave(kind, id, graveId, scope) {
      if (!hasRef(scope, kind, id)) throw new Error("trash target is outside the approved grant");
      const grave = (await store.graveSummaries(kind)).find((item) => item.graveId === graveId && item.id === id);
      return grave ?? null;
    },
    async restore(kind, id, graveId, scope, commit) {
      if (!hasRef(scope, kind, id)) throw new Error("restore target is outside the approved grant");
      const grave = (await store.graveSummaries(kind)).find((item) => item.graveId === graveId && item.id === id);
      if (!grave) return null;
      const restored = await store.restore(graveId, commit);
      if (!restored || restored.kind !== kind || restored.id !== id) throw new Error("restore result escaped the approved resource");
      return restored;
    },
  };
}
