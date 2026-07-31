import { describe, expect, it, vi } from 'vitest';

import { showCacheSettings } from '#/tui/commands/config/cache/cache-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(options: {
  cacheMeter?: { rate: number; streak: number } | null;
  getStatus?: () => Promise<Record<string, unknown>>;
  hasSession?: boolean;
} = {}) {
  const session = {
    getStatus:
      options.getStatus ??
      vi.fn(async () => ({
        cacheHitRate: 0.995,
        cacheWarmStreak: 5,
        cacheFrozen: false,
        usage: { cacheDiagnostics: { toolBlockChanged: false } },
      })),
  };
  return {
    state: {
      appState: {
        cacheMeter: options.cacheMeter ?? null,
      },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => session),
  } as unknown as SlashCommandHost;
}

describe('showCacheSettings', () => {
  it('shows Session (live) section with hit rate and streak from getStatus', async () => {
    const host = makeHost();
    await showCacheSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('── Session (live) ──');
    expect(text).toContain('streak×5');
    expect(text).toContain('Status: warm');
    expect(text).toContain('Prefix: stable');
  });

  it('shows mid-turn freeze tip in Cache Sacred rules', async () => {
    const host = makeHost();
    await showCacheSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('Mid-turn: CacheFreezeGuard');
    expect(text).toContain('Freeze: idle');
  });

  it('shows active freeze line when getStatus reports mid-turn freeze', async () => {
    const host = makeHost({
      getStatus: vi.fn(async () => ({
        cacheHitRate: 0.995,
        cacheWarmStreak: 3,
        cacheFrozen: true,
        usage: { cacheDiagnostics: { toolBlockChanged: false } },
      })),
    });
    await showCacheSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('Freeze: active (mid-turn)');
    expect(text).toContain('streak×3');
  });

  it('uses AppState cacheMeter when getStatus is unavailable', async () => {
    const host = makeHost({
      cacheMeter: { rate: 0.995, streak: 6 },
      hasSession: false,
    });
    await showCacheSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('streak×6');
    expect(text).toContain('Status: warm');
  });
});
