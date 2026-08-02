import { describe, expect, it } from 'vitest';

import {
  formatModelRefreshErrorNotice,
  formatModelRefreshFailureNotice,
} from '../../../../src/tui/utils/session/model-refresh-notice';

describe('formatModelRefreshFailureNotice', () => {
  it('names provider and reason', () => {
    const notice = formatModelRefreshFailureNotice({
      provider: 'openai',
      reason: '401 unauthorized',
    });
    expect(notice.title).toBe('Model catalog refresh skipped');
    expect(notice.detail).toContain('openai');
    expect(notice.detail).toContain('401 unauthorized');
    expect(notice.status).toMatch(/openai/);
    expect(notice.coalesceKey).toBe('model-refresh-failed-openai');
  });
});

describe('formatModelRefreshErrorNotice', () => {
  it('formats top-level errors', () => {
    const notice = formatModelRefreshErrorNotice('network down');
    expect(notice.title).toBe('Model catalog refresh failed');
    expect(notice.detail).toContain('network down');
    expect(notice.coalesceKey).toBe('model-refresh-failed');
  });
});
