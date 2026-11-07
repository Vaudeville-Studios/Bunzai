/**
 * The background lane's runner (worker-lane.ts): a worker's answer comes back; a worker that cannot
 * start, fails, or never answers is a failed job with a reason, never a throw and never a hang.
 */
import { expect, test } from "bun:test";
import { reusableLane, runOnLane } from "./worker-lane";

const workerFrom = (source: string) => () => new Worker(URL.createObjectURL(new Blob([source], { type: "application/javascript" })));

test("a worker's answer is the job's result", async () => {
  const echo = workerFrom("self.onmessage = (e) => self.postMessage({ ok: true, doubled: e.data * 2 });");
  expect(await runOnLane<number, { ok: true; doubled: number }>(echo, 21, 5_000)).toEqual({ ok: true, doubled: 42 });
});

test("a worker that cannot start is a failed job with the reason", async () => {
  const broken = () => {
    throw new Error("no threads here");
  };
  expect(await runOnLane(broken, null, 5_000)).toEqual({ ok: false, reason: "the background lane could not start: no threads here" });
});

test("a worker that throws is a failed job, not a crash", async () => {
  const failing = workerFrom("self.onmessage = () => { throw new Error('boom'); };");
  const result = await runOnLane(failing, null, 5_000);
  expect(result).toMatchObject({ ok: false });
  expect((result as { reason: string }).reason).toContain("boom");
});

test("a worker that never answers is stopped at its time limit", async () => {
  const silent = workerFrom("self.onmessage = () => {};");
  expect(await runOnLane(silent, null, 200)).toEqual({ ok: false, reason: "the background job took too long and was stopped" });
});

/** Bun 1.3.5 never gives a terminated worker's memory back (about 24 MB each), so one job per worker grew a bulk import to 3.5 GB. */
const counted = (source: string) => {
  const seen = { started: 0, terminated: 0 };
  const start = () => {
    seen.started++;
    const worker = workerFrom(source)();
    const end = worker.terminate.bind(worker);
    worker.terminate = () => { seen.terminated++; return end(); };
    return worker;
  };
  return { seen, start };
};
const doubler = "self.onmessage = (e) => self.postMessage(e.data * 2);";

test("a reusable lane answers every job on one worker", async () => {
  const { seen, start } = counted(doubler);
  const lane = reusableLane<number, number>(start, 60_000);
  for (let n = 1; n <= 5; n++) expect(await lane.run(n, 5_000)).toBe(n * 2);
  expect(seen.started).toBe(1);
  lane.close();
  expect(seen.terminated).toBe(1);
});

test("a worker that failed is ended, and the next job gets a fresh one", async () => {
  const { seen, start } = counted("self.onmessage = (e) => { if (e.data === 0) throw new Error('boom'); self.postMessage(e.data * 2); };");
  const lane = reusableLane<number, number>(start, 60_000);
  expect(await lane.run(1, 5_000)).toBe(2);
  expect(await lane.run(0, 5_000)).toMatchObject({ ok: false });
  expect(seen.terminated).toBe(1);
  expect(await lane.run(3, 5_000)).toBe(6);
  expect(seen.started).toBe(2);
  lane.close();
  expect(seen.terminated).toBe(2);
});

test("a cancelled job ends its worker and never parks it", async () => {
  const { seen, start } = counted("self.onmessage = () => {};");
  const lane = reusableLane<number, number>(start, 60_000);
  const abort = new AbortController();
  const pending = lane.run(1, 5_000, [], abort.signal);
  abort.abort();
  expect(await pending).toEqual({ ok: false, reason: "the background job was cancelled" });
  expect(seen.terminated).toBe(1);
});

test("an idle worker is ended after its idle time", async () => {
  const { seen, start } = counted(doubler);
  const lane = reusableLane<number, number>(start, 20);
  expect(await lane.run(1, 5_000)).toBe(2);
  const until = Date.now() + 5_000;
  while (seen.terminated === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(seen.terminated).toBe(1);
  expect(await lane.run(2, 5_000)).toBe(4);
  expect(seen.started).toBe(2);
  lane.close();
});

test("a worker on a start limit that never says it has the job is named as a stalled start", async () => {
  const silent = workerFrom("self.onmessage = () => {};");
  expect(await runOnLane<null, { ok: true }>(silent, null, 60_000, [], undefined, 50)).toEqual({ ok: false, reason: "the background worker never started" });
});

test("a worker that says it started gets its whole time, and its start signal is not taken for the answer", async () => {
  const slow = workerFrom("self.onmessage = () => { self.postMessage({ laneStarted: true }); setTimeout(() => self.postMessage({ ok: true }), 120); };");
  expect(await runOnLane<null, { ok: true }>(slow, null, 5_000, [], undefined, 50)).toEqual({ ok: true });
});
