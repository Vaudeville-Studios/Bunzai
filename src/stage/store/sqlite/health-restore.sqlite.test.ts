/**
 * The health check and the snapshot store together, on real encrypted files with a real keyring: a
 * restore leaves a library the scan calls clean (fingerprints travel with the content, the stale-row
 * queue is signed by the restore's own commit, an older snapshot's rows are adopted, not damaged),
 * set-aside rows are restored with the content, and the repair "restore from a snapshot" heals real
 * damage while the damaged state stays kept in the safety copy (nothing is hard-deleted).
 */
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { addChat, asBeforeHealthCheck, card, makeRig, type Rig } from "../fake-snapshot-rig";
import { createHealthCheck, type HealthCheck } from "./health-check";
import { attachRowFingerprints } from "./row-fingerprints";
import type { ScanReport } from "./health-types";

const rigs: Rig[] = [];
const rig = async () => {
  const r = await makeRig();
  rigs.push(r);
  return r;
};
afterEach(() => {
  for (const r of rigs.splice(0)) r.close();
});
const flip = (cell: string): string => cell.slice(0, 10) + (cell[10] === "A" ? "B" : "A") + cell.slice(11);
const one = <T>(r: Rig, text: string, ...params: (string | number)[]) => r.d.db.query(text).get(...params) as T;
const reasons = (db: Database) => (db.query("SELECT reason FROM set_aside ORDER BY id").all() as { reason: string }[]).map((x) => x.reason);
const addAside = (r: Rig, reason: string) =>
  r.d.statement("INSERT INTO set_aside (group_id, at, tbl, row_key, row_json, reason) VALUES (?, 1, 'swipes', '[1,0]', '{}', ?)").run(reason, reason);

/** A health check over the rig, made before any content so every row is signed as it is written. */
const withHealth = (r: Rig): HealthCheck =>
  createHealthCheck({ database: r.d, cipher: r.cipher, path: r.path, content: r.library, keys: r.ring, snapshots: r.snapshots });
const clean = (report: ScanReport) => {
  expect(report.complete).toBe(true);
  expect(report.findings).toEqual([]);
};

async function seed(r: Rig) {
  const alpha = await addChat(r, "Alpha");
  await addChat(r, "Beta");
  await r.library.save(card("k-1", "Card One"));
  return alpha;
}
async function moveOn(r: Rig, alpha: string) {
  await addChat(r, "Gamma");
  await r.library.save(card("k-1", "Card One, edited"), { overwrite: true });
  const branch = (await r.chats.getChat(alpha))!.activeBranchId;
  await r.chats.appendMessage(branch, { role: "user", content: "a later line" });
}

test("after a restore the scan finds the library clean, and every row keeps the fingerprint it had in the snapshot", async () => {
  const r = await rig();
  const health = withHealth(r);
  const alpha = await seed(r);
  const snap = await r.snapshots.take();
  const signedThen = one<{ n: number }>(r, "SELECT count(*) AS n FROM row_fingerprints").n;
  expect(signedThen).toBeGreaterThan(0);
  await moveOn(r, alpha);
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM row_fingerprints").n).toBeGreaterThan(signedThen);

  await r.snapshots.restore(snap.id);

  const report = await health.scan();
  clean(report);
  expect(report.adoptable).toEqual([]); // nothing needed re-signing: the fingerprints came with the rows
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM row_fingerprints").n).toBe(signedThen);
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM fp_dirty").n).toBe(0);
});

test("rows a snapshot held with a stale fingerprint are signed by the restore's own commit", async () => {
  const r = await rig();
  const health = withHealth(r);
  const alpha = await seed(r);
  // A write that skipped the seal (a trigger queues the row, its fingerprint is stale), as a crash between writes could leave.
  r.d.db.run("UPDATE chats SET updated_at = updated_at + 1");
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM fp_dirty").n).toBeGreaterThan(0);
  const snap = await r.snapshots.take();
  await moveOn(r, alpha);

  await r.snapshots.restore(snap.id);

  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM fp_dirty").n).toBe(0);
  clean(await health.scan());
});

test("a snapshot from before the health check restores, and its rows are adopted, not reported as damage", async () => {
  const r = await rig();
  const health = withHealth(r);
  const alpha = await seed(r);
  const snap = await r.snapshots.take();
  await moveOn(r, alpha);
  asBeforeHealthCheck(join(r.snapDir, `${snap.id}.db`));
  expect((await r.snapshots.preview(snap.id)).schema).toBe("older");

  await r.snapshots.restore(snap.id);

  const report = await health.scan();
  clean(report);
  expect(report.adoptable.length).toBeGreaterThan(0); // no fingerprints yet: not yet covered
  const adopted = await health.adoptFingerprints(report);
  expect(adopted).toBe(report.adoptable.length);
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM row_fingerprints").n).toBe(report.adoptable.length);
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM fp_dirty").n).toBe(0);
});

test("set-aside rows are user data: a restore brings back the snapshot's, and the safety copy keeps today's", async () => {
  const r = await rig();
  const health = withHealth(r);
  const alpha = await seed(r);
  addAside(r, "before");
  const snap = await r.snapshots.take();
  await moveOn(r, alpha);
  addAside(r, "after");

  const { undo } = await r.snapshots.restore(snap.id);
  expect(reasons(r.d.db)).toEqual(["before"]);
  const safety = new Database(join(r.snapDir, `${undo.id}.db`), { readonly: true });
  expect(reasons(safety)).toEqual(["before", "after"]);
  safety.close(true);

  await r.snapshots.restore(undo.id); // and the undo brings today's back
  expect(reasons(r.d.db)).toEqual(["before", "after"]);
  clean(await health.scan());
});

test("damage is found, restored from a real snapshot, found gone, and the damaged state is still kept", async () => {
  const r = await rig();
  const health = withHealth(r);
  await seed(r);
  const snap = await r.snapshots.take();
  const message = one<{ message_id: string; content: string }>(r, "SELECT message_id, content FROM swipes ORDER BY message_id LIMIT 1");
  const damaged = flip(message.content);
  r.d.db.run("UPDATE swipes SET content = ? WHERE message_id = ? AND position = 0", [damaged, message.message_id]);

  const found = (await health.scan()).findings.filter((f) => f.code === "cell-unreadable" && f.row.table === "swipes");
  expect(found).toHaveLength(1);
  expect(found[0]!.repairs).toContain("restore-snapshot");
  const rowsBefore = one<{ n: number }>(r, "SELECT count(*) AS n FROM swipes").n;

  const result = await health.repair({ kind: "restore-snapshot", finding: found[0]!, snapshotId: snap.id });

  expect(result.cleared).toBe(true);
  expect(result.summary).toContain("checks clean");
  clean(await health.scan());
  expect(one<{ content: string }>(r, "SELECT content FROM swipes WHERE message_id = ? AND position = 0", message.message_id).content).toBe(message.content);
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM swipes").n).toBe(rowsBefore);
  // Nothing hard-deleted: the safety copy still holds the damaged cell exactly as it was found.
  const safety = r.snapshots.list().find((s) => s.kind === "before-restore")!;
  const kept = new Database(join(r.snapDir, `${safety.id}.db`), { readonly: true });
  expect((kept.query("SELECT content FROM swipes WHERE message_id = ? AND position = 0").get(message.message_id) as { content: string }).content).toBe(damaged);
  kept.close(true);
});

test("restoring a snapshot that holds the same damage says the item is still reported, never cleared", async () => {
  const r = await rig();
  const health = withHealth(r);
  await seed(r);
  const message = one<{ message_id: string; content: string }>(r, "SELECT message_id, content FROM swipes ORDER BY message_id LIMIT 1");
  r.d.db.run("UPDATE swipes SET content = ? WHERE message_id = ? AND position = 0", [flip(message.content), message.message_id]);
  const snap = await r.snapshots.take(); // taken after the damage
  const finding = (await health.scan()).findings.find((f) => f.code === "cell-unreadable")!;

  const result = await health.repair({ kind: "restore-snapshot", finding, snapshotId: snap.id });

  expect(result.cleared).toBe(false);
  expect(result.summary).toContain("still reported");
});

test("a seal that fails after a restore is recorded, shown by the scan, never swallowed, and settled by the next commit", async () => {
  const r = await rig();
  const health = withHealth(r);
  const alpha = await seed(r);
  r.d.db.run("UPDATE chats SET updated_at = updated_at + 1"); // a stale queue for the restore to sign
  const snap = await r.snapshots.take();
  await moveOn(r, alpha);
  r.d.setCommitSeal(() => { throw new Error("disk hiccup"); });

  const result = await r.snapshots.restore(snap.id);

  expect(result.sealOwed).toBe("disk hiccup"); // the restore is done, and says what is still owed
  expect(one<{ value: string }>(r, "SELECT value FROM library_meta WHERE key = 'seal_owed'").value).toBe("disk hiccup");
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM fp_dirty").n).toBeGreaterThan(0);
  expect((await health.scan()).sealOwed).toBe("disk hiccup"); // the scan retries it and, failing again, reports it

  attachRowFingerprints(r.d, r.cipher); // the fault is gone
  await addChat(r, "The next commit"); // an ordinary write signs the queue and settles the record
  expect(r.d.sealOwed()).toBeNull();
  expect(r.d.db.query("SELECT 1 FROM library_meta WHERE key = 'seal_owed'").get()).toBeNull();
  expect(one<{ n: number }>(r, "SELECT count(*) AS n FROM fp_dirty").n).toBe(0);
  const report = await health.scan();
  expect(report.sealOwed).toBeNull();
  clean(report);
});
