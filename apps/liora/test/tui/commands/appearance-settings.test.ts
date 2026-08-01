import { describe, expect, it, vi } from 'vitest';

import {
  APPEARANCE_BACKGROUND_TIP,
  APPEARANCE_CHANGE_TIP,
  APPEARANCE_MOTION_TIP,
  APPEARANCE_THEME_TIP,
  showAppearanceSettings,
  showTranscriptDetailPicker,
} from '#/tui/commands/config/appearance/appearance-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme, lightColors } from '#/tui/theme';

function makeHost(options: {
  theme?: string;
  appearance?: typeof DEFAULT_APPEARANCE_PREFERENCES;
} = {}) {
  return {
    state: {
      appState: {
        theme: options.theme ?? 'auto',
        appearance: options.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
      },
      transcriptContainer: { addChild: vi.fn() },
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
    setAppState: vi.fn(),
    setTranscriptDetail: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectAppearanceAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('appearance settings tips', () => {
  it('exports theme, motion, background, and change tips', () => {
    expect(APPEARANCE_THEME_TIP).toContain('Settings → Theme');
    expect(APPEARANCE_MOTION_TIP).toContain('/appearance');
    expect(APPEARANCE_BACKGROUND_TIP).toContain('transcript-detail');
    expect(APPEARANCE_CHANGE_TIP).toContain('Settings → Appearance');
  });
});

describe('showAppearanceSettings', () => {
  it('mounts ChoicePicker with live actions and tip rows', () => {
    const host = makeHost();
    showAppearanceSettings(host);
    const options = (
      (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        opts: { options: readonly { value: string }[] };
      }
    ).opts.options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'theme',
      'profile',
      'density',
      'transcript-detail',
      'particles',
      'animation-fps',
      'timestamps',
      'canvas-background',
      'terminal-background',
      'terminal-palette',
      'tip-theme',
      'tip-motion',
      'tip-background',
      'tip-change',
    ]);
  });

  it('shows theme, motion, background, and change tips via showStatus', () => {
    const host = makeHost();
    showAppearanceSettings(host);
    selectAppearanceAction(host, 'tip-theme');
    expect(host.showStatus).toHaveBeenCalledWith(APPEARANCE_THEME_TIP, 'info');
    selectAppearanceAction(host, 'tip-motion');
    expect(host.showStatus).toHaveBeenCalledWith(APPEARANCE_MOTION_TIP, 'info');
    selectAppearanceAction(host, 'tip-background');
    expect(host.showStatus).toHaveBeenCalledWith(APPEARANCE_BACKGROUND_TIP, 'info');
    selectAppearanceAction(host, 'tip-change');
    expect(host.showStatus).toHaveBeenCalledWith(APPEARANCE_CHANGE_TIP, 'info');
  });

  it('opens a transcript detail picker with current level marked', () => {
    const host = makeHost({
      appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, transcriptDetail: 'compact' },
    });
    showAppearanceSettings(host);
    selectAppearanceAction(host, 'transcript-detail');
    expect(host.mountCenterModal).toHaveBeenCalledTimes(2);
    const nested = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
      opts: {
        title: string;
        currentValue?: string;
        options: readonly { value: string }[];
      };
    };
    expect(nested.opts.title).toBe('Transcript detail');
    expect(nested.opts.currentValue).toBe('compact');
    expect(nested.opts.options.map((o) => o.value)).toEqual([
      'minimal',
      'compact',
      'standard',
      'full',
    ]);
  });

  it('renders live theme from appState and currentTheme', () => {
    const previousPalette = currentTheme.palette;
    currentTheme.setPalette(lightColors);

    const host = makeHost({ theme: 'auto' });
    showAppearanceSettings(host);
    selectAppearanceAction(host, 'status');

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Theme: auto · live palette light (tracking terminal)');
    expect(text).toContain('── Session (live) ─');

    currentTheme.setPalette(previousPalette);
  });
});

describe('showTranscriptDetailPicker', () => {
  it('mounts a four-level density picker', () => {
    const host = makeHost({
      appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, transcriptDetail: 'full' },
    });
    showTranscriptDetailPicker(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      opts: { currentValue?: string; options: readonly { value: string }[] };
    };
    expect(picker.opts.currentValue).toBe('full');
    expect(picker.opts.options.map((o) => o.value)).toEqual([
      'minimal',
      'compact',
      'standard',
      'full',
    ]);
  });
});
