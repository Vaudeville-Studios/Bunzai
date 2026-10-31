/** History reads and restores, pinned to the live row's monotonic write identity. */
import { COLD_READ_LIMIT } from "./cold-read-budget";
import type { ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { StudioConflictError } from "../../studio/errors";

import type { DocumentBackend, EntityKind } from "../contracts/content-store";
import { revisionFromParts } from "../../entities/canonical-revision";
import { decompose } from "../../entities/piece-parts";
import type { KnownBlobs } from "../../entities/piece-parts-blob";
import { holdFill } from "./content-store-hold";
import { contentSummaryOf, decode, restoreWrite } from "./content-store-write";
import { buildSummary } from "./summary-content";
import { readStableStoredVersion } from "./content-store-history-read";

const MAX_HISTORY_ATTEMPTS = 5;

export async function readStoredVersion(backend: DocumentBackend, kind: EntityKind, id: string, version: number): Promise<ParsedCanonicalEntity | null> {
  return readStableStoredVersion(backend, kind, id, version, async () => {
    const parts = await backend.parts(kind, id, version);
    if (!parts) return null;
    const decoded = decode(kind, id, parts);
    return decoded.ok ? decoded.entity : null;
  });
}

export async function restoreStoredVersion(
  backend: DocumentBackend,
  kind: EntityKind,
  id: string,
  version: number,
  keepVersions: number,
  clock: () => number,
): Promise<ReturnType<typeof contentSummaryOf> | null> {
  for (let attempt = 0; attempt < MAX_HISTORY_ATTEMPTS; attempt++) {
    const current = await backend.get(kind, id);
    if (!current) return null;
    // The old version is opened with its pictures as references: a restore copies part rows in SQL and needs
    // only the entity (for its summary) and its revision, never a big pack's pictures.
    const { rows: versions } = await backend.versions(kind, id);
    if (!versions.some((entry) => entry.version === version)) return null;
    const loaded = await holdFill(backend, kind, current, COLD_READ_LIMIT, version);
    if ("status" in loaded) { if (loaded.status === "missing") return null; continue; }
    loaded.release();
    const old = loaded.filled.entity;
    const known: KnownBlobs = {
      blobs: new Map(loaded.filled.parts.flatMap((part) => part.blobs).map((blob) => [blob.key, blob] as const)),
      held: new Set(loaded.filled.parts.flatMap((part) => part.refs ?? [])),
    };
    const revision = revisionFromParts(decompose(old, undefined, known));
    if (revision === current.revision) {
      if ((await backend.get(kind, id))?.writeId === current.writeId) return contentSummaryOf(current, old, buildSummary(old, (sha) => known.blobs.has(sha) || known.held.has(sha)).content);
      continue;
    }
    const built = restoreWrite(current, old, version, clock(), revision);
    const summary = buildSummary(built.entity, (sha) => known.blobs.has(sha) || known.held.has(sha));
    const wrote = await backend.write(
      built.row,
      built.version,
      { when: "writeId", expected: current.writeId },
      summary,
      built.change,
    );
    if (!wrote) continue;
    await backend.pruneVersions(current.kind, current.id, keepVersions);
    return contentSummaryOf(built.row, built.entity, summary.content);
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while restoring history`);
}
