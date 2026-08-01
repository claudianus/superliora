import { describe, expect, it } from 'vitest';

import { formatWorkingSetFooterBadge } from '#/tui/components/chrome/footer/footer';
import {
  BALANCED_ASYNC_WORKING_SET_TOKENS,
  BALANCED_MAX_WORKING_SET_TOKENS,
  formatTokenCount,
} from '#/tui/utils/agent/context-working-set';

describe('formatWorkingSetFooterBadge', () => {
  it('returns null without a snapshot', () => {
    expect(formatWorkingSetFooterBadge(undefined, 0, 0)).toBeNull();
    expect(formatWorkingSetFooterBadge(null, 0, 0)).toBeNull();
  });

  it('renders the balanced cap with info severity under budget', () => {
    const badge = formatWorkingSetFooterBadge(
      {
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
        asyncWorkingSetTokens: BALANCED_ASYNC_WORKING_SET_TOKENS,
        presetId: 'balanced',
      },
      100_000,
      1_000_000,
    );
    expect(badge).toEqual({
      text: `Working set ${formatTokenCount(BALANCED_MAX_WORKING_SET_TOKENS)}`,
      severity: 'info',
    });
  });

  it('warns when live tokens approach the soft working-set', () => {
    const badge = formatWorkingSetFooterBadge(
      {
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
        asyncWorkingSetTokens: BALANCED_ASYNC_WORKING_SET_TOKENS,
        presetId: 'balanced',
      },
      220_000,
      1_000_000,
    );
    expect(badge?.severity).toBe('warning');
  });

  it('shows full-window policy as Working set full', () => {
    const badge = formatWorkingSetFooterBadge(
      {
        maxWorkingSetTokens: 0,
        asyncWorkingSetTokens: 0,
        presetId: 'full_window',
      },
      100_000,
      1_000_000,
    );
    expect(badge).toEqual({ text: 'Working set full', severity: 'info' });
  });

  it('compact labels keep short ws: tokens', () => {
    const badge = formatWorkingSetFooterBadge(
      {
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
        asyncWorkingSetTokens: BALANCED_ASYNC_WORKING_SET_TOKENS,
        presetId: 'balanced',
      },
      100_000,
      1_000_000,
      'compact',
    );
    expect(badge).toEqual({
      text: `ws:${formatTokenCount(BALANCED_MAX_WORKING_SET_TOKENS)}`,
      severity: 'info',
    });
  });
});
