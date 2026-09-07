/**
 * Hard-deadline semantics of runWithActiveChild: the one-shot finishing
 * grace re-arms the wall-clock exactly once and grants the conductor notice,
 * and the wedge guarantee still holds after the (bounded) extension.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SubagentDeadlineError,
  SUBAGENT_DEADLINE_ENV,
} from '../../src/session/subagent/subagent-errors';
import { runWithActiveChild } from '../../src/session/subagent/subagent-run-lifecycle';

function wedgedRun(): Promise<never> {
  // A wedged child (stuck network, unresponsive gateway): the promise never
  // settles on its own — only the deadline controller may end the run.
  return new Promise<never>(() => {});
}

describe('runWithActiveChild finishing grace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env[SUBAGENT_DEADLINE_ENV];
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env[SUBAGENT_DEADLINE_ENV];
  });

  it('re-arms the deadline once and kills the wedged child after the grace', async () => {
    const activeChildren = new Map();
    const notice = vi.fn();

    const completion = runWithActiveChild(
      activeChildren,
      'child_grace',
      {
        signal: new AbortController().signal,
        runInBackground: false,
        timeoutMs: 1_000,
        deadlineGraceOnceMs: 5_000,
        notifyDeadlineGrace: notice,
      },
      wedgedRun,
    );
    const captured = completion.catch((error: unknown) => error);

    vi.advanceTimersByTime(1_000);
    // The hard deadline fired: one notice, and the child lives on the grace.
    expect(notice).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4_999);
    let settled: unknown = 'pending';
    void captured.then((error) => {
      settled = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe('pending');

    vi.advanceTimersByTime(1);
    const error = await captured;
    expect(error).toBeInstanceOf(SubagentDeadlineError);
    // One-shot: the grace never re-arms a second time.
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it('without a grace budget the deadline is the plain guillotine', async () => {
    const activeChildren = new Map();
    const notice = vi.fn();

    const completion = runWithActiveChild(
      activeChildren,
      'child_plain',
      {
        signal: new AbortController().signal,
        runInBackground: false,
        timeoutMs: 1_000,
        notifyDeadlineGrace: notice,
      },
      wedgedRun,
    );
    const captured = completion.catch((error: unknown) => error);

    vi.advanceTimersByTime(1_000);
    const error = await captured;
    expect(error).toBeInstanceOf(SubagentDeadlineError);
    expect(notice).not.toHaveBeenCalled();
  });
});
