/**
 * The in-memory DocumentBackend: live rows, their versions, graves, summaries, and parts, all in maps, for tests, the
 * contract suite, and the static browser build. It never parses a body (D18 rule 1). No method awaits
 * between its check and its change, and JavaScript runs synchronous code to completion, so each
 * method is atomic the way a single SQLite transaction is. Keep it that way: an await inside a method
 * here would reopen every race the contract suite's concurrency tests exist to catch.
 *
 * Summaries mirror the SQLite backend: every write keeps
 * one summary entry per live row (null means "not computed"), moved into the grave on bury and back
 * on unbury, and dropped with the grave on purge, all in the same synchronous step as the row itself.
 *
 * Parts are kept per piece key (the same fold `keyOf` already uses for rows, versions, and summaries),
 * each a `{ name, text, fromVersion, toVersion, blobKeys }` row mirroring `piece_parts` plus
 * `blob_refs` collapsed onto it: `toVersion === null` means live, `blobKeys` is the blobs this part's
 * own sentinels reference. Bury and unbury never touch this map - a piece's parts outlive its
 * `documents` row the same way they do in SQLite, reachable by the one key that never moves. There is
 * no encryption here (no cipher, no swapped-cell risk to catch: that guard is SQLite-only, proven in
 * its own tests), so this file needs none of `piece-parts-sql.ts`'s cell framing, only its
 * validity-range shape.
 *
 * `blobs` (holistic 4.2; S4b) is one global, content-addressed map, exactly like the SQLite backend's
 * `blobs` table: a key survives as long as ANY part row anywhere (live or merely not yet pruned)
 * still names it in its `blobKeys`, checked by scanning every piece's part list - acceptable here
 * since this backend exists for tests, the contract suite, and the static browser build, never the
 * perf-critical path the SQLite backend owns.
 */
import {
  foldId,
  type DocumentBackend,
  type DocumentRow,
  type DocumentVersionRow,
  type LivePartSnapshot,
  type LivePartBounds,
  type BlobPayload,
  type GraveRow,
  type GraveSummaryRow,
  type PartChange,
  type PartText,
  type PieceChangeEvent,
  type SummaryRow,
  type VersionRow,
} from "../../contracts/content-store";
import { utf8ByteLength } from "../../../shared/utf8";
import { breather } from "../breather";
import { coldReadCharge } from "../cold-read-budget";
import { memoryAssetReads } from "./document-assets";
import { conditionHolds } from "./document-write-condition";
import type { ExtensionCommitContext } from "../../contracts/extension-store";

/** One key per spelling-insensitive id (spec behavior 12a). */
const keyOf = (kind: string, id: string): string => `${kind}\u0000${foldId(id)}`;

interface PartRow {
  name: string;
  text: string;
  fromVersion: number;
  toVersion: number | null;
  /** The blobs THIS row's own sentinels reference (holistic 4.2's `blob_refs`, collapsed onto the row
   * since there is no separate join table here). */
  blobKeys: readonly string[];
}

export function memoryDocumentBackend(options: { authorizeExtensionCommit?: (context: ExtensionCommitContext) => void } = {}): DocumentBackend {
  const authorizeExtensionCommit = (context: ExtensionCommitContext | undefined): void => {
    if (!context) return;
    if (!options.authorizeExtensionCommit) throw new Error("extension commits are unsupported by this memory backend");
    options.authorizeExtensionCommit(context);
  };
  const rows = new Map<string, DocumentRow>();
  const versionLog = new Map<string, VersionRow[]>();
  const summaries = new Map<string, SummaryRow>();
  const graves = new Map<string, { grave: GraveRow; versions: VersionRow[]; summary: SummaryRow | undefined }>();
  /** Every id ever deleted (spec behavior 10): never reused, even after its grave is purged. */
  const retired = new Set<string>();
  /** One list of part rows per piece key, across its whole life (live, buried, and restored). */
  const parts = new Map<string, PartRow[]>();
  const buriedKeys = new Set<string>();
  /** The global, content-addressed blob store (holistic 4.2), independent of any one piece. */
  const blobs = new Map<string, BlobPayload>();
  let changeSequence = 0;
  const changeLog: PieceChangeEvent[] = [];
  let changeStart = 0;
  const recordChange = (event: Omit<PieceChangeEvent, "sequence">): void => {
    const row = { ...event, sequence: ++changeSequence };
    if (changeLog.length < 4096) changeLog.push(row);
    else { changeLog[changeStart] = row; changeStart = (changeStart + 1) % 4096; }
  };

  const snapshotParts = (visible: readonly PartRow[]): PartRow[] => visible.map((p) => ({ ...p, blobKeys: [...p.blobKeys] }));
  const materializeParts = async (visible: readonly PartRow[]): Promise<PartText[]> => {
    const payloads = new Map<string, BlobPayload>();
    for (const p of visible) for (const k of p.blobKeys) {
      const payload = blobs.get(k);
      if (!payload) throw new Error("a part references a blob that no longer exists");
      payloads.set(k, payload);
    }
    const out: PartText[] = [];
    const breathe = breather();
    for (const p of visible) {
      out.push({ name: p.name, text: p.text, blobs: p.blobKeys.map((k) => ({ key: k, payload: payloads.get(k)! })) });
      await breathe();
    }
    return out;
  };

  /** Seals (here: just records) every blob `put`'s own parts reference, content-addressed: an
   * existing key is never overwritten, mirroring the SQLite backend's "an edit that leaves a piece's
   * art alone seals nothing new". */
  const ingestBlobs = (put: readonly PartText[]): void => {
    for (const p of put) for (const b of p.blobs) if (!blobs.has(b.key)) blobs.set(b.key, b.payload);
  };

  /** A reference-only blob (`PartText.refs`) must already be held; the whole write fails otherwise. */
  const requireHeld = (put: readonly PartText[]): void => {
    for (const p of put) for (const sha of p.refs ?? []) if (!blobs.has(sha)) throw new Error("a write references a blob that does not exist");
  };

  /** Deletes every blob among `candidateKeys` that NO part row, anywhere, still names in its
   * `blobKeys` - live or merely not yet pruned, across every piece, matching the SQLite backend's
   * `blob_refs`-is-the-truth rule. Only called right after rows that might have been the last
   * reference were actually removed. */
  const sweepOrphanBlobs = (candidateKeys: ReadonlySet<string>): void => {
    if (candidateKeys.size === 0) return;
    const stillReferenced = new Set<string>();
    for (const list of parts.values()) for (const p of list) for (const k of p.blobKeys) stillReferenced.add(k);
    for (const key of candidateKeys) if (!stillReferenced.has(key)) blobs.delete(key);
  };

  const applyChange = (key: string, newVersion: number, change: PartChange, replaceAll: boolean, replaceCurrentVersion = false): void => {
    const list = parts.get(key) ?? [];
    if ("restore" in change) {
      const n = change.restore;
      for (const p of list) {
        if (p.toVersion === null && p.fromVersion > n) p.toVersion = newVersion;
      }
      const revive = list.filter((p) => p.fromVersion <= n && p.toVersion !== null && p.toVersion > n);
      // Copying `blobKeys` is restore's own "no blob is opened or re-sealed to recreate its refs":
      // the revived row references exactly what the row it is reviving referenced.
      for (const p of revive) list.push({ name: p.name, text: p.text, fromVersion: newVersion, toVersion: null, blobKeys: p.blobKeys });
      parts.set(key, list);
      return;
    }
    const touched = replaceAll ? null : new Set([...change.put.map((p) => p.name), ...change.drop]);
    const removed: PartRow[] = [];
    const kept: PartRow[] = [];
    for (const p of list) {
      if (p.toVersion !== null || (!replaceAll && !touched!.has(p.name))) kept.push(p);
      else if (replaceCurrentVersion && p.fromVersion === newVersion) removed.push(p);
      else { p.toVersion = newVersion; kept.push(p); }
    }
    parts.set(key, kept);
    ingestBlobs(change.put);
    for (const p of change.put) kept.push({ name: p.name, text: p.text, fromVersion: newVersion, toVersion: null, blobKeys: [...p.blobs.map((b) => b.key), ...(p.refs ?? [])] });
    sweepOrphanBlobs(new Set(removed.flatMap((p) => p.blobKeys)));
  };

  return {
    ...memoryAssetReads(blobs),
    async get(kind, id) {
      const row = rows.get(keyOf(kind, id));
      return row ? { ...row } : null;
    },

    async summary(kind, id) {
      const row = rows.get(keyOf(kind, id));
      if (!row) return null;
      const s = summaries.get(keyOf(kind, id));
      return {
        version: row.version,
        writeId: row.writeId,
        row: { kind, id: row.id, liveRevision: row.revision, version: row.version, writeId: row.writeId, summary: s?.summary ?? null, revision: s?.revision ?? null, derivedVersion: s?.derivedVersion ?? null, updatedAt: s?.updatedAt ?? row.updatedAt },
      };
    },

    async pieceChanges(after, limit = 256) {
      const first = changeLog.length ? changeLog[changeStart]!.sequence : changeSequence + 1;
      const cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0;
      const gap = cursor > changeSequence || cursor < first - 1;
      return {
        latest: changeSequence,
        gap,
          events: gap ? [] : Array.from({ length: changeLog.length }, (_, offset) => changeLog[(changeStart + offset) % changeLog.length]!)
          .filter((event) => event.sequence > cursor).slice(0, Math.max(1, Math.min(512, Number.isSafeInteger(limit) ? limit : 256))).map((event) => ({ ...event })),
      };
    },

    async list(kind) {
      // Live rows are already-decoded objects, never sealed cells, so nothing here can fail to open:
      // quarantined is always empty (the SQLite backend is the one that can quarantine a row, rule 25).
      const found = [...rows.values()].filter((row) => kind === undefined || row.kind === kind).map((row) => ({ ...row }));
      return { rows: found, quarantined: [] };
    },

    async write(row, version, condition, summary = null, change) {
      authorizeExtensionCommit(condition.extensionCommit);
      const key = keyOf(row.kind, row.id);
      if (condition.when === "writeId" && row.writeId !== condition.expected + 1) return false;
      if (condition.when === "always" && buriedKeys.has(key)) return false;
      const current = rows.get(key);
      if (!conditionHolds(current, retired.has(key), condition)) return false;
      if (condition.when === "writeId" && condition.valid && !condition.valid()) return false;
      const coalesce = condition.when === "writeId" && version.reason === "autosave" && current !== undefined && current.version === row.version &&
        current.autosaveStartedAt !== null && current.autosaveStartedAt === row.autosaveStartedAt;
      if (!("restore" in change)) requireHeld(change.put); // before any mutation: a refused write leaves nothing behind
      rows.set(key, { ...row });
      versionLog.set(key, [...(versionLog.get(key) ?? []).filter((v) => v.version !== version.version), { ...version }]);
      applyChange(key, row.version, change, condition.when === "always", coalesce);
      // Same synchronous step as the row: a summary can never be missing or stale relative to its row.
      summaries.set(key, {
        kind: row.kind,
        id: row.id,
        liveRevision: row.revision,
        version: row.version,
        writeId: row.writeId,
        summary: summary?.text ?? null,
        revision: summary ? row.revision : null,
        derivedVersion: summary?.derivedVersion ?? null,
        updatedAt: row.updatedAt,
      });
      recordChange({ kind: row.kind, id: row.id, revision: row.revision, version: row.version, writeId: row.writeId, action: "upsert" });
      return true;
    },

    async parts(kind, id, at) {
      const key = keyOf(kind, id);
      const list = parts.get(key) ?? [];
      if (at === undefined) {
        // Bury moves no part rows, so a buried key's rows can still read toVersion === null. "Live"
        // means the row exists, not merely that some part happens to be open-ended.
        if (!rows.has(key)) return null;
        return materializeParts(snapshotParts(list.filter((p) => p.toVersion === null)));
      }
      return materializeParts(snapshotParts(list.filter((p) => p.fromVersion <= at && (p.toVersion === null || p.toVersion > at))));
    },

    async liveParts(kind, id): Promise<LivePartSnapshot | null> {
      const key = keyOf(kind, id);
      const row = rows.get(key);
      if (!row) return null;
      const snapshot = snapshotParts((parts.get(key) ?? []).filter((p) => p.toVersion === null));
      return { writeId: row.writeId, parts: await materializeParts(snapshot) };
    },

    async livePartsBounded(kind, id, expectedWriteId, maxCharge) {
      const key = keyOf(kind, id);
      const row = rows.get(key);
      if (!row) return { status: "missing" };
      if (row.writeId !== expectedWriteId) return { status: "stale" };
      const list = parts.get(key) ?? [];
      let count = 0, refs = 0, bytes = 0;
      for (const part of list) if (part.toVersion === null) {
        count++;
        bytes += utf8ByteLength(part.text);
        refs += part.blobKeys.length;
        for (const blobKey of part.blobKeys) {
          const payload = blobs.get(blobKey);
          if (!payload) throw new Error("a part references a blob that no longer exists");
          bytes += payload.kind === "bytes" ? payload.bytes.byteLength : utf8ByteLength(payload.text);
        }
        if (coldReadCharge(bytes, count, refs) > maxCharge) return { status: "too-large" };
      }
      const snapshot = snapshotParts(list.filter((part) => part.toVersion === null));
      const payloads = new Map<string, BlobPayload>();
      for (const part of snapshot) for (const blobKey of part.blobKeys) payloads.set(blobKey, blobs.get(blobKey)!);
      const result = snapshot.map((part): PartText => ({ name: part.name, text: part.text, blobs: part.blobKeys.map((blobKey) => ({ key: blobKey, payload: payloads.get(blobKey)! })) }));
      return { writeId: row.writeId, parts: result };
    },

    async livePartBounds(kind, id): Promise<LivePartBounds | null> {
      const key = keyOf(kind, id);
      const row = rows.get(key);
      if (!row) return null;
      const visible = (parts.get(key) ?? []).filter((p) => p.toVersion === null);
      let refs = 0;
      let bytes = 0;
      for (const part of visible) {
        bytes += utf8ByteLength(part.text);
        for (const blobKey of part.blobKeys) {
          refs++;
          const payload = blobs.get(blobKey);
          if (!payload) throw new Error("a part references a blob that no longer exists");
          bytes += payload.kind === "bytes" ? payload.bytes.byteLength : utf8ByteLength(payload.text);
        }
      }
      return { writeId: row.writeId, parts: visible.length, refs, bytes };
    },

    async lightHead(kind, id, at) {
      const key = keyOf(kind, id);
      const part = (parts.get(key) ?? []).find((p) => p.fromVersion <= at && (p.toVersion === null || p.toVersion > at) && p.name === "h");
      return part ? { name: part.name, text: part.text } : null;
    },

    async lightParts(kind, id, at, excludeNames) {
      const key = keyOf(kind, id);
      const excluded = new Set(excludeNames);
      const visible = (parts.get(key) ?? []).filter((p) => p.fromVersion <= at && (p.toVersion === null || p.toVersion > at) && !excluded.has(p.name));
      if (!visible.length) return null;
      const out: { name: string; text: string }[] = [];
      const breathe = breather();
      for (const p of snapshotParts(visible)) {
        out.push({ name: p.name, text: p.text });
        await breathe();
      }
      return out;
    },

    async lightPartBounded(kind, id, name, at, maxBytes) {
      const p = (parts.get(keyOf(kind, id)) ?? []).find((part) => part.name === name && part.fromVersion <= at && (part.toVersion === null || part.toVersion > at));
      if (!p) return { status: "missing" };
      return utf8ByteLength(p.text) > maxBytes ? { status: "too-large" } : { status: "ok", text: p.text };
    },

    async lightBlobs(kind, id, name, at, expectedHashes, selectedHashes) {
      const key = keyOf(kind, id);
      const p = (parts.get(key) ?? []).find((part) => part.name === name && part.fromVersion <= at && (part.toVersion === null || part.toVersion > at));
      if (!p) throw new Error("light part disappeared while opening its text blobs");
      const expected = new Set(expectedHashes);
      if (expected.size !== p.blobKeys.length || p.blobKeys.some((hash) => !expected.has(hash)) || [...expected].some((hash) => !blobs.has(hash))) throw new Error("light part has corrupt blob-reference topology");
      const wanted = new Set(selectedHashes);
      if ([...wanted].some((hash) => !expected.has(hash))) throw new Error("light projection selected an unexpected blob");
      const selected = p.blobKeys.filter((hash) => wanted.has(hash)).map((hash) => ({ key: hash, payload: blobs.get(hash) }));
      if (selected.length !== wanted.size || selected.some((b) => !b.payload)) throw new Error("light text sentinel has no matching part blob");
      const out: PartText["blobs"][number][] = [];
      const breathe = breather();
      for (const blob of selected) {
        out.push({ key: blob.key, payload: blob.payload! });
        await breathe();
      }
      return out;
    },

    async part(kind, id, name, at) {
      const key = keyOf(kind, id);
      const p = (parts.get(key) ?? []).find((part) => part.name === name && part.fromVersion <= at && (part.toVersion === null || part.toVersion > at));
      return p ? (await materializeParts(snapshotParts([p])))[0] ?? null : null;
    },

    async bury(kind, id, graveId, deletedAt, capture, expectedRevision, extensionCommit) {
      authorizeExtensionCommit(extensionCommit);
      const key = keyOf(kind, id);
      const row = rows.get(key);
      if (!row || graves.has(graveId)) return false;
      if (expectedRevision !== undefined && row.revision !== expectedRevision) return false;
      graves.set(graveId, { grave: { ...row, writeId: row.writeId + 1, autosaveStartedAt: null, graveId, deletedAt }, versions: versionLog.get(key) ?? [], summary: summaries.get(key) });
      rows.delete(key);
      versionLog.delete(key);
      summaries.delete(key);
      retired.add(key);
      buriedKeys.add(key);
      const receipt = { kind: row.kind, id: row.id, revision: row.revision, version: row.version, writeId: row.writeId + 1, action: "delete" as const };
      recordChange(receipt);
      capture?.(receipt);
      return true;
    },

    async graves(kind) {
      // Never sealed here either: quarantined is always empty (rule 25's SQLite-only exposure).
      const found = [...graves.values()].filter((g) => kind === undefined || g.grave.kind === kind).map((g) => ({ ...g.grave }));
      return { rows: found, quarantined: [] };
    },

    async grave(graveId) {
      const found = graves.get(graveId);
      return found ? { ...found.grave } : null;
    },

    async unbury(graveId, extensionCommit) {
      authorizeExtensionCommit(extensionCommit);
      const found = graves.get(graveId);
      if (!found) return false;
      const { graveId: _grave, deletedAt: _at, ...own } = found.grave;
      const key = keyOf(own.kind, own.id);
      if (rows.has(key)) return false;
      rows.set(key, { ...own, writeId: own.writeId + 1, autosaveStartedAt: null });
      versionLog.set(key, found.versions.map((v) => ({ ...v })));
      if (found.summary) summaries.set(key, { ...found.summary });
      graves.delete(graveId);
      buriedKeys.delete(key);
      recordChange({ kind: own.kind, id: own.id, revision: own.revision, version: own.version, writeId: own.writeId + 1, action: "upsert" });
      return true;
    },

    async isRetired(kind, id) {
      return retired.has(keyOf(kind, id));
    },

    async versions(kind, id) {
      // Never sealed here either: quarantined is always empty (rule 25's SQLite-only exposure).
      return { rows: (versionLog.get(keyOf(kind, id)) ?? []).map((v) => ({ ...v })), quarantined: [] };
    },

    async summaries(kind) {
      // Driven from `rows` (documents), not from the `summaries` map alone: a live document with no
      // summary entry at all must still be returned (spec rule 6, review finding 2026-09-30), reading
      // exactly like an uncomputed placeholder. Every real write here always sets a summary entry
      // (even a null one), so this only matters for a row a repair tool planted without one - the
      // same gap `summaryGaps()` names. quarantined is always empty (rule 25's SQLite-only exposure).
      const found = [...rows.values()]
        .filter((row) => kind === undefined || row.kind === kind)
        .map((row): SummaryRow => {
          const s = summaries.get(keyOf(row.kind, row.id));
          // s?.updatedAt, not row.updatedAt: the summary's own timestamp moves independently of the
          // row's (rewriteSummary updates only its own), falling back to the row's only when there is
          // no summary entry at all.
          return { kind: row.kind, id: row.id, liveRevision: row.revision, version: row.version, writeId: row.writeId, summary: s?.summary ?? null, revision: s?.revision ?? null, derivedVersion: s?.derivedVersion ?? null, updatedAt: s?.updatedAt ?? row.updatedAt };
        });
      return { rows: found, quarantined: [] };
    },

    async documentVersions(kind) {
      const found = [...rows.values()]
        .filter((row) => kind === undefined || row.kind === kind)
        .map((row): DocumentVersionRow => ({ kind: row.kind, id: row.id, version: row.version, writeId: row.writeId }));
      return { rows: found, quarantined: [] };
    },

    async summaryGaps() {
      return [...rows.values()]
        .filter((row) => !summaries.has(keyOf(row.kind, row.id)))
        .map((row) => ({ kind: row.kind, id: row.id }));
    },

    async graveSummaries(kind) {
      // Never sealed here either: quarantined is always empty (rule 25's SQLite-only exposure).
      const found = [...graves.entries()]
        .filter(([, g]) => kind === undefined || g.grave.kind === kind)
        .map(([graveId, g]): GraveSummaryRow => ({
          graveId,
          kind: g.grave.kind,
          id: g.grave.id,
          summary: g.summary?.summary ?? null,
          revision: g.summary?.revision ?? null,
          derivedVersion: g.summary?.derivedVersion ?? null,
          deletedAt: g.grave.deletedAt,
        }));
      return { rows: found, quarantined: [] };
    },

    async counts() {
      const stillReferenced = new Set<string>();
      for (const list of parts.values()) for (const p of list) for (const k of p.blobKeys) stillReferenced.add(k);
      const orphanBlobs = [...blobs.keys()].filter((k) => !stillReferenced.has(k)).length;
      return { documents: rows.size, summaries: summaries.size, blobs: blobs.size, orphanBlobs };
    },

    async rewriteSummary(kind, id, expectedWriteId, summary, updatedAt) {
      const key = keyOf(kind, id);
      const row = rows.get(key);
      if (!row || row.writeId !== expectedWriteId) return false;
      summaries.set(key, { kind, id, liveRevision: row.revision, version: row.version, writeId: row.writeId, summary: summary.text, revision: row.revision, derivedVersion: summary.derivedVersion, updatedAt });
      return true;
    },

    async pruneVersions(kind, id, keep) {
      const key = keyOf(kind, id);
      const log = versionLog.get(key);
      if (!log) return 0;
      const live = rows.get(key)?.version;
      const newest = new Set([...log].sort((a, b) => b.version - a.version).slice(0, keep).map((v) => v.version));
      const kept = log.filter((v) => newest.has(v.version) || v.version === live);
      versionLog.set(key, kept);
      // Whatever no kept version can see any more is an orphan: closed at or before the oldest
      // version left standing.
      const oldestKept = kept.length > 0 ? Math.min(...kept.map((v) => v.version)) : undefined;
      if (oldestKept !== undefined) {
        const list = parts.get(key);
        if (list) {
          const dropped = list.filter((p) => !(p.toVersion === null || p.toVersion > oldestKept));
          parts.set(key, list.filter((p) => p.toVersion === null || p.toVersion > oldestKept));
          sweepOrphanBlobs(new Set(dropped.flatMap((p) => p.blobKeys)));
        }
      }
      return log.length - kept.length;
    },

    async purgeBefore(cutoff) {
      let removed = 0;
      const candidateKeys = new Set<string>();
      for (const [graveId, { grave }] of graves) {
        if (grave.deletedAt < cutoff) {
          graves.delete(graveId);
          const graveKey = keyOf(grave.kind, grave.id);
          for (const p of parts.get(graveKey) ?? []) for (const k of p.blobKeys) candidateKeys.add(k);
          parts.delete(graveKey);
          removed += 1;
        }
      }
      sweepOrphanBlobs(candidateKeys);
      return removed;
    },
  };
}
