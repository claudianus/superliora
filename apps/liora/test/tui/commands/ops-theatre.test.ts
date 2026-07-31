import { describe, expect, it, vi } from 'vitest';

import { showOpsTheatre } from '#/tui/commands/ops/ops-theatre';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import { OPS_FLEET_PARALLEL_FANOUT_TIP } from '#/tui/utils/fleet/fleet-glance';
import { SEARCH_CASCADE_BADGE_TTL_MS } from '#/tui/utils/search/search-cascade';

function makeHost(status: Record<string, unknown> = {}, appStateOverrides: Record<string, unknown> = {}) {
  const session = {
    workDir: '/tmp/ops-ws',
    getStatus: vi.fn(async () => ({
      permission: 'auto',
      usage: undefined,
      ...status,
    })),
    getGoal: vi.fn(async () => ({ goal: null })),
    listMcpServers: vi.fn(async () => []),
    getUltraworkRun: vi.fn(async () => null),
  };
  const host = {
    state: {
      appState: {
        model: 'kimi-model',
        workDir: '/tmp/ops-ws',
        permissionMode: 'auto',
        planMode: false,
        swarmMode: false,
        ultraworkMode: false,
        runtimeDegraded: undefined,
        lastModelRouteNotice: undefined,
        availableModels: {},
        availableProviders: {},
        goal: null,
        orchestratorWorkers: undefined,
        makerCheckerSoftWarn: null,
        goalSoftAdvisory: null,
        sessionCostUsd: undefined,
        circuitBreakers: undefined,
        providerRouteStatus: undefined,
        cacheMeter: undefined,
        searchCascade: undefined,
        contextOS: null,
        lastStepTtft: null,
        interventionCount: undefined,
        staleInterventionCount: undefined,
        oldestInterventionAgeMs: undefined,
        ...appStateOverrides,
      },
      livePane: { pendingApproval: null },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    session,
    requireSession: () => session,
    harness: {
      listSessions: vi.fn(async () => [{ id: 'ses-1' }]),
    },
    setAppState: vi.fn(),
    motionBeats: { play: vi.fn() },
    showError: vi.fn(),
  } as unknown as SlashCommandHost;
  return host;
}

describe('showOpsTheatre', () => {
  it('shows live parallel tools in Ops Fleet pane when getStatus is wired', async () => {
    const host = makeHost({ parallelToolsInFlight: 2, maxParallelTools: 3 });
    await showOpsTheatre(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.buildLines(1).join('\n');
    expect(text).toContain('Parallel tools: 2 in flight · peak 3');
    expect(text).not.toContain(OPS_FLEET_PARALLEL_FANOUT_TIP);
  });

  it('falls back to parallel fanout tip when status counters are absent', async () => {
    const host = makeHost({});
    await showOpsTheatre(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.buildLines(1).join('\n');
    expect(text).toMatch(/Parallel: independent tool_calls fan/);
  });

  it('surfaces AppState.searchCascade in Runtime Health search block', async () => {
    const nowMs = Date.now();
    const host = makeHost(
      {},
      {
        searchCascade: { channelsTried: ['ch1', 'ch3', 'ch4'], hops: 2, atMs: nowMs },
      },
    );
    await showOpsTheatre(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.buildLines(1).join('\n');
    expect(text).toContain('Cascade: ch1→ch3→ch4 · hops 2');
  });

  it('clears expired searchCascade from AppState when Ops refreshes', async () => {
    const host = makeHost(
      {},
      {
        searchCascade: {
          channelsTried: ['ch1'],
          atMs: Date.now() - SEARCH_CASCADE_BADGE_TTL_MS - 1,
        },
      },
    );
    await showOpsTheatre(host);

    expect(host.setAppState).toHaveBeenCalledWith({ searchCascade: null });
  });
});
