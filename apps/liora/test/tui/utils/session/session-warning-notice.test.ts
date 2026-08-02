import { describe, expect, it } from 'vitest';

import { formatSessionWarningNotice } from '../../../../src/tui/utils/session/session-warning-notice';

describe('formatSessionWarningNotice', () => {
  it('maps agents-md-oversized soft budget', () => {
    const notice = formatSessionWarningNotice({
      code: 'agents-md-oversized',
      message:
        'AGENTS.md exceeds the recommended 40,000 character budget (50,000 chars). Consider trimming project instructions to reduce context load.',
      severity: 'warning',
    });
    expect(notice.title).toBe('AGENTS.md oversized');
    expect(notice.coalesceKey).toBe('agents-md-oversized');
    expect(notice.status).toMatch(/consider trimming/);
    expect(notice.statusColor).toBe('warning');
  });

  it('maps hard injection cap status', () => {
    const notice = formatSessionWarningNotice({
      code: 'agents-md-oversized',
      message:
        'AGENTS.md exceeds the hard injection cap of 120,000 characters (150,000 chars). Content was truncated before injection.',
      severity: 'warning',
    });
    expect(notice.status).toMatch(/hard-capped/);
  });

  it('falls back for unknown codes', () => {
    const notice = formatSessionWarningNotice({
      code: 'future-code',
      message: 'something new',
      severity: 'error',
    });
    expect(notice.title).toBe('Session warning (future-code)');
    expect(notice.coalesceKey).toBe('session-warning-future-code');
    expect(notice.statusColor).toBe('error');
  });
});
