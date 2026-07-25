import { describe, expect, it, vi } from 'vitest';

import { ContextWorkingSetSelectorComponent } from '#/tui/components/dialogs/context-working-set-selector';

const ENTER = '\r';
const ESC = '\u001B';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('ContextWorkingSetSelectorComponent', () => {
  it('renders preset labels and a 1M window notice', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const picker = new ContextWorkingSetSelectorComponent({
      currentPresetId: 'balanced',
      maxContextTokens: 1_000_000,
      onSelect,
      onCancel,
    });

    const lines = picker.render(80).map(strip).join('\n');
    expect(lines).toContain('Context working set');
    expect(lines).toContain('Balanced (Recommended)');
    expect(lines).toContain('Economy');
    expect(lines).toContain('Deep context');
    expect(lines).toContain('Full model window');
    expect(lines).toContain('1M');
  });

  it('applies the highlighted preset on Enter', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const picker = new ContextWorkingSetSelectorComponent({
      currentPresetId: 'balanced',
      maxContextTokens: 1_000_000,
      onSelect,
      onCancel,
    });

    picker.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith('balanced');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const picker = new ContextWorkingSetSelectorComponent({
      onSelect,
      onCancel,
    });
    picker.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
