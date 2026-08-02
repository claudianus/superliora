import { describe, expect, it } from 'vitest';

import {
  SLOW_TOOL_THRESHOLD_MS,
  SLOW_TOOL_WARN_PREFIX,
  formatSlowToolWarnTip,
} from '../../src/loop';

describe('formatSlowToolWarnTip (Loop27a)', () => {
  it('names the tool, duration, and threshold', () => {
    const tip = formatSlowToolWarnTip('Bash', 12_500);
    expect(tip.startsWith(SLOW_TOOL_WARN_PREFIX)).toBe(true);
    expect(tip).toContain('Bash');
    expect(tip).toContain('12500');
    expect(tip).toContain(String(SLOW_TOOL_THRESHOLD_MS));
  });
});
