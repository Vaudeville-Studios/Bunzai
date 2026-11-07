/**
 * The background lane's one runner (Performance): heavy work runs on a
 * worker thread so the app's main thread never freezes behind it. It starts a worker, sends one job,
 * resolves with the worker's answer, and ends the worker. A worker that cannot start, dies, or runs
 * past its time is a failed job with a reason; the runner never throws and never falls back to
 * doing the work on the main thread itself.
 *
 * Today's workers: the database rebuild (store/sqlite/maintenance-worker.ts) and the password lock
 * (crypto/password-worker.ts).
 *
 * PACKAGING: in a compiled executable a worker must be started from a plain string literal that
 * matches an extra build entrypoint, relative to the build root (src/); a computed URL compiles and
 * then fails at runtime (the v0.1.0 release shipped exactly that for the desktop window). Source runs
 * resolve the file by URL. `store/sqlite/lane-probe.ts` is the packaged probe for both lane workers;
 * this source revision has not been compiled or probed.
 */
import { toErrorMessage } from "../error-message";

/** True inside a `bun build --compile` executable, whose files live under a virtual root. */
export const compiledBuild = (): boolean => import.meta.dir.includes("~BUN") || import.meta.dir.startsWith("/$bunfs");

/**
 * Starts a lane worker from the compiled-vs-dev branch every lane start repeats (fold: hand-copied
 * into crypto.ts and store/sqlite/background.ts, with the same inline comment). Callers pass the
 * compiled worker factory with its literal `new Worker("./...")` at the call site matching
 * build-desktop.ts, and resolve the dev URL against that caller's `import.meta.url`. Passing a path
 * string here makes the Worker constructor dynamic and can defeat compiled entrypoint discovery.
 * This function owns the branch, not the entrypoint manifest.
 */
export const startLaneWorker = (compiledFactory: () => Worker, devUrl: string): Worker =>
  compiledBuild() ? compiledFactory() : new Worker(devUrl);

export type LaneFailure = { ok: false; reason: string };

/** Sends one job to a started worker and settles once. `park` is told whether the worker answered cleanly (a reply, even a failed job's) and owns the worker from then on. */
function dispatch<Job, Reply>(worker: Worker, job: Job, timeoutMs: number, transfer: Transferable[], signal: AbortSignal | undefined, park: (worker: Worker, clean: boolean) => void, startMs?: number): Promise<Reply | LaneFailure> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Reply | LaneFailure, clean: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(startTimer);
      signal?.removeEventListener("abort", cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try { park(worker, clean); } catch { /* Settlement still releases the caller's owned resources. */ }
      resolve(result);
    };
    let started = false;
    const cancel = () => finish({ ok: false, reason: `the background job was cancelled${startMs !== undefined && !started ? " before its worker had started" : ""}` }, false);
    const timer = setTimeout(() => finish({ ok: false, reason: "the background job took too long and was stopped" }, false), timeoutMs);
    // A worker on a start limit says it received the job; a silence past the limit is a stalled start, not a slow job.
    const startTimer = startMs === undefined ? undefined : setTimeout(() => finish({ ok: false, reason: "the background worker never started" }, false), startMs);
    worker.onmessage = (event: MessageEvent<Reply | { laneStarted: true }>) => {
      if (startMs !== undefined && (event.data as { laneStarted?: unknown } | null)?.laneStarted === true) {
        started = true;
        clearTimeout(startTimer);
        return;
      }
      finish(event.data as Reply, true);
    };
    worker.onerror = (event: ErrorEvent) => finish({ ok: false, reason: `the background job failed: ${event.message}` }, false);
    worker.onmessageerror = () => finish({ ok: false, reason: "the background job reply could not be received" }, false);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    try { worker.postMessage(job, transfer); }
    catch (error) { finish({ ok: false, reason: `the background job could not be sent: ${toErrorMessage(error)}` }, false); }
  });
}

const startFailure = (error: unknown): LaneFailure => ({ ok: false, reason: `the background lane could not start: ${toErrorMessage(error)}` });
/** Bun's Worker has ref and unref at runtime; its type definitions leave them out. */
const refs = (worker: Worker) => worker as Worker & { ref(): void; unref(): void };
const end = (worker: Worker): void => { try { worker.terminate(); } catch { /* already gone */ } };

export function runOnLane<Job, Reply>(start: () => Worker, job: Job, timeoutMs: number, transfer: Transferable[] = [], signal?: AbortSignal, startMs?: number): Promise<Reply | LaneFailure> {
  if (signal?.aborted) return Promise.resolve({ ok: false, reason: "the background job was cancelled" });
  let worker: Worker;
  try {
    worker = start();
  } catch (error) {
    return Promise.resolve(startFailure(error));
  }
  return dispatch(worker, job, timeoutMs, transfer, signal, end, startMs);
}

/**
 * A lane that keeps its worker between jobs, for work that comes in a run (a bulk import's cold reads).
 * Bun 1.3.5 does not return a terminated worker's memory (about 24 MB each, measured), so one worker per
 * job grew a 104-chat import to 3.5 GB. A worker that answered cleanly waits, unreferenced, for the next
 * job; one that failed, timed out or was cancelled is ended at once, as is any that idles past `idleMs`,
 * so a stuck or key-holding worker never outlives its job.
 */
export function reusableLane<Job, Reply>(start: () => Worker, idleMs: number) {
  let warm: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = (): void => {
    clearTimeout(timer);
    if (warm) end(warm);
    warm = null;
  };
  const park = (worker: Worker, clean: boolean): void => {
    if (!clean || warm) { end(worker); return; }
    warm = worker;
    refs(worker).unref();
    timer = setTimeout(close, idleMs);
    timer.unref?.();
  };
  return {
    run(job: Job, timeoutMs: number, transfer: Transferable[] = [], signal?: AbortSignal): Promise<Reply | LaneFailure> {
      if (signal?.aborted) return Promise.resolve({ ok: false, reason: "the background job was cancelled" });
      let worker = warm;
      clearTimeout(timer);
      warm = null;
      try {
        worker ??= start();
      } catch (error) {
        return Promise.resolve(startFailure(error));
      }
      refs(worker).ref();
      return dispatch(worker, job, timeoutMs, transfer, signal, park);
    },
    close,
  };
}
