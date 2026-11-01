/** Core birth origin coverage upgrades legacy fingerprints without adopting damaged sealed cells. */
import { afterEach, expect, test } from "bun:test";
import { CAST, SNAP } from "../../contracts/chat-store.contract-rig";
import { sqliteCoreRecordStore } from "./core-record-store";
import { createHealthCheck } from "./health-check";
import { makeLibrary, type Library } from "./health-test-support";
import { fingerprintOf, readFacts, specOf, type FpSpec } from "./row-fingerprints";

const TABLE = "core_scene_creation_bindings";
// Historical v1 inputs intentionally omit origin; v1 never authenticated that plaintext column.
const V1: FpSpec = { table: TABLE, v: 1, key: ["chat_id"], cells: ["body_cell"], plain: ["branch_id", "operation_hash", "package_hash"] };
const libraries: Library[] = [];
afterEach(() => { for (const l of libraries.splice(0)) l.dispose(); });

async function fixture() {
  const l = await makeLibrary(); libraries.push(l);
  const health = createHealthCheck(l);
  if (!l.chats.createCoreChat) throw new Error("Core birth fixture requires Core scene creation");
  const chat = await l.chats.createCoreChat({ title: "Core origin", cast: CAST, snapshot: SNAP });
  const key = JSON.stringify([chat.id]);
  const records = sqliteCoreRecordStore(l.database, l.cipher);
  expect(await records.unlinkedBirth(chat.id)).toMatchObject({ origin: "host" });
  const stored = () => l.database.statement("SELECT v, fp FROM row_fingerprints WHERE tbl = ? AND row_key = ?").get(TABLE, key) as { v: number; fp: string };
  const legacy = () => {
    const facts = readFacts(l.database.statement, V1, key);
    if (!facts) throw new Error("Core birth row missing");
    l.database.statement("UPDATE row_fingerprints SET v = 1, fp = ? WHERE tbl = ? AND row_key = ?").run(fingerprintOf(l.cipher, V1, facts), TABLE, key);
  };
  return { l, health, chat, key, records, stored, legacy };
}

test("current Core birth fingerprints authenticate plaintext origin without changing its sealed authority", async () => {
  const f = await fixture();
  expect((await f.health.scan({ tables: [TABLE] })).findings).toEqual([]);
  f.l.database.statement("UPDATE core_scene_creation_bindings SET origin = 'extension' WHERE chat_id = ?").run(f.chat.id);
  const report = await f.health.scan({ tables: [TABLE] });
  expect(report.findings.some((finding) => finding.code === "row-changed" && finding.row.table === TABLE && finding.row.key === f.key)).toBe(true);
  expect(specOf(TABLE)?.v).toBe(2);
  expect(f.stored().v).toBe(2);
  expect(await f.records.unlinkedBirth(f.chat.id)).toMatchObject({ origin: "host" });
});

test("valid legacy v1 Core birth fingerprints are old and explicitly adopt into clean v2", async () => {
  const f = await fixture(); f.legacy();
  const page = await f.l.lane({ table: TABLE, keys: [f.key] });
  expect(page.rows[0]?.fp).toBe("old");
  const report = await f.health.scan({ tables: [TABLE] });
  expect(report.findings).toEqual([]);
  expect(report.adoptable).toContainEqual({ table: TABLE, key: f.key });
  expect(await f.health.adoptFingerprints(report)).toBe(1);
  expect(f.stored().v).toBe(2);
  const spec = specOf(TABLE)!;
  expect(f.stored().fp).toBe(fingerprintOf(f.l.cipher, spec, readFacts(f.l.database.statement, spec, f.key)!));
  const again = await f.health.scan({ tables: [TABLE] });
  expect(again.findings).toEqual([]);
  expect(again.adoptable).toEqual([]);
});

test("adopting a legacy Core birth never signs a sealed body damaged after scan", async () => {
  const f = await fixture(); f.legacy();
  const report = await f.health.scan({ tables: [TABLE] });
  expect(report.adoptable).toContainEqual({ table: TABLE, key: f.key });
  const original = f.stored();
  const { body_cell: body } = f.l.database.statement("SELECT body_cell FROM core_scene_creation_bindings WHERE chat_id = ?").get(f.chat.id) as { body_cell: string };
  const damaged = body.slice(0, 10) + (body[10] === "A" ? "B" : "A") + body.slice(11);
  f.l.database.statement("UPDATE core_scene_creation_bindings SET body_cell = ? WHERE chat_id = ?").run(damaged, f.chat.id);
  // Model physical corruption, which does not enqueue a legitimate application write.
  f.l.database.statement("DELETE FROM fp_dirty WHERE tbl = ? AND row_key = ?").run(TABLE, f.key);
  expect(await f.health.adoptFingerprints(report)).toBe(0);
  expect(f.stored()).toEqual(original);
  expect((await f.health.scan({ tables: [TABLE] })).findings.some((finding) => finding.code === "cell-unreadable" && finding.row.table === TABLE)).toBe(true);
  expect((f.l.database.statement("SELECT body_cell FROM core_scene_creation_bindings WHERE chat_id = ?").get(f.chat.id) as { body_cell: string }).body_cell).toBe(damaged);
});
