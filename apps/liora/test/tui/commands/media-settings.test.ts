import { describe, expect, it, vi } from 'vitest';

import {
  MEDIA_ANALYZE_TIP,
  MEDIA_BLOCK_TIP,
  MEDIA_PATH_TIP,
  showMediaSettings,
} from '#/tui/commands/config/media/media-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeMediaHost() {
  return {
    harness: {
      homeDir: '/home/.superliora',
      configPath: '/home/.superliora/config.toml',
      getConfig: vi.fn(async () => ({ media: { nonVisionFallback: 'block' } })),
    },
    state: {
      appState: {
        model: 'text-only',
        nonVisionFallbackPolicy: 'analyze',
        availableModels: {
          'text-only': {
            provider: 'test',
            model: 'text-only',
            maxContextSize: 128_000,
            capabilities: ['tool_use'],
          },
        },
      },
      transcriptContainer: { addChild: vi.fn() },
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectMediaAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('media settings tips', () => {
  it('still exports tip strings for glance/status (not menu rows)', () => {
    expect(MEDIA_ANALYZE_TIP).toContain('analyze');
    expect(MEDIA_ANALYZE_TIP).toContain('vision-capable');
    expect(MEDIA_PATH_TIP).toContain('path');
    expect(MEDIA_PATH_TIP).toContain('pointer');
    expect(MEDIA_BLOCK_TIP).toContain('block');
    expect(MEDIA_BLOCK_TIP).toContain('image_in');
  });
});

describe('showMediaSettings', () => {
  it('mounts ChoicePicker with real actions only (no tip rows)', () => {
    const host = makeMediaHost();
    showMediaSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'presets',
      'status',
      'change-policy',
      'change-model',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('mounts read-only media panel with live config policy', async () => {
    const host = makeMediaHost();
    showMediaSettings(host);
    selectMediaAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Fallback policy: block');
    expect(host.harness.getConfig).toHaveBeenCalledWith({ reload: true });
  });
});
