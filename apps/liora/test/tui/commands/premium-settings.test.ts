import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showPremiumSettings } from '#/tui/commands/config/premium/premium-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';
import type { RendererDiagnosticsSnapshot } from '#/tui/renderer';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(options: {
  premiumQualityMode?: boolean;
  appearance?: typeof DEFAULT_APPEARANCE_PREFERENCES;
  diagnostics?: RendererDiagnosticsSnapshot;
  getStatus?: () => Promise<{ premiumQualityMode?: boolean }>;
  hasSession?: boolean;
} = {}) {
  const session = {
    getStatus:
      options.getStatus ??
      vi.fn(async () => ({
        premiumQualityMode: options.premiumQualityMode === true,
      })),
  };

  return {
    state: {
      appState: {
        premiumQualityMode: options.premiumQualityMode === true,
        appearance: options.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
      },
      transcriptContainer: { addChild: vi.fn() },
      renderer: {
        invalidateFrame: vi.fn(),
        nativeRuntime:
          options.diagnostics !== undefined
            ? { diagnostics: options.diagnostics }
            : undefined,
      },
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => session),
  } as unknown as SlashCommandHost;
}

const ENV_KEYS = ['TERM', 'CI', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const;

describe('showPremiumSettings', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env['TERM'] = 'xterm-256color';
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('renders live Visual Quality + motion budget lines when session is wired', async () => {
    setAppearanceRenderQuality('balanced');
    setAppearanceRenderHealth('watch');

    const host = makeHost({
      premiumQualityMode: true,
      appearance: {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
        animationFps: 60,
      },
      diagnostics: {
        frames: 2,
        avgFrameBudgetRatio: 0.85,
        quality: { level: 'balanced' },
      } as RendererDiagnosticsSnapshot,
    });

    showPremiumSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Visual Quality: ON');
    expect(text).toContain('profile premium');
    expect(text).toContain('Render quality: balanced');
    expect(text).toContain('frame health: watch');
    expect(text).toContain('Motion budget:');
    expect(text).toContain('frame budget 85% avg');
  });

  it('still renders from appState when session is unavailable', async () => {
    const host = makeHost({ hasSession: false, premiumQualityMode: false });
    showPremiumSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Visual Quality: OFF');
    expect(text).toContain('awaiting first frame');
  });
});
