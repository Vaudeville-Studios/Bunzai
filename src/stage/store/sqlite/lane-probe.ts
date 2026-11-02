/**
 * A build-time probe, compiled into a standalone executable (like the shipped app, with `--root src`)
 * to prove the background lane works there: a database on a real file is written, rebuilt on the
 * lane's maintenance worker, a password is checked on its worker, and the cold-read worker opens a
 * packaged database path. It also checks SQLite's metadata-only octet_length. A heartbeat measures
 * the main-thread pause. Exits non-zero on any failure. Not imported by the app.
 *
 * Build and run (what CI's packaged job does):
 *   bun build --compile --root src src/stage/store/sqlite/lane-probe.ts \
 *     src/stage/store/sqlite/maintenance-worker.ts src/stage/crypto/password-worker.ts \
 *     src/stage/store/cold-read-worker.ts --outfile probe-lane
 *   ./probe-lane
 */
import { toErrorMessage } from "../../../error-message";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newDataKey, openWithPassword, wrapWithPassword } from "../../crypto/crypto";
import { openStageDatabase } from "./database";
import { MIGRATIONS } from "./migrations";
import { runOnLane, startLaneWorker } from "../../worker-lane";

const dir = mkdtempSync(join(tmpdir(), "bunzai-lane-probe-"));
let failed = false;
try {
  const d = openStageDatabase(join(dir, "probe.db"), MIGRATIONS);
  d.db.exec("CREATE TABLE t (x TEXT)");
  const octets = d.db.query("SELECT octet_length('probe') AS n").get() as { n: number };
  if (octets.n !== 5) throw new Error("SQLite does not provide metadata-only octet_length");
  const cold = await runOnLane<
    { path: string; kind: string; id: string; docKey: string; writeId: number; maxCharge: number; content: Uint8Array; index: Uint8Array },
    { ok: true; value: null } | { ok: false; error: { name: string; message: string } }
  >(
    () => startLaneWorker(() => new Worker("./stage/store/cold-read-worker.ts"), new URL("../cold-read-worker.ts", import.meta.url).href),
    { path: join(dir, "probe.db"), kind: "character", id: "probe", docKey: "not-a-key", writeId: 1, maxCharge: 0, content: new Uint8Array(32), index: new Uint8Array(32) },
    10_000,
    [],
  );
  if (!("ok" in cold) || !cold.ok || cold.value !== null) throw new Error("packaged cold-read worker did not open its database");
  d.transaction(() => {
    for (let i = 0; i < 20_000; i++) d.db.query("INSERT INTO t (x) VALUES (?)").run("row ".repeat(40));
  });
  d.transaction(() => d.db.run("DELETE FROM t WHERE rowid % 2 = 0"));

  type ProbePhase = "rebuild" | "new-key" | "password-wrap" | "password-open" | "drain";
  const phaseMarks: { phase: ProbePhase; startMs: number }[] = [];
  let longest = 0;
  let longestStart = 0;
  let longestEnd = 0;
  let last = performance.now();
  const beat = setInterval(() => {
    const now = performance.now();
    const gap = now - last;
    if (gap > longest) {
      longestStart = last - started;
      longestEnd = now - started;
    }
    longest = Math.max(longest, gap);
    last = now;
  }, 5);
  const started = performance.now();
  const markPhase = (phase: ProbePhase) => phaseMarks.push({ phase, startMs: performance.now() - started });
  phaseMarks.push({ phase: "rebuild", startMs: 0 });
  await d.rebuild();
  markPhase("new-key");
  const key = newDataKey();
  markPhase("password-wrap");
  const wrap = await wrapWithPassword(key, "probe password");
  markPhase("password-open");
  const back = await openWithPassword(wrap, "probe password");
  markPhase("drain");
  await new Promise((r) => setTimeout(r, 30));
  const probeEnd = performance.now() - started;
  clearInterval(beat);
  const phaseRanges = phaseMarks.map((mark, i) => {
    const endMs = phaseMarks[i + 1]?.startMs ?? probeEnd;
    return { ...mark, endMs, durationMs: endMs - mark.startMs };
  });
  if (!back.equals(key)) {
    console.log("FAIL: the password worker did not give the key back");
    failed = true;
  }

  const rows = (d.db.query("SELECT count(*) AS n FROM t").get() as { n: number }).n;
  const phaseSummary = phaseRanges
    .map((x) => `${x.phase}=${Math.round(x.startMs)}-${Math.round(x.endMs)} ms (${Math.round(x.durationMs)} ms)`)
    .join(", ");
  console.log(`rebuild and a password check: ${Math.round(performance.now() - started)} ms in the background; longest main-thread pause ${Math.round(longest)} ms at ${Math.max(0, Math.round(longestStart))}-${Math.round(longestEnd)} ms; phases ${phaseSummary}; ${rows} rows`);
  if (rows !== 10_000) {
    console.log("FAIL: rows changed across the rebuild");
    failed = true;
  }
  if (longest > 100) {
    console.log("FAIL: the main thread was blocked for more than 100 ms");
    failed = true;
  }
  d.close();
} catch (error) {
  console.log(`FAIL: ${toErrorMessage(error)}`);
  failed = true;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? "lane-probe: failed" : "lane-probe: ok");
process.exit(failed ? 1 : 0);
