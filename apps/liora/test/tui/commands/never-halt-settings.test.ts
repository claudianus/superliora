import { describe, expect, it, vi } from 'vitest';

import {
  NEVER_HALT_BREAKER_TIP,
  NEVER_HALT_INTERVENTION_TIP,
  NEVER_HALT_OAUTH_TIP,
  NEVER_HALT_SEARCH_FALLBACK_TIP,
  showNeverHaltSettings,
} from '#/tui/commands/config/never-halt/never-halt-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

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
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
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

function selectNeverHaltAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('never-halt settings tips', () => {
  it('exports search fallback, oauth, intervention, and breaker tips', () => {
    expect(NEVER_HALT_SEARCH_FALLBACK_TIP).toContain('free fallback');
    expect(NEVER_HALT_SEARCH_FALLBACK_TIP).toContain('Settings → Search');
    expect(NEVER_HALT_OAUTH_TIP).toContain('ensureFresh');
    expect(NEVER_HALT_OAUTH_TIP).toContain('Settings → Accounts');
    expect(NEVER_HALT_INTERVENTION_TIP).toContain('Fleet workers');
    expect(NEVER_HALT_INTERVENTION_TIP).toContain('parallel');
    expect(NEVER_HALT_BREAKER_TIP).toContain('half-open');
    expect(NEVER_HALT_BREAKER_TIP).toContain('runtime.degraded');
  });
});

describe('showNeverHaltSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions', () => {
    const host = makeHost();
    showNeverHaltSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'tip-search-fallback',
      'tip-oauth',
      'tip-intervention',
      'tip-breaker',
    ]);
  });

  it('shows search fallback tip via showStatus', () => {
    const host = makeHost();
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'tip-search-fallback');
    expect(host.showStatus).toHaveBeenCalledWith(NEVER_HALT_SEARCH_FALLBACK_TIP, 'info');
  });

  it('shows oauth tip via showStatus', () => {
    const host = makeHost();
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'tip-oauth');
    expect(host.showStatus).toHaveBeenCalledWith(NEVER_HALT_OAUTH_TIP, 'info');
  });

  it('shows intervention tip via showStatus', () => {
    const host = makeHost();
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'tip-intervention');
    expect(host.showStatus).toHaveBeenCalledWith(NEVER_HALT_INTERVENTION_TIP, 'info');
  });

  it('shows breaker tip via showStatus', () => {
    const host = makeHost();
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'tip-breaker');
    expect(host.showStatus).toHaveBeenCalledWith(NEVER_HALT_BREAKER_TIP, 'info');
  });

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
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

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
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

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
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

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
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

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
    showNeverHaltSettings(host);
    selectNeverHaltAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.render(100).join('\n');
    expect(text).toContain('Live queue: (clear)');
  });
});
