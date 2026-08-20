import { describe, expect, it } from 'vitest';

import { formatRuntimeDegradedNotice } from '../../../../src/tui/utils/session/runtime-degraded-notice';

describe('formatRuntimeDegradedNotice', () => {
  it('labels known scopes and includes reason + hint', () => {
    const notice = formatRuntimeDegradedNotice({
      scope: 'llm',
      reason: 'provider_5xx',
      hint: 'fallbackModels engaged',
    });
    expect(notice.title).toBe('LLM degraded');
    expect(notice.detail).toContain('provider_5xx');
    expect(notice.detail).toContain('fallbackModels engaged');
    expect(notice.status).toMatch(/llm: provider_5xx/);
    expect(notice.coalesceKey).toBe('runtime-degraded-llm');
  });

  it('labels storage scope', () => {
    const notice = formatRuntimeDegradedNotice({
      scope: 'storage',
      reason: 'disk_full:enospc',
      hint: 'run liora gc',
    });
    expect(notice.title).toMatch(/Storage degraded|저장소/);
    expect(notice.coalesceKey).toBe('runtime-degraded-storage');
    expect(notice.detail).toContain('disk_full:enospc');
  });

  it('falls back for unknown scopes', () => {
    const notice = formatRuntimeDegradedNotice({
      scope: 'custom-bus',
      reason: 'timeout',
    });
    expect(notice.title).toBe('custom-bus degraded');
    expect(notice.coalesceKey).toBe('runtime-degraded-custom-bus');
  });
});
