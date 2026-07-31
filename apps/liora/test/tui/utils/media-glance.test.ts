import { describe, expect, it } from 'vitest';

import {
  buildMediaSettingsLines,
  formatFallbackEffectiveLine,
  loadMediaSettingsGlance,
  resolveModelVisionSupport,
} from '#/tui/utils/media/media-glance';

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
