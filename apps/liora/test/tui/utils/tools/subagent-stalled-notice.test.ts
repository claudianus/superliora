import { describe, expect, it } from 'vitest';

import { formatSubagentStalledNotice } from '../../../../src/tui/utils/tools/subagent-stalled-notice';

describe('formatSubagentStalledNotice', () => {
  it('formats name, silence duration, and tool count', () => {
    const notice = formatSubagentStalledNotice({
      subagentId: 'child-1',
      subagentName: 'coder',
      silentMs: 5 * 60 * 1000,
      toolCount: 12,
    });
    expect(notice.title).toBe('Subagent stalled');
    expect(notice.detail).toContain('coder');
    expect(notice.detail).toContain('5m');
    expect(notice.detail).toContain('12 tools');
    expect(notice.status).toMatch(/coder \(5m\)/);
    expect(notice.coalesceKey).toBe('subagent-stalled-child-1');
  });

  it('falls back to id when name is missing', () => {
    const notice = formatSubagentStalledNotice({
      subagentId: 'abc',
      silentMs: 90_000,
      toolCount: 0,
    });
    expect(notice.detail).toContain('abc');
    expect(notice.detail).toContain('1m 30s');
  });
});
