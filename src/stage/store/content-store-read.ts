/** One whole-entity read with writeId retries and the optional SQLite cold-worker owner. */
import type { ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { StudioConflictError, StudioReadError } from "../../studio/errors";

import { assertStudioEntityKind } from "../../studio/path-policy";
import type { DocumentBackend, DocumentRow, EntityKind, PartText } from "../contracts/content-store";
import type { PartRecord } from "../../entities/piece-parts";
import { coldFillParts, ColdReadDamageError } from "./content-store-write";
import { COLD_READ_LIMIT, coldReadCharge } from "./cold-read-budget";
import { utf8ByteLength } from "../../shared/utf8";

export type ColdFillResult =
  | { writeId: number; filled: { entity: ParsedCanonicalEntity; parts: PartRecord[] }; valid(): boolean; release(): void }
  | { status: "missing" | "stale" };

export async function readContentEntity(
  backend: DocumentBackend,
  liveRow: (kind: string, id: string) => Promise<DocumentRow | null>,
  kind: EntityKind,
  id: string,
  coldFill?: (kind: EntityKind, id: string, writeId: number, mode?: "hold") => Promise<ColdFillResult>,
): Promise<{ entity: ParsedCanonicalEntity; revision: string; version: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await liveRow(kind, id);
    if (!row) return null;
    if (coldFill) {
      const loaded = await coldFill(assertStudioEntityKind(row.kind), row.id, row.writeId);
      if ("status" in loaded) {
        const latest = await liveRow(kind, id);
        if (!latest) return null;
        if (latest.writeId !== row.writeId) continue;
        return null;
      }
      try {
        const latest = await liveRow(kind, id);
        if (!latest) return null;
        if (latest.writeId !== row.writeId || !loaded.valid()) continue;
        return { entity: loaded.filled.entity, revision: row.revision, version: row.version };
      } finally {
        loaded.release();
      }
    }
    const snapshot = await backend.livePartsBounded?.(kind, id, row.writeId, COLD_READ_LIMIT);
    if (!snapshot) throw new Error("the backend cannot safely bound a cold read");
    if ("status" in snapshot) {
      if (snapshot.status === "stale") continue;
      if (snapshot.status === "missing") return null;
      throw new Error("this piece exceeds the bounded cold-read memory limit");
    }
    if (!snapshot.parts.length) return null;
    let filled: Awaited<ReturnType<typeof coldFillParts>>;
    // The snapshot is held while it decodes, so the decode gets what the budget has left after it, as the worker does.
    const payloadBytes = (p: PartText) => utf8ByteLength(p.text) + p.blobs.reduce((n, b) => n + (b.payload.kind === "bytes" ? b.payload.bytes.byteLength : utf8ByteLength(b.payload.text)), 0);
    const snapshotCharge = coldReadCharge(snapshot.parts.reduce((n, p) => n + payloadBytes(p), 0), snapshot.parts.length, snapshot.parts.reduce((n, p) => n + p.blobs.length, 0));
    try { filled = await coldFillParts(snapshot.parts, { charge: COLD_READ_LIMIT - snapshotCharge }, { kind: row.kind, id: row.id }); }
    catch (error) {
      if (error instanceof ColdReadDamageError) throw new StudioReadError(`${kind} ${id} is damaged`, error.reason);
      throw error;
    }
    const latest = await liveRow(kind, id);
    if (!latest) return null;
    if (latest.writeId !== row.writeId) continue;
    if (!filled) return null;
    return { entity: filled.entity, revision: row.revision, version: row.version };
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while opening`);
}
