import { describe, expect, it } from 'vitest';

import {
  formatParkedWaitLabel,
  isParkedSendableWait,
  isTaskOutputBlockingWait,
} from '#/tui/features/transcript/parked-wait';

describe('isTaskOutputBlockingWait', () => {
  it('accepts only blocking TaskOutput', () => {
    expect(isTaskOutputBlockingWait({ name: 'TaskOutput', args: { block: true } })).toBe(true);
    expect(isTaskOutputBlockingWait({ name: 'TaskOutput', args: { block: 'true' } })).toBe(true);
    expect(isTaskOutputBlockingWait({ name: 'TaskOutput', args: { block: false } })).toBe(false);
    expect(isTaskOutputBlockingWait({ name: 'TaskOutput', args: {} })).toBe(false);
    expect(isTaskOutputBlockingWait({ name: 'Agent', args: { block: true } })).toBe(false);
  });
});

describe('isParkedSendableWait', () => {
  it('parks only when every running tool is a blocking TaskOutput', () => {
    expect(isParkedSendableWait([])).toBe(false);
    expect(isParkedSendableWait([{ name: 'TaskOutput', args: { block: true } }])).toBe(true);
    expect(
      isParkedSendableWait([
        { name: 'TaskOutput', args: { block: true } },
        { name: 'TaskOutput', args: { block: true, task_id: 'b' } },
      ]),
    ).toBe(true);
    expect(
      isParkedSendableWait([
        { name: 'TaskOutput', args: { block: true } },
        { name: 'Read', args: { path: 'a.ts' } },
      ]),
    ).toBe(false);
    expect(isParkedSendableWait([{ name: 'Agent', args: {} }])).toBe(false);
  });
});

describe('formatParkedWaitLabel', () => {
  it('keeps the SuperLiora steer hint instead of claiming send interrupts', () => {
    expect(formatParkedWaitLabel('waiting')).toBe('waiting · ctrl+s: steer');
    expect(formatParkedWaitLabel('1 command still running')).toBe(
      '1 command still running · ctrl+s: steer',
    );
  });
});
