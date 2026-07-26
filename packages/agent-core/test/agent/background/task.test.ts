import { describe, expect, it } from 'vitest';

import { TERMINAL_STATUSES } from '#/agent/background/task';
import type { BackgroundTaskStatus } from '#/agent/background/task';

describe('agent/background/task — TERMINAL_STATUSES', () => {
  it('includes all five terminal status values', () => {
    expect(TERMINAL_STATUSES.has('completed')).toBe(true);
    expect(TERMINAL_STATUSES.has('failed')).toBe(true);
    expect(TERMINAL_STATUSES.has('timed_out')).toBe(true);
    expect(TERMINAL_STATUSES.has('killed')).toBe(true);
    expect(TERMINAL_STATUSES.has('lost')).toBe(true);
    expect(TERMINAL_STATUSES.size).toBe(5);
  });

  it('does not include non-terminal statuses', () => {
    const nonTerminal: BackgroundTaskStatus[] = ['running'];
    for (const status of nonTerminal) {
      expect(TERMINAL_STATUSES.has(status)).toBe(false);
    }
  });
});
