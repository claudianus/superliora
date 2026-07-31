import { describe, expect, it, vi } from 'vitest';

import { showNeverHaltSettings } from '#/tui/commands/config/never-halt/never-halt-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(options: {
  circuitBreakers?: {
    closed: number;
    open: number;
    halfOpen: number;
    lastTripReason?: string;
    scopes?: ReadonlyArray<{
      id: string;
      state: string;
      failures: number;
      lastTripReason?: string;
    }>;
  } | null;
  hasSession?: boolean;
  getStatus?: () => Promise<Record<string, unknown>>;
} = {}) {
  const session = {
    getStatus:
      options.getStatus ??
      vi.fn(async () => ({
        circuitBreakers: {
          closed: 1,
          open: 0,
          halfOpen: 0,
        },
      })),
  };
  return {
    state: {
      appState: {
        circuitBreakers: options.circuitBreakers ?? null,
        availableProviders: [],
        availableModels: {},
        model: '',
        runtimeDegraded: null,
      },
      transcriptContainer: { addChild: vi.fn() },
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

describe('showNeverHaltSettings', () => {
  it('uses AppState circuitBreakers when getStatus is unavailable', async () => {
    const host = makeHost({
      hasSession: false,
      circuitBreakers: {
        closed: 2,
        open: 1,
        halfOpen: 0,
        lastTripReason: 'provider 429 burst',
        scopes: [{ id: 'llm:primary', state: 'open', failures: 4, lastTripReason: '429 burst' }],
      },
    });
    await showNeverHaltSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('Last trip: provider 429 burst');
    expect(text).toContain('llm:primary: open');
  });

  it('prefers live getStatus over AppState registry snapshot', async () => {
    const host = makeHost({
      circuitBreakers: {
        closed: 0,
        open: 9,
        halfOpen: 0,
        lastTripReason: 'stale trip',
      },
      getStatus: vi.fn(async () => ({
        circuitBreakers: {
          closed: 3,
          open: 0,
          halfOpen: 1,
          lastTripReason: 'live trip',
        },
      })),
    });
    await showNeverHaltSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('1 half');
    expect(text).toContain('Last trip: live trip');
    expect(text).not.toContain('stale trip');
  });

  it('shows live intervention queue depth from getStatus', async () => {
    const host = makeHost({
      getStatus: vi.fn(async () => ({
        circuitBreakers: { closed: 1, open: 0, halfOpen: 0 },
        pendingInterventions: 2,
        staleInterventions: 1,
        oldestInterventionAgeMs: 125_000,
      })),
    });
    await showNeverHaltSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Never-Halt queue: 2 pending');
    expect(text).toContain('Goal/Mission/Fleet continue');
    expect(text).toContain('stale×1');
  });

  it('surfaces ask-mode Fleet continue in the permission queue section', async () => {
    const host = makeHost();
    await showNeverHaltSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('Ask mode: one approval waits in Ops tray');
    expect(text).toContain('Independent tool_calls proceed in parallel');
  });

  it('shows clear queue when getStatus reports zero pending interventions', async () => {
    const host = makeHost({
      getStatus: vi.fn(async () => ({
        circuitBreakers: { closed: 1, open: 0, halfOpen: 0 },
        pendingInterventions: 0,
      })),
    });
    await showNeverHaltSettings(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('Live queue: (clear)');
  });
});
