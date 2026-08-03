/**
 * In-memory registry of live Conductor job workers (AbortController + agent id).
 * Process-local only — session resume re-spawns via interrupted jobs (later slice).
 */

export interface JobWorkerHandle {
  readonly jobId: string;
  readonly controller: AbortController;
  workerAgentId?: string;
}

const handles = new Map<string, JobWorkerHandle>();

export function registerJobWorkerHandle(
  jobId: string,
  controller: AbortController,
): JobWorkerHandle {
  const existing = handles.get(jobId);
  if (existing) {
    // Replace stale handle; abort previous if still live.
    if (!existing.controller.signal.aborted) {
      existing.controller.abort(new Error('replaced by newer worker launch'));
    }
  }
  const handle: JobWorkerHandle = { jobId, controller };
  handles.set(jobId, handle);
  return handle;
}

export function setJobWorkerAgentId(jobId: string, workerAgentId: string): void {
  const handle = handles.get(jobId);
  if (handle) handle.workerAgentId = workerAgentId;
}

export function getJobWorkerHandle(jobId: string): JobWorkerHandle | undefined {
  return handles.get(jobId);
}

export function clearJobWorkerHandle(jobId: string): void {
  handles.delete(jobId);
}

/**
 * Abort a running job worker. Returns true if a live handle was aborted.
 */
export function abortJobWorker(
  jobId: string,
  reason: unknown = new Error('job cancelled'),
): boolean {
  const handle = handles.get(jobId);
  if (handle === undefined) return false;
  if (!handle.controller.signal.aborted) {
    handle.controller.abort(reason);
  }
  return true;
}

/** Test/helper: drop all handles (does not abort). */
export function __resetJobWorkerHandlesForTests(): void {
  handles.clear();
}

export function __jobWorkerHandleCountForTests(): number {
  return handles.size;
}
