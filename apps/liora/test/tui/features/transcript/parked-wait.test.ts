import { describe, expect, it } from 'vitest';
import { formatParkedWaitLabel, isParkedSendableWait, isSessionControlBlockingWait } from '#/tui/features/transcript/parked-wait';
const wait = { name: 'SessionControl', args: { operation: 'wait', id: 'child' } };

describe('SessionControl blocking waits', () => {
  it('uses default and positive timeouts as blocking, zero as an output snapshot', () => {
    expect(isSessionControlBlockingWait(wait)).toBe(true);
    expect(isSessionControlBlockingWait({ ...wait, args: { ...wait.args, timeout: 5 } })).toBe(true);
    expect(isSessionControlBlockingWait({ ...wait, args: { ...wait.args, timeout: 0 } })).toBe(false);
    expect(isSessionControlBlockingWait({ name: 'SessionControl', args: { operation: 'list' } })).toBe(false);
    expect(isSessionControlBlockingWait({ name: 'Bash', args: { command: 'sleep 2' } })).toBe(false);
  });
  it('parks only when every in-flight operation is a blocking wait', () => {
    expect(isParkedSendableWait([])).toBe(false);
    expect(isParkedSendableWait([wait, wait])).toBe(true);
    expect(isParkedSendableWait([wait, { name: 'Bash' }])).toBe(false);
  });
  it('keeps the steer hint rather than claiming Enter interrupts', () => {
    expect(formatParkedWaitLabel('waiting')).toBe('waiting · ctrl+s: steer');
  });
});
