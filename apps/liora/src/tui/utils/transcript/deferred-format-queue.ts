/**
 * Budgeted queue for transcript tool-body formatting (highlight / pretty-print).
 *
 * Fast wheel scroll used to format every newly visible tool body synchronously
 * inside `render()`, freezing the TUI. Large bodies now paint plain text first
 * and enqueue work here so at most a few formats run per idle turn.
 */

export type DeferredFormatJob = () => void;

/** Soft budget: stop starting new jobs once this many ms elapsed in a drain. */
export const DEFERRED_FORMAT_BUDGET_MS = 4;
/** Hard cap on jobs started in one drain (even if each is tiny). */
export const DEFERRED_FORMAT_MAX_JOBS_PER_DRAIN = 2;

const queue: DeferredFormatJob[] = [];
let drainScheduled = false;
let drainImpl: ((run: () => void) => void) | undefined;

/** Override the scheduler (tests). Default: `setImmediate` / `setTimeout(0)`. */
export function setDeferredFormatSchedulerForTest(
  schedule: ((run: () => void) => void) | undefined,
): void {
  drainImpl = schedule;
}

function defaultSchedule(run: () => void): void {
  if (typeof setImmediate === 'function') {
    setImmediate(run);
    return;
  }
  setTimeout(run, 0);
}

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  const schedule = drainImpl ?? defaultSchedule;
  schedule(() => {
    drainScheduled = false;
    drainQueue();
  });
}

function drainQueue(): void {
  if (queue.length === 0) return;
  const started = Date.now();
  let ran = 0;
  while (queue.length > 0 && ran < DEFERRED_FORMAT_MAX_JOBS_PER_DRAIN) {
    if (ran > 0 && Date.now() - started >= DEFERRED_FORMAT_BUDGET_MS) break;
    const job = queue.shift();
    if (job === undefined) break;
    ran += 1;
    try {
      job();
    } catch {
      // Formatting must never take down the TUI; skip failed bodies.
    }
  }
  if (queue.length > 0) scheduleDrain();
}

/** Enqueue a format apply. Coalesces drain scheduling. */
export function scheduleDeferredTranscriptFormat(job: DeferredFormatJob): void {
  queue.push(job);
  scheduleDrain();
}

/** Test helper — drop pending work. */
export function clearDeferredTranscriptFormatQueueForTest(): void {
  queue.length = 0;
  drainScheduled = false;
}

/** Test helper — pending job count. */
export function deferredTranscriptFormatQueueSizeForTest(): number {
  return queue.length;
}

/** Test helper — run one drain synchronously (ignores scheduler). */
export function flushDeferredTranscriptFormatQueueForTest(): void {
  drainScheduled = false;
  // Keep draining until empty so tests can finish multi-budget work.
  while (queue.length > 0) {
    const started = Date.now();
    let ran = 0;
    while (queue.length > 0 && ran < DEFERRED_FORMAT_MAX_JOBS_PER_DRAIN) {
      if (ran > 0 && Date.now() - started >= DEFERRED_FORMAT_BUDGET_MS) break;
      const job = queue.shift();
      if (job === undefined) break;
      ran += 1;
      job();
    }
    // If budget stopped us with jobs left, loop again (sync flush ignores wall budget across turns).
    if (ran === 0) break;
  }
}
