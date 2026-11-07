/**
 * The database's side of the background lane (src/stage/worker-lane.ts): one heavy database job on
 * a worker thread with its own connection (maintenance-worker.ts). A failure is a result with a
 * reason, never a fallback onto the main thread, which would bring back the freeze the lane removes.
 */
import { runOnLane, startLaneWorker } from "../../worker-lane";
import type { MaintenanceJob, MaintenanceResult } from "./maintenance-worker";

function startWorker(): Worker {
  // The literal must match the entrypoint path relative to the build root (src/).
  return startLaneWorker(
    () => new Worker("./stage/store/sqlite/maintenance-worker.ts"),
    new URL("./maintenance-worker.ts", import.meta.url).href,
  );
}

/** How long a worker has to say it received its job: far past any healthy start, and short of the job's own limit, so a stalled start is named as that. */
const START_LIMIT_MS = 60_000;

/** Runs one job and ends the worker; every failure resolves as `{ ok: false, reason }`. */
export function runInBackground(job: MaintenanceJob, timeoutMs = 10 * 60_000, signal?: AbortSignal, transfer: Transferable[] = []): Promise<MaintenanceResult> {
  return runOnLane<MaintenanceJob, MaintenanceResult>(startWorker, job, timeoutMs, transfer, signal, START_LIMIT_MS);
}
