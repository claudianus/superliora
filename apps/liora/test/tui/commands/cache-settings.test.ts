import { describe, expect, it, vi } from 'vitest';

import {
  invalidatePromptCache,
  showCacheSettings,
} from '#/tui/commands/config/cache/cache-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(options: {
  cacheMeter?: { rate: number; streak: number } | null;
  getStatus?: () => Promise<Record<string, unknown>>;
  getConfig?: () => Promise<Record<string, unknown>>;
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
      centerModalStack: [] as readonly unknown[],
    },
    harness: {
      getConfig:
        options.getConfig ??
        vi.fn(async () => ({
          providers: {},
          cache: { invalidateEpoch: 0 },
        })),
      setConfig: vi.fn(async () => ({ providers: {}, cache: { invalidateEpoch: 1 } })),
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => session),
    showStatus: vi.fn(),
    showError: vi.fn(),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
  } as unknown as SlashCommandHost;
}

async function openCacheStatusPanel(host: SlashCommandHost): Promise<UsagePanelComponent> {
  showCacheSettings(host);
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (value: string) => void } }).opts.onSelect('status');
  await vi.waitFor(() => {
    expect((host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(0);
  });
  return (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
    UsagePanelComponent;
}

describe('showCacheSettings status panel', () => {
  it('shows Session (live) section with hit rate and streak from getStatus', async () => {
    const host = makeHost();
    const panel = await openCacheStatusPanel(host);
    const text = panel.render(100).join('\n');
    expect(text).toContain('── Session (live) ──');
    expect(text).toContain('streak×5');
    expect(text).toContain('Status: warm');
    expect(text).toContain('Prefix: stable');
    expect(text).toContain('Cache miss dump export');
    expect(text).toContain('superliora.cache_miss.v1');
  });

  it('shows mid-turn freeze tip in Cache Sacred rules', async () => {
    const host = makeHost();
    const panel = await openCacheStatusPanel(host);
    const text = panel.render(100).join('\n');
    expect(text).toContain('Mid-turn: CacheFreezeGuard');
    expect(text).toContain('Freeze: idle');
    expect(text).toContain('Cache miss dump export');
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
    const panel = await openCacheStatusPanel(host);
    const text = panel.render(100).join('\n');
    expect(text).toContain('Freeze: active (mid-turn · step soft-check on)');
    expect(text).toContain('streak×3');
  });

  it('uses AppState cacheMeter when getStatus is unavailable', async () => {
    const host = makeHost({
      cacheMeter: { rate: 0.995, streak: 6 },
      hasSession: false,
    });
    const panel = await openCacheStatusPanel(host);
    const text = panel.render(100).join('\n');
    expect(text).toContain('streak×6');
    expect(text).toContain('Status: warm');
  });
});

describe('invalidatePromptCache', () => {
  it('bumps cache.invalidateEpoch via setConfig and shows status', async () => {
    const setConfig = vi.fn(async () => ({ providers: {}, cache: { invalidateEpoch: 1 } }));
    const getConfig = vi.fn(async () => ({ providers: {}, cache: { invalidateEpoch: 0 } }));
    const showStatus = vi.fn();
    const host = {
      harness: { getConfig, setConfig },
      showStatus,
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await invalidatePromptCache(host);

    expect(setConfig).toHaveBeenCalledWith({ cache: { invalidateEpoch: 1 } });
    expect(showStatus).toHaveBeenCalledWith(expect.stringContaining('epoch v1'), 'warning');
  });
});
