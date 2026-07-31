import { describe, expect, it, vi } from 'vitest';

import { showMediaSettings } from '#/tui/commands/config/media-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import {
  buildMediaSettingsLines,
  formatFallbackEffectiveLine,
  loadMediaSettingsGlance,
  resolveModelVisionSupport,
} from '#/tui/utils/media/media-glance';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

describe('media glance', () => {
  it('detects vision support from model capabilities', () => {
    expect(
      resolveModelVisionSupport({
        model: 'text-only',
        availableModels: {
          'text-only': { provider: 'test', model: 'text-only', maxContextSize: 128_000, capabilities: ['tool_use'] },
        },
      }),
    ).toEqual({ supportsImageIn: false, supportsVideoIn: false });

    expect(
      resolveModelVisionSupport({
        model: 'vision',
        availableModels: {
          vision: { provider: 'test', model: 'vision', maxContextSize: 128_000, capabilities: ['image_in', 'video_in'] },
        },
      }),
    ).toEqual({ supportsImageIn: true, supportsVideoIn: true });
  });

  it('formats analyze fallback when model lacks vision', () => {
    const line = formatFallbackEffectiveLine(
      loadMediaSettingsGlance({
        policy: 'analyze',
        model: 'text-only',
        availableModels: {
          'text-only': { provider: 'test', model: 'text-only', maxContextSize: 128_000, capabilities: ['tool_use'] },
        },
        configPath: '/home/.superliora/config.toml',
      }),
    );
    expect(line).toContain('analyze');
  });

  it('builds tip-heavy panel with live policy and model lines', () => {
    const text = buildMediaSettingsLines(
      loadMediaSettingsGlance({
        policy: 'path',
        model: 'gpt-text',
        availableModels: {
          'gpt-text': { provider: 'test', model: 'gpt-text', maxContextSize: 128_000, capabilities: ['tool_use'] },
        },
        configPath: '/home/.superliora/config.toml',
      }),
    ).join('\n');
    expect(text).toContain('Fallback policy: path');
    expect(text).toContain('Current model: gpt-text');
    expect(text).toContain('nonVisionFallback');
    expect(text).toContain('/media');
  });
});

describe('showMediaSettings', () => {
  it('mounts read-only media panel with live config policy', async () => {
    const host = {
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
            'text-only': { provider: 'test', model: 'text-only', maxContextSize: 128_000, capabilities: ['tool_use'] },
          },
        },
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as unknown as SlashCommandHost;

    showMediaSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Fallback policy: block');
    expect(host.harness.getConfig).toHaveBeenCalledWith({ reload: true });
  });
});
