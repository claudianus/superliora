import { describe, expect, it, vi } from 'vitest';

import {
  showThemeSettings,
  THEME_APPEARANCE_TIP,
  THEME_CUSTOM_TIP,
  THEME_IMPORT_TIP,
} from '#/tui/commands/config/appearance/theme-settings';
import { showThemePicker } from '#/tui/commands/config/appearance/editor-theme';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme, darkColors } from '#/tui/theme';

vi.mock('#/tui/commands/config/appearance/editor-theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/tui/commands/config/appearance/editor-theme')>();
  return {
    ...actual,
    showThemePicker: vi.fn(),
  };
});

function makeThemeHost() {
  const transcriptContainer = { addChild: vi.fn() };
  return {
    state: {
      transcriptContainer,
      centerModalStack: [] as readonly unknown[],
      appState: { theme: 'dark' },
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectThemeAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('theme settings tips', () => {
  it('exports custom, import, and appearance tips (glance copy, not menu rows)', () => {
    expect(THEME_CUSTOM_TIP).toContain('~/.superliora/themes');
    expect(THEME_IMPORT_TIP).toContain('/theme import');
    expect(THEME_APPEARANCE_TIP).toContain('Settings → Appearance');
  });
});

describe('showThemeSettings', () => {
  it('mounts ChoicePicker with status, picker, and tip actions — tip-free', () => {
    const host = makeThemeHost();
    showThemeSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'change-theme',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('opens theme picker for change-theme action', () => {
    const host = makeThemeHost();
    showThemeSettings(host);
    selectThemeAction(host, 'change-theme');
    expect(showThemePicker).toHaveBeenCalledWith(host);
  });

  it('mounts read-only theme panel for status action', () => {
    const previousPalette = currentTheme.palette;
    currentTheme.setPalette(darkColors);

    const host = makeThemeHost();
    showThemeSettings(host);
    selectThemeAction(host, 'status');

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('§9.2');
    expect(lines).toContain('Theme: dark · live palette dark');
    expect(lines).toContain('/theme import');

    currentTheme.setPalette(previousPalette);
  });
});
