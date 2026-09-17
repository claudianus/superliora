/**
 * H8 regression: the `finishing` phase has a finite cap and its breach returns
 * a diagnostic result.
 *
 * Observed failure (7+ times in one session): a worker entered `finishing`,
 * tool activity stopped for 3-7 minutes, and the run was then killed at the
 * 30m wall-clock with `reason: deadline` — no report, work left uncommitted.
 * These tests pin the repair: finishing silence past the cap ends the run with
 * a `SubagentFinishingCapError` that carries the interruption reason and the
 * progress snapshot gathered at the breach (instead of silence), while a
 * finishing run that keeps making tool progress is not guillotined early.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SUBAGENT_FINISHING_CAP_MS,
  JOB_WORKER_FINISHING_CAP_MS,
  SubagentDeadlineError,
  SubagentFinishingCapError,
  SUBAGENT_DEADLINE_ENV,
  isSubagentDeadlineError,
  isSubagentFinishingCapError,
} from '../../src/session/subagent/subagent-errors';
import {
  markActiveChildFinishing,
  markActiveChildToolProgress,
  recordActiveChildFinishingProgress,
  runWithActiveChild,
} from '../../src/session/subagent/subagent-run-lifecycle';

/** A finishing child that has gone silent: nothing settles on its own. */
function silentRun(): Promise<never> {
  return new Promise<never>(() => {});
}

describe('H8 finishing cap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env[SUBAGENT_DEADLINE_ENV];
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env[SUBAGENT_DEADLINE_ENV];
  });

  it('returns an interruption result when the finishing phase goes silent past the cap', async () => {
    const activeChildren = new Map();
    const entered = vi.fn();

    const completion = runWithActiveChild(
      activeChildren,
      'child_finishing_cap',
      {
        signal: new AbortController().signal,
        runInBackground: false,
        // Far longer than the cap so the cap — not the deadline — must fire.
        timeoutMs: 30 * 60 * 1000,
        finishingCapMs: 10 * 60 * 1000,
        notifyFinishingStart: entered,
      },
      silentRun,
    );
    const captured = completion.catch((error: unknown) => error);

    // The worker announces finishing mode (subagent-telemetry path).
    expect(markActiveChildFinishing('child_finishing_cap')).toBe(true);
    expect(entered).toHaveBeenCalledTimes(1);
    recordActiveChildFinishingProgress('child_finishing_cap', {
      toolCount: 42,
      lastTool: 'Bash',
      lastTarget: 'npm test',
      elapsedMs: 1_500_000,
    });

    // Inside the cap the run is still alive — finishing is not instant death.
    vi.advanceTimersByTime(9 * 60 * 1000);
    let settled: unknown = 'pending';
    void captured.then((error) => {
      settled = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe('pending');

    // Past the cap the run ends with a result instead of burning to the 30m.
    vi.advanceTimersByTime(60 * 1000);
    const error = await captured;
    expect(error).toBeInstanceOf(SubagentFinishingCapError);
    const cap = error as SubagentFinishingCapError;
    // The interruption reason and the progress at the breach both ride along.
    expect(cap.message).toContain('finishing cap exceeded');
    expect(cap.message).toContain('tools=42');
    expect(cap.message).toContain('last_tool=Bash:npm test');
    expect(cap.progress.toolCount).toBe(42);
    expect(cap.progress.lastTarget).toBe('npm test');
    // Deadline consumers keep working: it is still a deadline-class error.
    expect(isSubagentDeadlineError(error)).toBe(true);
    expect(isSubagentFinishingCapError(error)).toBe(true);
    expect(error).toBeInstanceOf(SubagentDeadlineError);
  });

  it('does not fire the cap while the finishing run keeps making tool progress', async () => {
    const activeChildren = new Map();
    const completion = runWithActiveChild(
      activeChildren,
      'child_finishing_active',
      {
        signal: new AbortController().signal,
        runInBackground: false,
        timeoutMs: 30 * 60 * 1000,
        finishingCapMs: 10 * 60 * 1000,
      },
      silentRun,
    );
    const captured = completion.catch((error: unknown) => error);

    markActiveChildFinishing('child_finishing_active');
    // Real tool progress inside finishing re-arms the idle cap; the run must
    // survive past where a silent finishing phase would already be dead.
    vi.advanceTimersByTime(9 * 60 * 1000);
    markActiveChildToolProgress('child_finishing_active');
    vi.advanceTimersByTime(9 * 60 * 1000);

    let settled: unknown = 'pending';
    void captured.then((error) => {
      settled = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe('pending');

    // Silence after the last progress still ends it at the cap.
    vi.advanceTimersByTime(60 * 1000);
    const error = await captured;
    expect(error).toBeInstanceOf(SubagentFinishingCapError);
  });

  it('leaves the run on the plain wall-clock deadline when no cap is configured', async () => {
    const activeChildren = new Map();
    const completion = runWithActiveChild(
      activeChildren,
      'child_no_cap',
      {
        signal: new AbortController().signal,
        runInBackground: false,
        timeoutMs: 1_000,
      },
      silentRun,
    );
    const captured = completion.catch((error: unknown) => error);

    // Announcing finishing without a cap is a no-op, not an early kill.
    expect(markActiveChildFinishing('child_no_cap')).toBe(true);
    vi.advanceTimersByTime(999);
    let settled: unknown = 'pending';
    void captured.then((error) => {
      settled = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe('pending');

    vi.advanceTimersByTime(1);
    const error = await captured;
    expect(error).toBeInstanceOf(SubagentDeadlineError);
    // The plain deadline path is untouched by H8.
    expect(isSubagentFinishingCapError(error)).toBe(false);
  });

  it('arms the cap once: repeated finishing announcements do not extend it', async () => {
    const activeChildren = new Map();
    const entered = vi.fn();
    const completion = runWithActiveChild(
      activeChildren,
      'child_finishing_once',
      {
        signal: new AbortController().signal,
        runInBackground: false,
        timeoutMs: 30 * 60 * 1000,
        finishingCapMs: 5 * 60 * 1000,
        notifyFinishingStart: entered,
      },
      silentRun,
    );
    const captured = completion.catch((error: unknown) => error);

    markActiveChildFinishing('child_finishing_once');
    vi.advanceTimersByTime(4 * 60 * 1000);
    // A re-announcement must not re-arm the cap (a wedged run cannot buy time).
    expect(markActiveChildFinishing('child_finishing_once')).toBe(true);
    expect(entered).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60 * 1000);
    const error = await captured;
    expect(error).toBeInstanceOf(SubagentFinishingCapError);
  });

  it('keeps the job-worker cap finite and equal to the shared default', () => {
    // Job workers opt in with this value (job-worker.ts spawn spec); a `0`
    // here would silently disable the H8 guarantee for every Conductor job.
    expect(JOB_WORKER_FINISHING_CAP_MS).toBe(DEFAULT_SUBAGENT_FINISHING_CAP_MS);
    expect(JOB_WORKER_FINISHING_CAP_MS).toBeGreaterThan(0);
    expect(Number.isFinite(JOB_WORKER_FINISHING_CAP_MS)).toBe(true);
  });
});
