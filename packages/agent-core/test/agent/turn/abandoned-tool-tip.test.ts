import { describe, expect, it } from 'vitest';

import {
  ABANDONED_TOOL_CODE,
  ABANDONED_TOOL_WARNING_CODE,
  abandonedToolResultOutput,
  formatAbandonedToolWireTip,
} from '../../../src/agent/turn/error-recovery';

describe('abandoned tool tips (Loop35a)', () => {
  it('tags result output with ABANDONED_TOOL', () => {
    const out = abandonedToolResultOutput({
      type: 'turn.ended',
      turnId: 1,
      reason: 'cancelled',
    });
    expect(out.startsWith(`${ABANDONED_TOOL_CODE}:`)).toBe(true);
    expect(out).toContain('cancelled');
    expect(out).toContain(`code=${ABANDONED_TOOL_CODE}`);
  });

  it('formats wire tip with count and reason', () => {
    expect(ABANDONED_TOOL_WARNING_CODE).toBe('abandoned-tool-sensor');
    const tip = formatAbandonedToolWireTip(2, 'failed');
    expect(tip.startsWith(`${ABANDONED_TOOL_CODE}:`)).toBe(true);
    expect(tip).toContain('2 unresolved');
    expect(tip).toContain('failed');
  });
});
