import { describe, expect, it } from 'vitest';

import {
  SLOW_TOOL_WARN_PREFIX,
  formatSlowToolWarnNotice,
  isSlowToolWarnOutput,
} from '../../../../src/tui/utils/tools/slow-tool-notice';

describe('isSlowToolWarnOutput', () => {
  it('detects the stable marker', () => {
    expect(
      isSlowToolWarnOutput(
        `ok\n\n${SLOW_TOOL_WARN_PREFIX} Bash took 12500ms (threshold 10000ms).`,
      ),
    ).toBe(true);
  });

  it('ignores ordinary successes', () => {
    expect(isSlowToolWarnOutput('ok')).toBe(false);
    expect(isSlowToolWarnOutput(null)).toBe(false);
  });
});

describe('formatSlowToolWarnNotice', () => {
  it('names the tool', () => {
    const notice = formatSlowToolWarnNotice('Bash');
    expect(notice.title).toBe('Slow tool');
    expect(notice.detail).toContain('Bash');
    expect(notice.detail).toContain(SLOW_TOOL_WARN_PREFIX);
    expect(notice.coalesceKey).toBe('slow-tool-warn');
  });
});
