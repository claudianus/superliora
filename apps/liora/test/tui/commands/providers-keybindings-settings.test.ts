import { describe, expect, it, vi } from 'vitest';

import { showProvidersApiSettings } from '#/tui/commands/config/providers-api-settings';
import { showKeybindingsSettings } from '#/tui/commands/config/keybindings-settings';

function makeHost(options?: {
  readonly session?: {
    getStatus: () => Promise<{ model?: string; providerRouteStatus?: unknown }>;
    getTools?: () => Promise<Array<{ name: string; active: boolean }>>;
  };
}) {
  return {
    state: {
      transcriptContainer: { addChild: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
      appState: {
        model: 'kimi-k2',
        availableModels: {
          'kimi-k2': {
            displayName: 'Kimi K2',
            model: 'kimi-k2-upstream',
            provider: 'moonshot',
          },
        },
        availableProviders: { moonshot: {} },
      },
    },
    requireSession: () => {
      if (options?.session === undefined) {
        throw new Error('no session');
      }
      return options.session;
    },
  } as never;
}

describe('providers-api settings panel', () => {
  it('mounts read-only providers panel', async () => {
    const host = makeHost();
    showProvidersApiSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('Providers & API (read-only)');
    expect(lines).toContain('/login');
    expect(lines).toContain('W11 OSS absorb');
    expect(lines).toContain('no active session');
  });

  it('wires live provider/model from session.getStatus', async () => {
    const host = makeHost({
      session: {
        getStatus: async () => ({
          model: 'kimi-k2',
          providerRouteStatus: { primary: true },
        }),
        getTools: async () => [{ name: 'WebSearch', active: true }],
      },
    });
    showProvidersApiSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('── Session (live) ─');
    expect(lines).toContain('Active model: Kimi K2 (kimi-k2) · live session confirms');
    expect(lines).toContain('Active provider: moonshot · upstream kimi-k2-upstream');
    expect(lines).toContain('Route: primary');
  });
});

describe('keybindings settings panel', () => {
  it('mounts read-only keybindings panel', () => {
    const host = makeHost();
    showKeybindingsSettings(host);

    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('Keyboard / Keybindings (read-only)');
    expect(lines).toContain('Live registry (keymap.ts)');
    expect(lines).toContain('Mission / Ops / Fleet samples');
    expect(lines).toContain('/help');
    expect(lines).toContain('Shift-Tab');
  });
});
