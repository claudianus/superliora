import { describe, expect, it } from 'vitest';

import { formatSessionResumeWarningNotice } from '../../../../src/tui/utils/session/session-resume-warning-notice';

describe('formatSessionResumeWarningNotice', () => {
  it('wraps the resume warning text', () => {
    const notice = formatSessionResumeWarningNotice(
      'Transcript was partially recovered after a crash.',
    );
    expect(notice.title).toBe('Session resume warning');
    expect(notice.detail).toContain('partially recovered');
    expect(notice.status).toMatch(/^Resume warning:/);
    expect(notice.coalesceKey).toBe('session-resume-warning');
  });

  it('handles empty input with a fallback detail', () => {
    const notice = formatSessionResumeWarningNotice('   ');
    expect(notice.detail).toMatch(/resumed with a warning/i);
  });
});
