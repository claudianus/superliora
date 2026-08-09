import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  resolveSplitConfirmChoice,
  SplitConfirmSheetComponent,
} from '#/tui/components/dialogs/job/split-confirm-sheet';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';

const ESC = '\x1b';
const ENTER = '\r';

const INTENTS = [
  { title: 'Fix login', prompt: 'Fix login' },
  { title: 'Add tests', prompt: 'Add tests' },
  { title: 'Update docs', prompt: 'Update docs' },
];

describe('SplitConfirmSheetComponent', () => {
  afterEach(() => {
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('lists intents and confirms keep-all on Enter', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onSelect = vi.fn();
    const sheet = new SplitConfirmSheetComponent({
      intents: INTENTS,
      onSelect,
      onCancel: vi.fn(),
    });
    const lines = sheet.render(80);
    expect(lines.some((line) => line.includes('Split into 3 jobs'))).toBe(true);
    expect(lines.some((line) => line.includes('Fix login'))).toBe(true);
    sheet.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith('keep');
  });

  it('cancels on Esc and merges via choice helper', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const onCancel = vi.fn();
    const sheet = new SplitConfirmSheetComponent({
      intents: INTENTS,
      onSelect: vi.fn(),
      onCancel,
    });
    sheet.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();

    const merged = resolveSplitConfirmChoice(INTENTS, 'merge');
    expect(merged).toHaveLength(1);
    expect(merged?.[0]?.prompt).toContain('Fix login');
    expect(resolveSplitConfirmChoice(INTENTS, 'cancel')).toBeNull();
    expect(resolveSplitConfirmChoice(INTENTS, 'keep')).toEqual(INTENTS);
  });
});
