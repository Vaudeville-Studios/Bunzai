/** Shared version existence, quarantine, and live-row stability checks for historical projections. */
import type { ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { StudioConflictError, StudioReadError } from "../../studio/errors";
import type { DocumentBackend, DocumentRow, EntityKind } from "../contracts/content-store";

export async function readStableStoredVersion(
  backend: DocumentBackend,
  kind: EntityKind,
  id: string,
  version: number,
  load: (row: DocumentRow) => Promise<ParsedCanonicalEntity | null>,
): Promise<ParsedCanonicalEntity | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await backend.get(kind, id);
    if (!row) return null;
    const { rows, quarantined } = await backend.versions(kind, id);
    const current = async () => (await backend.get(kind, id))?.writeId === row.writeId;
    if (quarantined.includes(version)) {
      if (!(await current())) continue;
      throw new StudioReadError(`${kind} ${id} version ${version} is damaged`, "unreadable-json");
    }
    if (!rows.some((entry) => entry.version === version)) {
      if (await current()) return null;
      continue;
    }
    const entity = await load(row);
    const latest = await backend.get(kind, id);
    if (!latest) return null;
    if (latest.writeId !== row.writeId) continue;
    return entity;
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while reading history`);
}
