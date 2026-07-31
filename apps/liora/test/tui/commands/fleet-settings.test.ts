import { describe, expect, it, vi } from 'vitest';

import { showFleetSettings } from '#/tui/commands/config/fleet-settings';
import { FLEET_IMPORT_PATH_TIPS, FLEET_PROTOCOL_ALIAS_TIPS } from '#/tui/commands/config/fleet-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import {
  buildFleetSessionLiveLines,
  buildFleetCostGuardSettingsLines,
  buildFleetWorktreeSettingsLines,
  FLEET_BUDGET_USD_ENV,
  FLEET_COST_GUARD_TIP,
  FLEET_GOVERNANCE_TIPS,
  FLEET_PARALLEL_SPEEDUP_TIP,
  FLEET_PARALLEL_SPEEDUP_TIP_KO,
  FLEET_WORKTREE_ENV,
  FLEET_WORKTREE_TIP_KO,
  formatFleetMakerCheckerSoftLiveLine,
  formatFleetWorktreeEnvLiveLine,
  formatFleetWorkersSettingsLine,
  loadFleetBudgetGlance,
  loadFleetWorktreeGlance,
  OPS_FLEET_MAKER_CHECKER_SOFT_TIP,
  OPS_FLEET_WORKTREE_TIP,
} from '#/tui/utils/fleet/fleet-glance';
import { FLEET_DUAL_EMIT_ENV } from '@superliora/sdk';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

describe('fleet settings governance tips', () => {
  it('documents import-path soft rename via fleet facade', () => {
    const text = FLEET_IMPORT_PATH_TIPS.join('\n');
    expect(text).toContain('Hard rename pending');
    expect(text).toContain('#/fleet');
    expect(text).toContain('@superliora/sdk/fleet');
    expect(text).toContain('not #/collaboration');
  });

  it('documents agent-core evidence gate and budget governor for Settings panel', () => {
    const text = FLEET_GOVERNANCE_TIPS.join('\n');
    expect(text).toContain('Maker≠Checker');
    expect(text).toContain('swarm-evidence-gate');
    expect(text).toContain('swarm-budget');
    expect(text).toContain('≥2');
  });

  it('documents W4 parallel speedup soft KPI in governance tips', () => {
    expect(FLEET_PARALLEL_SPEEDUP_TIP).toContain('Parallel speedup');
    expect(FLEET_GOVERNANCE_TIPS).toContain(FLEET_PARALLEL_SPEEDUP_TIP);
    expect(FLEET_PARALLEL_SPEEDUP_TIP_KO).toContain('병렬');
  });

  it('documents env-gated fleet dual-emit and read-side normalize', () => {
    const text = FLEET_PROTOCOL_ALIAS_TIPS.join('\n');
    expect(text).toContain(FLEET_DUAL_EMIT_ENV);
    expect(text).toContain('SUPERLIORA_SOVEREIGN=1');
    expect(text).toContain('never journal');
    expect(text).toContain('normalize');
    expect(text).toContain('golden sequences');
  });
});

describe('fleet worktree isolation settings', () => {
  it('detects SUPERLIORA_FLEET_WORKTREE opt-in env', () => {
    expect(loadFleetWorktreeGlance({ [FLEET_WORKTREE_ENV]: '1' }).envEnabled).toBe(true);
    expect(loadFleetWorktreeGlance({ [FLEET_WORKTREE_ENV]: 'true' }).envEnabled).toBe(true);
    expect(loadFleetWorktreeGlance({}).envEnabled).toBe(false);
  });

  it('builds worktree block with env off and orchestrator path', () => {
    const lines = buildFleetWorktreeSettingsLines(
      loadFleetWorktreeGlance({}),
      false,
    ).join('\n');
    expect(lines).toContain(FLEET_WORKTREE_ENV);
    expect(lines).toContain('Orchestrator: OFF');
    expect(lines).toContain('SpawnWorker');
    expect(lines).toContain('AgentSwarm/UltraSwarm');
    expect(lines).toContain('per-worker git worktrees');
    expect(lines).toContain('--worktree');
  });

  it('surfaces env-on soft opt-in when SUPERLIORA_FLEET_WORKTREE=1', () => {
    const lines = buildFleetWorktreeSettingsLines(
      loadFleetWorktreeGlance({ [FLEET_WORKTREE_ENV]: '1' }),
      true,
    ).join('\n');
    expect(lines).toContain(`${FLEET_WORKTREE_ENV}=ON`);
    expect(lines).toContain('Orchestrator: ON');
    expect(lines).toContain('AgentSwarm/UltraSwarm attempt per-worker worktrees');
  });

  it('summarizes worktree isolation in Korean brief', () => {
    expect(FLEET_WORKTREE_TIP_KO).toContain('SUPERLIORA_FLEET_WORKTREE=1');
    expect(FLEET_WORKTREE_TIP_KO).toContain('worktreeDir');
  });
});

describe('fleet cost guard settings', () => {
  it('detects SUPERLIORA_FLEET_BUDGET_USD env cap', () => {
    expect(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '5' }).budgetUsd).toBe(5);
    expect(loadFleetBudgetGlance({}).budgetUsd).toBeNull();
  });

  it('builds Cost Guard block with tip and soft check when env is set', () => {
    const lines = buildFleetCostGuardSettingsLines(
      loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '10' }),
      2.5,
    ).join('\n');
    expect(lines).toContain('Cost Guard (soft)');
    expect(lines).toContain(FLEET_COST_GUARD_TIP);
    expect(lines).toContain('Soft check:');
    expect(lines).toContain('$2.50');
    expect(lines).toContain('$10.00');
  });
});

describe('fleet session live settings', () => {
  it('formats orchestrator worker counts', () => {
    expect(
      formatFleetWorkersSettingsLine({
        orchestratorWorkers: [
          { status: 'running' },
          { status: 'running' },
          { status: 'completed' },
        ],
      }),
    ).toContain('2 running');
    expect(
      formatFleetWorkersSettingsLine({
        orchestratorWorkers: [
          { status: 'running' },
          { status: 'running' },
          { status: 'completed' },
        ],
      }),
    ).toContain('3 orchestrator');
  });

  it('builds Session (live) with parallel tools from getStatus', () => {
    const lines = buildFleetSessionLiveLines({
      orchestratorWorkers: [{ status: 'running' }],
      parallelTools: { parallelToolsInFlight: 2, maxParallelTools: 4 },
      worktree: loadFleetWorktreeGlance({ [FLEET_WORKTREE_ENV]: '1' }),
    }).join('\n');
    expect(lines).toContain('── Session (live) ─');
    expect(lines).toContain('Workers:');
    expect(lines).toContain('Parallel tools: 2 in flight · peak 4');
    expect(lines).toContain(OPS_FLEET_MAKER_CHECKER_SOFT_TIP);
    expect(lines).toContain(`${FLEET_WORKTREE_ENV}=ON`);
  });

  it('builds Session (live) with worktree env off tip when unset', () => {
    const lines = buildFleetSessionLiveLines({
      worktree: loadFleetWorktreeGlance({}),
    }).join('\n');
    expect(lines).toContain(`${FLEET_WORKTREE_ENV}: off`);
  });

  it('shows worktree env off compact tip when glance unwired', () => {
    const lines = buildFleetSessionLiveLines({}).join('\n');
    expect(lines).toContain(OPS_FLEET_WORKTREE_TIP);
  });

  it('surfaces live maker-checker soft warn in Session (live) when wired', () => {
    const warn =
      'Maker≠Checker (soft): expert auth-bot both implements and reviews — restaff checker (swarm-maker-checker).';
    expect(formatFleetMakerCheckerSoftLiveLine(warn)).toBe(warn);
    const lines = buildFleetSessionLiveLines({
      makerCheckerSoftWarn: warn,
    }).join('\n');
    expect(lines).toContain(warn);
  });

  it('shows live worker and parallel tool lines when session getStatus is wired', async () => {
    const host = {
      state: {
        appState: {
          swarmMode: false,
          orchestratorMode: true,
          permissionMode: 'auto',
          orchestratorWorkers: [{ id: 'w1', description: 'lint', status: 'running' }],
          sessionCostUsd: undefined,
        },
        swarmModeEntry: undefined,
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
      harness: {
        getConfig: vi.fn(async () => ({ background: { maxRunningTasks: 4 } })),
        listSessions: vi.fn(async () => [{ id: 'a' }]),
      },
      requireSession: vi.fn(() => ({
        workDir: '/tmp/fleet-ws',
        getStatus: vi.fn(async () => ({
          parallelToolsInFlight: 2,
          maxParallelTools: 3,
        })),
        listBackgroundTasks: vi.fn(async () => []),
      })),
    } as unknown as SlashCommandHost;

    showFleetSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('1 running');
    expect(text).toContain('Parallel tools: 2 in flight · peak 3');
    expect(text).toContain(`${FLEET_WORKTREE_ENV}: off`);
  });

  it('shows live worktree env ON in fleet settings when SUPERLIORA_FLEET_WORKTREE=1', async () => {
    const prev = process.env[FLEET_WORKTREE_ENV];
    process.env[FLEET_WORKTREE_ENV] = '1';
    try {
      const host = {
        state: {
          appState: {
            swarmMode: false,
            orchestratorMode: false,
            permissionMode: 'auto',
            orchestratorWorkers: undefined,
            sessionCostUsd: undefined,
          },
          swarmModeEntry: undefined,
          transcriptContainer: { addChild: vi.fn() },
          renderer: { invalidateFrame: vi.fn() },
        },
        harness: {
          getConfig: vi.fn(async () => ({})),
          listSessions: vi.fn(async () => []),
        },
        requireSession: vi.fn(() => ({
          workDir: '/tmp/fleet-ws',
          getStatus: vi.fn(async () => ({})),
          listBackgroundTasks: vi.fn(async () => []),
        })),
      } as unknown as SlashCommandHost;

      showFleetSettings(host);
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('── Session (live) ─');
      expect(text).toContain(`${FLEET_WORKTREE_ENV}=ON`);
    } finally {
      if (prev === undefined) {
        delete process.env[FLEET_WORKTREE_ENV];
      } else {
        process.env[FLEET_WORKTREE_ENV] = prev;
      }
    }
  });

  it('shows live maker-checker warn from appState in fleet settings panel', async () => {
    const warn =
      'Maker≠Checker (soft): expert lint both implements and reviews (swarm-maker-checker).';
    const host = {
      state: {
        appState: {
          swarmMode: true,
          orchestratorMode: false,
          permissionMode: 'auto',
          orchestratorWorkers: undefined,
          sessionCostUsd: undefined,
          makerCheckerSoftWarn: warn,
        },
        swarmModeEntry: undefined,
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
      harness: {
        getConfig: vi.fn(async () => ({})),
        listSessions: vi.fn(async () => []),
      },
      requireSession: vi.fn(() => ({
        workDir: '/tmp/fleet-ws',
        getStatus: vi.fn(async () => ({})),
        listBackgroundTasks: vi.fn(async () => []),
      })),
    } as unknown as SlashCommandHost;

    showFleetSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain(warn);
  });
});
