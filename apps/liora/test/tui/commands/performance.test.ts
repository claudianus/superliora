import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handlePerformanceCommand,
  showPerformanceSettings,
} from '#/tui/commands/config/appearance/performance';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES, DEFAULT_PERFORMANCE_MODE } from '#/tui/config';

vi.mock('#/tui/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/tui/config')>();
  return {
    ...actual,
    saveTuiConfig: vi.fn(async () => undefined),
  };
});

import { saveTuiConfig } from '#/tui/config';

beforeEach(() => {
  vi.mocked(saveTuiConfig).mockClear();
});

function makeHost(options: {
  performanceMode?: 'off' | 'auto' | 'on';
  appearance?: typeof DEFAULT_APPEARANCE_PREFERENCES;
} = {}) {
  return {
    state: {
      appState: {
        theme: 'auto',
        appearance: options.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
        performanceMode: options.performanceMode ?? DEFAULT_PERFORMANCE_MODE,
        permissionMode: 'yolo',
        disablePasteBurst: false,
        editorCommand: null,
        notifications: { enabled: true, condition: 'unfocused' },
        upgrade: { autoInstall: true },
        locale: 'auto',
      },
      transcriptContainer: { addChild: vi.fn() },
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
    showError: vi.fn(),
    setAppState: vi.fn(),
    setTranscriptDetail: vi.fn(),
    setNeatMode: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost;
}

describe('handlePerformanceCommand', () => {
  it('persists performance mode via saveTuiConfig and updates appState', async () => {
    const host = makeHost({ performanceMode: 'off' });
    await handlePerformanceCommand(host, 'auto');

    expect(saveTuiConfig).toHaveBeenCalled();
    const saved = vi.mocked(saveTuiConfig).mock.calls.at(-1)?.[0];
    expect(saved).toMatchObject({ performanceMode: 'auto' });
    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({ performanceMode: 'auto' }),
    );
  });

  it('rejects unknown values', async () => {
    const host = makeHost();
    await handlePerformanceCommand(host, 'turbo');
    expect(host.showError).toHaveBeenCalled();
    expect(saveTuiConfig).not.toHaveBeenCalled();
  });

  it('opens picker when args empty', async () => {
    const host = makeHost({ performanceMode: 'off' });
    await handlePerformanceCommand(host, '');
    expect(host.mountCenterModal).toHaveBeenCalled();
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      opts: { currentValue?: string; options: readonly { value: string }[] };
    };
    expect(picker.opts.currentValue).toBe('off');
    expect(picker.opts.options.map((o) => o.value)).toEqual(['off', 'auto', 'on']);
  });
});

describe('showPerformanceSettings', () => {
  it('mounts off|auto|on picker with current mode', () => {
    const host = makeHost({ performanceMode: 'on' });
    showPerformanceSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const opts = (picker as unknown as {
      opts: { currentValue?: string; options: readonly { value: string }[] };
    }).opts;
    expect(opts.currentValue).toBe('on');
    expect(opts.options.map((o) => o.value)).toEqual(['off', 'auto', 'on']);
  });
});
