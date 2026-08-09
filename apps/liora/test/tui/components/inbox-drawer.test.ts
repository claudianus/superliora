/**
 * Inbox drawer smoke — list navigation + Enter/Esc callbacks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { InboxDrawerComponent } from '#/tui/components/dialogs/inbox/inbox-drawer';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';

const ESC = '\x1b';
const ENTER = '\r';

describe('InboxDrawerComponent', () => {
  afterEach(() => {
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('renders empty state and closes on Esc', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onCancel = vi.fn();
    const onAct = vi.fn();
    const drawer = new InboxDrawerComponent({
      items: [],
      onAct,
      onCancel,
    });
    const lines = drawer.render(80);
    expect(lines.some((line) => line.includes('Inbox is empty'))).toBe(true);
    drawer.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onAct).not.toHaveBeenCalled();
  });

  it('activates the selected row on Enter and moves with j/k', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onAct = vi.fn();
    const items = [
      { id: 'a', kind: 'notice' as const, title: 'Done A', eventKind: 'job.completed' },
      { id: 'b', kind: 'needs_user' as const, title: 'Need input', jobId: 'job_1' },
    ];
    const drawer = new InboxDrawerComponent({
      items,
      onAct,
      onCancel: vi.fn(),
    });
    drawer.handleInput('j');
    drawer.handleInput(ENTER);
    expect(onAct).toHaveBeenCalledWith(items[1]);
  });
});
