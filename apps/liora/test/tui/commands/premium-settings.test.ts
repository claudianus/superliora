import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PREMIUM_DENSITY_TIP,
  PREMIUM_MOTION_TIP,
  PREMIUM_PQ_TIP,
  showPremiumSettings,
} from '#/tui/commands/config/premium/premium-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
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
      centerModalStack: [] as readonly unknown[],
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
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectPremiumAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

const ENV_KEYS = ['TERM', 'CI', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const;

describe('premium settings tips', () => {
  it('exports motion, density, and Visual Quality tips', () => {
    expect(PREMIUM_MOTION_TIP).toContain('profile auto|off|subtle|premium');
    expect(PREMIUM_MOTION_TIP).toContain('/appearance');
    expect(PREMIUM_DENSITY_TIP).toContain('transcript-detail');
    expect(PREMIUM_DENSITY_TIP).toContain('/transcript');
    expect(PREMIUM_PQ_TIP).toContain('/premium on|off|status');
    expect(PREMIUM_PQ_TIP).toContain('anti-slop');
  });
});

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

  it('mounts ChoicePicker with status and read-only tip actions', () => {
    const host = makeHost();
    showPremiumSettings(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    const options = (
      (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        opts: { options: readonly { value: string }[] };
      }
    ).opts.options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'tip-motion',
      'tip-density',
      'tip-pq',
    ]);
  });

  it('shows motion, density, and PQ tips via showStatus', () => {
    const host = makeHost();
    showPremiumSettings(host);
    selectPremiumAction(host, 'tip-motion');
    expect(host.showStatus).toHaveBeenCalledWith(PREMIUM_MOTION_TIP, 'info');
    selectPremiumAction(host, 'tip-density');
    expect(host.showStatus).toHaveBeenCalledWith(PREMIUM_DENSITY_TIP, 'info');
    selectPremiumAction(host, 'tip-pq');
    expect(host.showStatus).toHaveBeenCalledWith(PREMIUM_PQ_TIP, 'info');
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
    selectPremiumAction(host, 'status');
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
    selectPremiumAction(host, 'status');
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
