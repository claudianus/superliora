import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubagentDeadlineError, SUBAGENT_DEADLINE_ENV } from '../../src/session/subagent/subagent-errors';
import { runWithActiveChild, pauseActiveChildDeadline, resumeActiveChildDeadline, resetActiveChildDeadline, type ActiveChildEntry } from '../../src/session/subagent/subagent-run-lifecycle';

describe('worker cancellation and operator-selected deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env[SUBAGENT_DEADLINE_ENV];
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env[SUBAGENT_DEADLINE_ENV];
  });

  it('has no automatic wall-clock cutoff', async () => {
    const active = new Map<string, ActiveChildEntry>();
    const work = Promise.withResolvers<string>();
    const completion = runWithActiveChild(active, 'unlimited', {
      signal: new AbortController().signal, runInBackground: true,
    }, () => work.promise);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(active.get('unlimited')?.controller.signal.aborted).toBe(false);
    work.resolve('done');
    expect(await completion).toBe('done');
    expect(active.size).toBe(0);
  });

  it('settles a selected deadline only after execution teardown settles', async () => {
    const active = new Map<string, ActiveChildEntry>();
    const work = Promise.withResolvers<string>();
    const completion = runWithActiveChild(active, 'deadline', {
      signal: new AbortController().signal, runInBackground: true, timeoutMs: 1000,
    }, () => work.promise);
    const failed = completion.catch((error: unknown) => error);
    let settled = false;
    void failed.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(active.get('deadline')?.controller.signal.aborted).toBe(true);
    expect(active.has('deadline')).toBe(true);
    expect(settled).toBe(false);
    work.resolve('teardown complete');
    expect(await failed).toBeInstanceOf(SubagentDeadlineError);
    expect(active.size).toBe(0);
  });

  it('cancels one background child without cancelling its sibling', async () => {
    const active = new Map<string, ActiveChildEntry>();
    const a = Promise.withResolvers<string>();
    const b = Promise.withResolvers<string>();
    const controller = new AbortController();
    const first = runWithActiveChild(active, 'a', { signal: controller.signal, runInBackground: true }, () => a.promise);
    const second = runWithActiveChild(active, 'b', { signal: new AbortController().signal, runInBackground: true }, () => b.promise);
    const failed = first.catch((error: unknown) => error);
    let settled = false;
    void failed.then(() => { settled = true; });
    const reason = new Error('operator stop');
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(active.get('b')?.controller.signal.aborted).toBe(false);
    a.resolve('teardown');
    expect(await failed).toBe(reason);
    b.resolve('done');
    expect(await second).toBe('done');
    expect(active.size).toBe(0);
  });

  it('pauses, resumes, and explicitly resets the selected deadline without a progress gate', async () => {
    const active = new Map<string, ActiveChildEntry>();
    const work = Promise.withResolvers<string>();
    const completion = runWithActiveChild(active, 'controlled', {
      signal: new AbortController().signal, runInBackground: true, timeoutMs: 1000,
    }, () => work.promise);
    const failed = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(400);
    expect(pauseActiveChildDeadline('controlled')).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(active.get('controlled')?.controller.signal.aborted).toBe(false);
    expect(resumeActiveChildDeadline('controlled')).toBe(true);
    expect(resetActiveChildDeadline('controlled', 2000)).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(active.get('controlled')?.controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    work.resolve('teardown');
    expect(await failed).toBeInstanceOf(SubagentDeadlineError);
    expect(active.size).toBe(0);
  });
});

it('resetting a selected deadline to zero keeps pause/resume unlimited', async () => {
  vi.useFakeTimers();
  const previous = process.env[SUBAGENT_DEADLINE_ENV];
  delete process.env[SUBAGENT_DEADLINE_ENV];
  const active = new Map<string, ActiveChildEntry>();
  const work = Promise.withResolvers<string>();
  try {
    const completion = runWithActiveChild(active, 'disable-limit', {
      signal: new AbortController().signal, runInBackground: true, timeoutMs: 1000,
    }, () => work.promise);
    expect(resetActiveChildDeadline('disable-limit', 0)).toBe(true);
    expect(pauseActiveChildDeadline('disable-limit')).toBe(true);
    expect(resumeActiveChildDeadline('disable-limit')).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(active.get('disable-limit')?.controller.signal.aborted).toBe(false);
    work.resolve('done');
    expect(await completion).toBe('done');
  } finally {
    vi.useRealTimers();
    if (previous === undefined) delete process.env[SUBAGENT_DEADLINE_ENV];
    else process.env[SUBAGENT_DEADLINE_ENV] = previous;
  }
});
