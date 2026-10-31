/**
 * Duplicating a piece by reference: the copy's parts are written from the source's own cached-style fill,
 * so every picture stays a link to its existing blob and nothing is expanded, re-hashed or resealed. A
 * pack of 40 pictures duplicates for the price of its head. Keep-both ids, like `save`: `<id>-2`, `<id>-3`.
 */
import { COLD_READ_LIMIT } from "./cold-read-budget";
import { revisionFromParts } from "../../entities/canonical-revision";
import { decompose } from "../../entities/piece-parts";
import type { KnownBlobs } from "../../entities/piece-parts-blob";
import type { ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { StudioConflictError, StudioValidationError } from "../../studio/errors";

import { assertSafeStudioId } from "../../studio/path-policy";
import type { ContentSummary, DocumentBackend, EntityKind } from "../contracts/content-store";
import type { ExtensionCommitContext } from "../contracts/extension-store";
import { holdFill } from "./content-store-hold";
import { buildPartText, contentSummaryOf } from "./content-store-write";
import { buildSummary } from "./summary-content";
import type { ColdFillResult } from "./content-store-read";

const LAST_SUFFIX = 999;

export async function duplicateHeld(
  backend: DocumentBackend,
  kind: EntityKind,
  id: string,
  transform: (entity: ParsedCanonicalEntity) => ParsedCanonicalEntity,
  clock: () => number,
  coldFill?: (kind: EntityKind, id: string, writeId: number, mode?: "hold") => Promise<ColdFillResult>,
  extensionCommit?: ExtensionCommitContext,
): Promise<ContentSummary | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await backend.get(kind, id);
    if (!row) return null;
    const loaded = coldFill ? await coldFill(kind, row.id, row.writeId, "hold") : await holdFill(backend, kind, row, COLD_READ_LIMIT);
    if ("status" in loaded) {
      if (loaded.status === "missing") return null;
      continue; // changed while opening: read it again
    }
    try {
      const { entity, parts } = loaded.filled;
      const known: KnownBlobs = {
        blobs: new Map(parts.flatMap((part) => part.blobs).map((blob) => [blob.key, blob] as const)),
        held: new Set(parts.flatMap((part) => part.refs ?? [])),
      };
      if ((await backend.get(kind, id))?.writeId !== row.writeId || !loaded.valid()) continue;
      for (let n = 2; n <= LAST_SUFFIX; n++) {
        const copyId = assertSafeStudioId(`${id}-${n}`);
        const copy = transform({ ...entity, id: copyId } as ParsedCanonicalEntity);
        const next = decompose(copy, undefined, known);
        const revision = revisionFromParts(next);
        const t = clock();
        const made = {
          row: { kind, id: copyId, revision, version: 1, writeId: 1, autosaveStartedAt: null, createdAt: t, updatedAt: t },
          version: { kind, id: copyId, version: 1, revision, savedAt: t, reason: "create" as const, autosaveStartedAt: null },
        };
        const summary = buildSummary(copy, (sha) => known.blobs.has(sha) || known.held.has(sha));
        const wrote = await backend.write(made.row, made.version, { when: "absent", ...(extensionCommit ? { extensionCommit } : {}) }, summary, { put: next.map(buildPartText), drop: [] });
        if (wrote) return contentSummaryOf(made.row, copy, summary.content);
      }
      throw new StudioValidationError("no free id left for keep-both");
    } finally {
      loaded.release();
    }
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while duplicating`);
}

/**
 * The piece exactly as the library holds it, except that every picture is its sentinel instead of base64:
 * the read a backup uses when a whole-piece read would exceed the cold-read budget. Resolve each sentinel with
 * `readAsset`, one at a time. Null when no live piece holds the id.
 */
export async function readHeldPiece(
  backend: DocumentBackend,
  kind: EntityKind,
  id: string,
  coldFill?: (kind: EntityKind, id: string, writeId: number, mode?: "hold") => Promise<ColdFillResult>,
): Promise<{ entity: ParsedCanonicalEntity; revision: string; version: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await backend.get(kind, id);
    if (!row) return null;
    const loaded = coldFill ? await coldFill(kind, row.id, row.writeId, "hold") : await holdFill(backend, kind, row, COLD_READ_LIMIT);
    if ("status" in loaded) {
      if (loaded.status === "missing") return null;
      continue;
    }
    try {
      if ((await backend.get(kind, id))?.writeId !== row.writeId || !loaded.valid()) continue;
      return { entity: loaded.filled.entity, revision: row.revision, version: row.version };
    } finally {
      loaded.release();
    }
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while opening`);
}
