import { describe, expect, it } from 'vitest';

import { formatNamedSessionErrorNotice } from '../../../../src/tui/utils/session/named-error-notice';

describe('formatNamedSessionErrorNotice', () => {
  it('names context.overflow with recovery path', () => {
    const notice = formatNamedSessionErrorNotice(
      'context.overflow',
      'Compaction limit exceeded',
    );
    expect(notice).toBeDefined();
    expect(notice?.title).toBe('Context overflow');
    expect(notice?.detail).toContain('Compaction limit exceeded');
    expect(notice?.coalesceKey).toBe('context-overflow-terminal');
  });

  it('names compaction.unable', () => {
    const notice = formatNamedSessionErrorNotice('compaction.unable', undefined);
    expect(notice?.title).toBe('Compaction unable');
    expect(notice?.detail).toMatch(/retention floor|fresh session/i);
    expect(notice?.coalesceKey).toBe('compaction-unable');
  });

  it('returns undefined for ordinary codes', () => {
    expect(formatNamedSessionErrorNotice('provider.timeout', 'boom')).toBeUndefined();
    expect(formatNamedSessionErrorNotice(undefined, 'x')).toBeUndefined();
  });
});
