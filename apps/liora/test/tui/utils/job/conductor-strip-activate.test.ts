import { describe, expect, it, vi } from 'vitest';

import {
  activateConductorJobsStrip,
  formatJobProgressChip,
} from '#/tui/utils/job/conductor-strip-activate';
import { formatHygieneGcNotice } from '#/tui/utils/job/job-hygiene-notice';

describe('conductor-strip-activate', () => {
  it('opens Inbox when unread > 0, otherwise Deck', () => {
    const openInbox = vi.fn();
    const openDeck = vi.fn();
    expect(
      activateConductorJobsStrip({ unreadInbox: 2, openInbox, openDeck }),
    ).toBe('inbox');
    expect(openInbox).toHaveBeenCalledOnce();
    expect(openDeck).not.toHaveBeenCalled();

    expect(
      activateConductorJobsStrip({ unreadInbox: 0, openInbox, openDeck }),
    ).toBe('deck');
    expect(openDeck).toHaveBeenCalledOnce();
  });

  it('formats phase + recent tools chip', () => {
    expect(
      formatJobProgressChip({
        phase: 'running tests',
        recentTools: ['Read', 'Edit', 'Bash'],
      }),
    ).toBe('running tests · Edit→Bash');
  });
});

describe('hygiene notice', () => {
  it('mentions /job gc when stale count > 0 (dry-run CTA helper)', () => {
    expect(formatHygieneGcNotice(0)).toBeUndefined();
    const notice = formatHygieneGcNotice(3);
    expect(notice?.title).toContain('3 stale');
    expect(notice?.detail).toContain('/job gc');
  });
});
