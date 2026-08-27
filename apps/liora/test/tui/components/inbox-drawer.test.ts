/**
 * Inbox drawer — PREMIUM §3 list chrome, SearchableList paging, type-to-search.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { InboxDrawerComponent } from '#/tui/components/dialogs/inbox/inbox-drawer';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import { currentTheme } from '#/tui/theme';

const ESC = '\x1B';
const ENTER = '\r';
const DOWN = '\x1B[B';
const PAGEDOWN = '\x1B[6~';
const ANSI = /\u001B\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replaceAll(ANSI, '');
}

function notice(id: string, title: string): {
  readonly id: string;
  readonly kind: 'notice';
  readonly title: string;
  readonly eventKind: string;
} {
  return { id, kind: 'notice', title, eventKind: 'job.completed' };
}

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
    const lines = drawer.render(80).map(stripAnsi);
    expect(lines.some((line) => line.includes('Inbox is empty'))).toBe(true);
    expect(lines.some((line) => line.includes('(type to search)'))).toBe(true);
    expect(lines[0]?.includes('─')).toBe(true);
    expect(lines.at(-1)?.includes('─')).toBe(true);
    drawer.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onAct).not.toHaveBeenCalled();
  });

  it('activates the selected row on Enter and moves with ↓', () => {
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
    drawer.handleInput(DOWN);
    drawer.handleInput(ENTER);
    expect(onAct).toHaveBeenCalledWith(items[1]);
  });

  it('type-to-search uses printableChar, paints a primary Search: line, and Esc clears then cancels', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onCancel = vi.fn();
    const onAct = vi.fn();
    const items = [
      { id: 'a', kind: 'notice' as const, title: 'Done A', eventKind: 'job.completed' },
      { id: 'b', kind: 'needs_user' as const, title: 'Need input', jobId: 'job_1' },
    ];
    const drawer = new InboxDrawerComponent({
      items,
      onAct,
      onCancel,
    });

    // Kitty CSI-u for 'u' (codepoint 117) must type into search, not be ignored.
    drawer.handleInput('\x1B[117u');
    const searching = drawer.render(80);
    const joined = searching.map(stripAnsi).join('\n');
    expect(joined).toContain('Search: u');
    expect(searching.join('\n')).toContain(currentTheme.fg('primary', ' Search: '));
    expect(joined).toContain('Need input');
    expect(joined).not.toContain('Done A');
    expect(joined).not.toContain('(type to search)');

    drawer.handleInput(ESC);
    expect(onCancel).not.toHaveBeenCalled();
    expect(stripAnsi(drawer.render(80).join('\n'))).not.toContain('Search:');

    drawer.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('pages with PgUp/PgDn and shows a ▼ more indicator', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const items = Array.from({ length: 12 }, (_, i) => notice(`n${String(i)}`, `Notice ${String(i)}`));
    const drawer = new InboxDrawerComponent({
      items,
      onAct: vi.fn(),
      onCancel: vi.fn(),
    });
    const first = drawer.render(80).map(stripAnsi).join('\n');
    expect(first).toContain('Notice 0');
    expect(first).toContain('▼ 2 more');
    expect(first).toContain('PgUp/PgDn page');
    expect(first).not.toContain('Notice 11');

    drawer.handleInput(PAGEDOWN);
    const paged = drawer.render(80).map(stripAnsi).join('\n');
    expect(paged).toContain('Notice 11');
    expect(paged).not.toContain('Notice 0');
  });

  it('keeps idle M as merge and types M once a query exists', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onMergePreview = vi.fn();
    const items = [
      { id: 'a', kind: 'notice' as const, title: 'Alpha done', eventKind: 'job.completed' },
      { id: 'b', kind: 'notice' as const, title: 'Merge later', eventKind: 'job.completed' },
    ];
    const drawer = new InboxDrawerComponent({
      items,
      onAct: vi.fn(),
      onMergePreview,
      onCancel: vi.fn(),
    });
    drawer.handleInput('m');
    expect(onMergePreview).toHaveBeenCalledWith(items[0]);

    drawer.handleInput('e');
    drawer.handleInput('m');
    expect(onMergePreview).toHaveBeenCalledTimes(1);
    expect(stripAnsi(drawer.render(80).join('\n'))).toContain('Search: em');
  });
});
