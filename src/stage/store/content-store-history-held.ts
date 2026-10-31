/** Historical reads that preserve media references instead of hydrating their payloads. */
import type { ParsedCanonicalEntity } from "../../entities/runtime-schema";
import type { DocumentBackend, EntityKind } from "../contracts/content-store";
import { COLD_READ_LIMIT } from "./cold-read-budget";
import { holdFill } from "./content-store-hold";
import { readStableStoredVersion } from "./content-store-history-read";

export async function readStoredVersionHeld(backend: DocumentBackend, kind: EntityKind, id: string, version: number): Promise<ParsedCanonicalEntity | null> {
  return readStableStoredVersion(backend, kind, id, version, async (row) => {
    const loaded = await holdFill(backend, kind, row, COLD_READ_LIMIT, version);
    if ("status" in loaded) return null;
    try {
      if (!loaded.valid()) return null;
      return loaded.filled.entity;
    } finally {
      loaded.release();
    }
  });
}
