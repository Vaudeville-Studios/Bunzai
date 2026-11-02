/**
 * The ContentStore contract suite against the SQLite backend, unchanged, plus what the suite cannot
 * see: that each backend method is one transaction, and SQLite-only proof of the part-storage
 * guarantees Appendix A section 4 makes: a cell
 * swapped between two pieces is caught, a fault mid-write leaves no part rows either, restoring a
 * version copies cells in SQL without sealing, and the database itself refuses a second live row for
 * one part name.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decompose } from "../../entities/piece-parts";
import { encodeBlobs, lightBlobRefs, sentinelBlobRefs } from "../../entities/piece-parts-blob";
import { parseCanonicalEntity } from "../../entities/runtime-schema";
import { cellCipher } from "../crypto/cell-cipher";
import { DamagedDataError, newDataKey, subkeys } from "../crypto/crypto";
import { LockedError } from "../crypto/keyring-errors";
import { contentStoreContract } from "../contracts/content-store.contract";
import { character, presetWithEscrow } from "../contracts/content-store.contract-fixtures";
import type { DocumentRow, PartBlob, PartChange, VersionRow } from "../contracts/content-store";
import { createContentStore } from "./content-store";
import { buildPartText } from "./content-store-write";
import { openStageDatabase, type StageDatabase } from "./sqlite/database";
import { sqliteDocumentBackend } from "./sqlite/document-backend";
import { MIGRATIONS } from "./sqlite/migrations";
import { freshDatabase, testCipher } from "./sqlite/test-support";

const open: StageDatabase[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.close();
});
const fresh = () => freshDatabase(open);

contentStoreContract("sqlite backend", () => sqliteDocumentBackend(fresh(), testCipher()));

// The same suite against real files: WAL mode, fsync, and close only exist on a file.
const dirs: string[] = [];
let migratedSchema: Uint8Array | undefined;
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const onDisk = () => {
  const dir = mkdtempSync(join(tmpdir(), "bunzai-content-"));
  dirs.push(dir);
  const path = join(dir, "bunzai.db");
  if (!migratedSchema) {
    const schema = openStageDatabase(":memory:", MIGRATIONS);
    try { migratedSchema = schema.db.serialize(); }
    finally { schema.close(); }
  }
  writeFileSync(path, migratedSchema);
  const d = openStageDatabase(path, MIGRATIONS);
  open.push(d);
  return d;
};

contentStoreContract("sqlite backend on disk", () => sqliteDocumentBackend(onDisk(), testCipher()));

const row = (extra: Partial<DocumentRow> = {}): DocumentRow => ({
  kind: "character",
  id: "vera",
  revision: "r1",
  version: 1,
  writeId: extra.version ?? 1,
  autosaveStartedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});
const ver = (extra: Partial<VersionRow> = {}): VersionRow => ({
  kind: "character",
  id: "vera",
  version: 1,
  revision: "r1",
  savedAt: 1,
  reason: "create",
  autosaveStartedAt: null,
  ...extra,
});
/** Most of this file is about row/version mechanics, never part content: one trivial "h" part is
 * enough to make a row a legal live document. */
const onePart: PartChange = { put: [{ name: "h", text: "0:", blobs: [] }], drop: [] };
/** A real, readable part set for `character(id)`, for the tests below that DO care what a piece
 * assembles to (the swap and the restore-seals-nothing tests). */
const partsFor = (id: string): PartChange => ({ put: decompose(parseCanonicalEntity(character(id))).map(buildPartText), drop: [] });

test("SQLite light blob reads validate mixed refs separately from the selected subset", async () => {
  const d = fresh();
  const cipher = testCipher();
  const backend = sqliteDocumentBackend(d, cipher);
  const payloads = new Map<string, PartBlob>();
  const encoded = encodeBlobs({
    kind: "character", id: "vera", custom: "A".repeat(18_000),
    body: { presentation: { background: { ref: "B".repeat(18_000) } } },
  }, true, payloads, "character");
  const part = { name: "h", text: JSON.stringify(encoded), blobs: [...payloads.values()] };
  expect(await backend.write(row(), ver(), { when: "absent" }, null, { put: [part], drop: [] })).toBe(true);
  const expected = sentinelBlobRefs(encoded);
  const selected = lightBlobRefs(encoded, "character").textBlobs;
  expect(expected).toHaveLength(2);
  expect(selected).toHaveLength(1);
  expect(await backend.lightBlobs("character", "vera", "h", 1, expected, selected)).toHaveLength(1);
  expect(await backend.lightBlobs("character", "vera", "h", 1, expected, [])).toEqual([]);
  const doc = cipher.index("character\u0000vera");
  const partKey = cipher.index(`character\u0000${doc}\u0000h`);
  const stored = d.db.query("SELECT id FROM piece_parts WHERE kind = ? AND doc = ? AND part = ?").get("character", doc, partKey) as { id: number };
  d.db.query("DELETE FROM blob_refs WHERE part_id = ?").run(stored.id);
  await expect(backend.lightBlobs("character", "vera", "h", 1, expected, [])).rejects.toBeInstanceOf(DamagedDataError);
});

describe("SQLite backend: each method is one transaction", () => {
  test("a write whose version row fails leaves the document as it was", async () => {
    const d = fresh();
    const backend = sqliteDocumentBackend(d, testCipher());
    expect(await backend.write(row(), ver(), { when: "absent" }, null, onePart)).toBe(true);
    d.db.run(
      "CREATE TRIGGER boom BEFORE INSERT ON document_versions WHEN NEW.version = 2 BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    await expect(
      backend.write(row({ revision: "boom", version: 2 }), ver({ version: 2, revision: "boom" }), { when: "writeId", expected: 1 }, null, onePart),
    ).rejects.toThrow("boom");
    expect(await backend.get("character", "vera")).toEqual(row());
    expect((await backend.versions("character", "vera")).rows.map((v) => v.version)).toEqual([1]);
    expect(d.db.inTransaction).toBe(false);
  });

  test("a fault after the part insert leaves no part rows for the failed write", async () => {
    const d = fresh();
    const backend = sqliteDocumentBackend(d, testCipher());
    expect(await backend.write(row(), ver(), { when: "absent" }, null, onePart)).toBe(true);
    d.db.run(
      "CREATE TRIGGER boom BEFORE INSERT ON document_versions WHEN NEW.version = 2 BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const before = (d.db.query("SELECT count(*) AS n FROM piece_parts").get() as { n: number }).n;
    await expect(
      backend.write(
        row({ revision: "boom", version: 2 }),
        ver({ version: 2, revision: "boom" }),
        { when: "writeId", expected: 1 },
        null,
        { put: [{ name: "h", text: "1:x", blobs: [] }], drop: [] },
      ),
    ).rejects.toThrow("boom");
    // The part insert ran (it comes before the version insert that failed) but rolled back with it:
    // no orphan "1:x" row, and the original part is exactly as it was.
    expect((d.db.query("SELECT count(*) AS n FROM piece_parts").get() as { n: number }).n).toBe(before);
  });

  test("a purge that fails partway removes nothing", async () => {
    const d = fresh();
    const backend = sqliteDocumentBackend(d, testCipher());
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    await backend.bury("character", "vera", "g1", 10);
    d.db.run("CREATE TRIGGER boom BEFORE DELETE ON document_graves BEGIN SELECT RAISE(ABORT, 'boom'); END");
    await expect(backend.purgeBefore(100)).rejects.toThrow("boom");
    expect((await backend.grave("g1"))?.deletedAt).toBe(10);
    expect((d.db.query("SELECT count(*) AS n FROM grave_versions").get() as { n: number }).n).toBe(1);
  });

  test("a bury that fails partway leaves the row live with its versions", async () => {
    const d = fresh();
    const backend = sqliteDocumentBackend(d, testCipher());
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    d.db.run("CREATE TRIGGER boom BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT, 'boom'); END");
    await expect(backend.bury("character", "vera", "g1", 10)).rejects.toThrow("boom");
    expect(await backend.get("character", "vera")).toEqual(row());
    expect((await backend.versions("character", "vera")).rows).toHaveLength(1);
    expect(await backend.graves()).toEqual({ rows: [], quarantined: [] });
  });

  test("an unbury that fails partway leaves the grave whole and nothing live", async () => {
    const d = fresh();
    const backend = sqliteDocumentBackend(d, testCipher());
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    await backend.bury("character", "vera", "g1", 10);
    d.db.run("CREATE TRIGGER boom BEFORE DELETE ON document_graves BEGIN SELECT RAISE(ABORT, 'boom'); END");
    await expect(backend.unbury("g1")).rejects.toThrow("boom");
    expect(await backend.get("character", "vera")).toBeNull();
    expect((await backend.grave("g1"))?.id).toBe("vera");
  });

  test("purge counts documents, not the versions removed with them", async () => {
    const backend = sqliteDocumentBackend(fresh(), testCipher());
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    await backend.write(row({ version: 2, revision: "r2" }), ver({ version: 2, revision: "r2", reason: "save" }), { when: "writeId", expected: 1 }, null, onePart);
    await backend.bury("character", "vera", "g1", 10);
    expect(await backend.purgeBefore(100)).toBe(1);
    expect(await backend.grave("g1")).toBeNull();
  });

  test("bury moves a live row into a grave and retires its id; unbury brings it home", async () => {
    const backend = sqliteDocumentBackend(fresh(), testCipher());
    expect(await backend.unbury("g1")).toBe(false);
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    expect(await backend.isRetired("character", "vera")).toBe(false);
    expect(await backend.bury("character", "vera", "g1", 10)).toBe(true);
    expect(await backend.bury("character", "vera", "g2", 20)).toBe(false);
    expect(await backend.get("character", "vera")).toBeNull();
    expect((await backend.grave("g1"))?.deletedAt).toBe(10);
    expect(await backend.isRetired("character", "VERA")).toBe(true);
    // A retired id is never absent again: nothing new can take it.
    expect(await backend.write(row(), ver(), { when: "absent" }, null, onePart)).toBe(false);
    expect(await backend.unbury("g1")).toBe(true);
    expect((await backend.get("character", "vera"))?.revision).toBe("r1");
    expect(await backend.grave("g1")).toBeNull();
  });

  test("the purge removes the grave but the id stays retired", async () => {
    const d = fresh();
    const backend = sqliteDocumentBackend(d, testCipher());
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    await backend.bury("character", "vera", "g1", 10);
    expect(await backend.purgeBefore(100)).toBe(1);
    expect(await backend.isRetired("character", "vera")).toBe(true);
    expect(await backend.write(row(), ver(), { when: "absent" }, null, onePart)).toBe(false);
    // Only the keyed hash is kept: no name is readable on disk.
    const kept = d.db.query("SELECT kind, id FROM retired_ids").all() as { kind: string; id: string }[];
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).not.toContain("vera");
  });

  test("ids are keyed spelling-insensitively: Vera and vera are one row", async () => {
    const backend = sqliteDocumentBackend(fresh(), testCipher());
    expect(await backend.write(row({ id: "Vera" }), ver({ id: "Vera" }), { when: "absent" }, null, onePart)).toBe(true);
    expect(await backend.write(row({ id: "vera" }), ver({ id: "vera" }), { when: "absent" }, null, onePart)).toBe(false);
    expect((await backend.get("character", "VERA"))?.id).toBe("Vera");
  });

  test("purge spares a row deleted exactly at the cutoff", async () => {
    const backend = sqliteDocumentBackend(fresh(), testCipher());
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    await backend.bury("character", "vera", "g1", 100);
    expect(await backend.purgeBefore(100)).toBe(0);
    expect(await backend.purgeBefore(101)).toBe(1);
  });

  test("an id moved to another row is quarantined on read, by comparing it with the row's hash (ChatStore rule 25)", async () => {
    const d = fresh();
    const cipher = testCipher();
    const backend = sqliteDocumentBackend(d, cipher);
    await backend.write(row({ id: "vera" }), ver({ id: "vera" }), { when: "absent" }, null, onePart);
    await backend.write(row({ id: "mira" }), ver({ id: "mira" }), { when: "absent" }, null, onePart);
    // `id` is a keyed hash, so "ORDER BY id" says nothing about which row is which name: read the
    // first row's real id back BEFORE corrupting it, rather than assuming an alphabetical pairing.
    const cells = d.db.query("SELECT id, id_cell FROM documents ORDER BY id").all() as { id: string; id_cell: string }[];
    const corruptedRowsRealId = cipher.open("documents.id_cell", cells[0]!.id_cell);
    // Only the first row's cell is overwritten: it now opens to the SECOND row's real id, which does
    // not hash back to its own stored key, so only this one row is quarantined - the other stays healthy.
    d.db.query("UPDATE documents SET id_cell = ? WHERE id = ?").run(cells[1]!.id_cell, cells[0]!.id);
    const { rows, quarantined } = await backend.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(corruptedRowsRealId);
    expect(quarantined).toEqual([{ kind: "character", key: cells[0]!.id }]);
  });

  test("a damaged row never hides the rest of a page, and locking still refuses the whole call", async () => {
    const d = fresh();
    let locked = false;
    const inner = testCipher();
    const cipher = { ...inner, open: (where: string, cell: string) => { if (locked) throw new LockedError(); return inner.open(where, cell); } };
    const backend = sqliteDocumentBackend(d, cipher);
    await backend.write(row({ id: "vera" }), ver({ id: "vera" }), { when: "absent" }, null, onePart);
    await backend.write(row({ id: "mira" }), ver({ id: "mira" }), { when: "absent" }, null, onePart);
    const cells = d.db.query("SELECT id, id_cell FROM documents ORDER BY id").all() as { id: string; id_cell: string }[];
    d.db.query("UPDATE documents SET id_cell = ? WHERE id = ?").run(cells[1]!.id_cell, cells[0]!.id);

    // The mutation check: an over-broad catch (e.g. `catch {}` with no instanceof guard) would also
    // swallow LockedError and quarantine it instead of refusing the whole call. It must not.
    locked = true;
    await expect(backend.list()).rejects.toBeInstanceOf(LockedError);
    locked = false;

    const { rows, quarantined } = await backend.list();
    expect(rows).toHaveLength(1);
    expect(quarantined).toHaveLength(1);
  });

  test("a failed condition writes no version either", async () => {
    const backend = sqliteDocumentBackend(fresh(), testCipher());
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    expect(await backend.write(row({ version: 2, writeId: 6 }), ver({ version: 2 }), { when: "writeId", expected: 5 }, null, onePart)).toBe(false);
    expect(await backend.write(row(), ver({ version: 9 }), { when: "absent" }, null, onePart)).toBe(false);
    expect((await backend.versions("character", "vera")).rows.map((v) => v.version)).toEqual([1]);
  });
});

describe("SQLite backend: part storage (Appendix A section 4; S4a)", () => {
  test("a part cell swapped between two pieces throws DamagedDataError on read", async () => {
    const d = fresh();
    const cipher = testCipher();
    const backend = sqliteDocumentBackend(d, cipher);
    await backend.write({ kind: "character", id: "vera", revision: "r1", version: 1, writeId: 1, autosaveStartedAt: null, createdAt: 1, updatedAt: 1 }, ver({ id: "vera" }), { when: "absent" }, null, partsFor("vera"));
    await backend.write({ kind: "character", id: "mira", revision: "r1", version: 1, writeId: 1, autosaveStartedAt: null, createdAt: 1, updatedAt: 1 }, ver({ id: "mira" }), { when: "absent" }, null, partsFor("mira"));

    // Swap the two pieces' "h" cells: same part NAME on both sides, so only a per-piece identity
    // check (not merely re-deriving the name) can catch it (encryption rule 12: AAD binds table and
    // column, not row, so the swapped cell still opens).
    const veraDoc = cipher.index("character\u0000vera");
    const miraDoc = cipher.index("character\u0000mira");
    const cells = d.db
      .query("SELECT doc, cell FROM piece_parts WHERE doc IN (?, ?) AND to_version IS NULL")
      .all(veraDoc, miraDoc) as { doc: string; cell: string }[];
    const veraCell = cells.find((c) => c.doc === veraDoc)!;
    const miraCell = cells.find((c) => c.doc === miraDoc)!;
    d.db.query("UPDATE piece_parts SET cell = ? WHERE doc = ? AND to_version IS NULL").run(miraCell.cell, veraDoc);
    d.db.query("UPDATE piece_parts SET cell = ? WHERE doc = ? AND to_version IS NULL").run(veraCell.cell, miraDoc);

    await expect(backend.parts("character", "vera")).rejects.toBeInstanceOf(DamagedDataError);
    await expect(backend.parts("character", "mira")).rejects.toBeInstanceOf(DamagedDataError);
  });

  test("an edit that leaves the escrow alone seals no r/ cell (counted at the cipher)", async () => {
    const inner = testCipher();
    // A sealed part cell's plaintext is `<64-char doc key><name byte length>:<name><wire text>`
    // (piece-parts-sql.ts's encodeCell): the name is recovered the same way the backend itself does.
    const partName = (plaintext: string): string => {
      const afterDocKey = plaintext.slice(64);
      const colon = afterDocKey.indexOf(":");
      const nameLen = Number(afterDocKey.slice(0, colon));
      return afterDocKey.slice(colon + 1, colon + 1 + nameLen);
    };
    let sealedPartNames: string[] = [];
    const spying = {
      ...inner,
      seal: (where: string, text: string) => {
        if (where === "piece_parts.cell") sealedPartNames.push(partName(text));
        return inner.seal(where, text);
      },
    };
    const backend = sqliteDocumentBackend(fresh(), spying);
    const store = createContentStore(backend, () => 1);
    await store.save(presetWithEscrow("p"));
    sealedPartNames = [];

    await store.save(presetWithEscrow("p", "changed"), { overwrite: true });

    // Exactly one part sealed - the edited block - and it is never the escrow part.
    expect(sealedPartNames).toEqual(["i/a"]);
  });

  test("the database refuses a second live row for one part name", async () => {
    const d = fresh();
    const cipher = testCipher();
    const backend = sqliteDocumentBackend(d, cipher);
    await backend.write(row(), ver(), { when: "absent" }, null, onePart);
    const docKey = cipher.index("character\u0000vera");
    const partKey = cipher.index(`character\u0000${docKey}\u0000h`);
    // from_version = 2, not 1: this must NOT collide with `piece_parts_key`'s
    // (kind, doc, part, from_version) uniqueness, so only the newer partial index -
    // (kind, doc, part) WHERE to_version IS NULL - is what catches a second live row.
    expect(() =>
      d.db
        .query("INSERT INTO piece_parts (kind, doc, part, from_version, to_version, cell) VALUES (?, ?, ?, ?, NULL, ?)")
        .run("character", docKey, partKey, 2, cipher.seal("piece_parts.cell", `${docKey}1:hx`)),
    ).toThrow();
  });

  test("restoreVersion copies cells in SQL: byte-identical, and seals no piece_parts cell", async () => {
    const inner = testCipher();
    let partSeals = 0;
    const spying = { ...inner, seal: (where: string, text: string) => (where === "piece_parts.cell" ? (partSeals++, inner.seal(where, text)) : inner.seal(where, text)) };
    const backend = sqliteDocumentBackend(fresh(), spying);
    const store = createContentStore(backend, () => 1);
    await store.save(character("vera", "Original"));
    await store.save(character("vera", "Mistake"), { overwrite: true });
    const original = await store.readVersion("character", "vera", 1);
    partSeals = 0; // only the restore itself is measured

    const restored = await store.restoreVersion("character", "vera", 1);

    expect(restored).toMatchObject({ name: "Original", version: 3 });
    expect(partSeals).toBe(0); // the backend copied the version-1 cells in SQL, never re-sealed them
    const after = await store.read("character", "vera");
    expect(original).not.toBeNull();
    expect(after?.entity).toEqual(original!);
  });

  test("a one-block edit closes exactly one row and leaves every other part untouched", async () => {
    const d = fresh();
    const backend = sqliteDocumentBackend(d, testCipher());
    const store = createContentStore(backend, () => 1);
    await store.save(presetWithEscrow("p"));
    const rowCount = () => (d.db.query("SELECT count(*) AS n FROM piece_parts").get() as { n: number }).n;
    const before = rowCount(); // h, o, i/a, i/b, r/testfmt: 5 live rows
    expect(before).toBe(5);

    await store.save(presetWithEscrow("p", "changed"), { overwrite: true });

    // i/a gained a second (closed) row; everything else is exactly as it was.
    expect(rowCount()).toBe(before + 1);
    const live = (d.db.query("SELECT count(*) AS n FROM piece_parts WHERE to_version IS NULL").get() as { n: number }).n;
    expect(live).toBe(before); // still 5 live rows: one closed, one new, net unchanged
    const closed = (d.db.query("SELECT count(*) AS n FROM piece_parts WHERE to_version IS NOT NULL").get() as { n: number }).n;
    expect(closed).toBe(1);
  });

  test("prune leaves zero orphan parts: only rows a kept version can still see", async () => {
    const d = fresh();
    const backend = sqliteDocumentBackend(d, testCipher());
    const store = createContentStore(backend, () => 1);
    await store.save(presetWithEscrow("p", "v0"));
    for (let n = 1; n <= 30; n++) await store.save(presetWithEscrow("p", `v${n}`), { overwrite: true });

    const kept = (await store.versions("preset", "p")).versions.map((v) => v.version);
    expect(kept).toHaveLength(25);
    const oldestKept = Math.min(...kept);

    const orphans = (
      d.db.query("SELECT count(*) AS n FROM piece_parts WHERE to_version IS NOT NULL AND to_version <= ?").get(oldestKept) as { n: number }
    ).n;
    expect(orphans).toBe(0);
  });

  test("purge leaves zero parts for the purged key", async () => {
    const d = fresh();
    const cipher = testCipher();
    const backend = sqliteDocumentBackend(d, cipher);
    const store = createContentStore(backend, () => 1);
    await store.save(presetWithEscrow("p"));
    const docKey = cipher.index("preset\u0000p");
    expect((d.db.query("SELECT count(*) AS n FROM piece_parts WHERE doc = ?").get(docKey) as { n: number }).n).toBe(5);

    await store.delete("preset", "p");
    expect(await store.purge(Number.MAX_SAFE_INTEGER)).toBe(1);

    expect((d.db.query("SELECT count(*) AS n FROM piece_parts WHERE doc = ?").get(docKey) as { n: number }).n).toBe(0);
  });

  test("bury and unbury move no part rows", async () => {
    const d = fresh();
    const cipher = testCipher();
    const backend = sqliteDocumentBackend(d, cipher);
    const store = createContentStore(backend, () => 1);
    await store.save(presetWithEscrow("p"));
    const docKey = cipher.index("preset\u0000p");
    const partsSnapshot = () =>
      (d.db.query("SELECT part, from_version, to_version, cell FROM piece_parts WHERE doc = ? ORDER BY part, from_version").all(docKey) as unknown[]);
    const before = JSON.stringify(partsSnapshot());

    await store.delete("preset", "p");
    expect(JSON.stringify(partsSnapshot())).toBe(before); // bury moved no part rows
    const [grave] = await store.graveyard();
    await store.restore(grave!.graveId);
    expect(JSON.stringify(partsSnapshot())).toBe(before); // unbury moved none either
  });
});

describe("SQLite backend: listing a large library in pages", () => {
  test("every row is listed exactly once across page boundaries, in id order, with or without a kind", async () => {
    const backend = sqliteDocumentBackend(fresh(), testCipher());
    const ids = Array.from({ length: 620 }, (_, i) => `card-${String(i).padStart(4, "0")}`);
    for (const id of ids) {
      const kind = Number(id.slice(5)) % 3 === 0 ? "lorebook" : "character";
      await backend.write(row({ kind, id }), ver({ kind, id }), { when: "absent" }, null, onePart);
    }
    const { rows: all, quarantined } = await backend.list(undefined);
    expect(quarantined).toEqual([]);
    expect(all).toHaveLength(620);
    expect(new Set(all.map((r) => `${r.kind}/${r.id}`)).size).toBe(620);
    expect(all.map((r) => r.kind)).toEqual([...all.map((r) => r.kind)].sort());
    const characters = (await backend.list("character")).rows;
    expect(characters.map((r) => r.id)).toEqual(ids.filter((id) => Number(id.slice(5)) % 3 !== 0));
  });
});

test("rule 25 in the Trash: a damaged part cell in one buried piece lists it by id and keeps the rest", async () => {
  const d = openStageDatabase(":memory:", MIGRATIONS);
  const keys = subkeys(newDataKey());
  const store = createContentStore(sqliteDocumentBackend(d, cellCipher(() => keys)), () => 1);
  await store.create(character("vera"));
  await store.create(character("mira"));
  await store.delete("character", "vera");
  await store.delete("character", "mira");
  // Damage one sealed part cell (the body), not an id cell.
  const target = d.db.query("SELECT id, cell FROM piece_parts LIMIT 1").get() as { id: number; cell: string };
  const flipped = target.cell.slice(0, -1) + (target.cell.at(-1) === "A" ? "B" : "A");
  d.db.query("UPDATE piece_parts SET cell = ? WHERE id = ?").run(flipped, target.id);
  // Force graveSummaries onto its body-reading fallback too.
  d.db.query("UPDATE grave_summaries SET derived_version = -1").run();

  const graves = await store.graveyard();
  expect(graves.map((g) => g.id).sort()).toEqual(["mira", "vera"]);
  const summaries = await store.graveSummaries();
  expect(summaries.map((g) => g.id).sort()).toEqual(["mira", "vera"]);
  d.close();
});
