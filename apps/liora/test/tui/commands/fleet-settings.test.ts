import { describe, expect, it, vi } from 'vitest';

import { showFleetSettings } from '#/tui/commands/config/fleet/fleet-settings';
import { FLEET_IMPORT_PATH_TIPS, FLEET_PROTOCOL_ALIAS_TIPS } from '#/tui/commands/config/fleet/fleet-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import {
  buildFleetMaxRunningTasksConfigPatch,
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

function selectFleetAction(host: SlashCommandHost, value: string, callIndex = 0): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[callIndex]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

function makeFleetHost(options: {
  appState?: Record<string, unknown>;
  getConfig?: () => Promise<Record<string, unknown>>;
  listSessions?: () => Promise<readonly unknown[]>;
  requireSession?: () => Record<string, unknown>;
} = {}) {
  return {
    state: {
      appState: {
        swarmMode: false,
        permissionMode: 'auto',
        sessionCostUsd: undefined,
        ...options.appState,
      },
      swarmModeEntry: undefined,
      centerModalStack: [] as readonly unknown[],
      transcriptContainer: { addChild: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    harness: {
      getConfig: options.getConfig ?? vi.fn(async () => ({})),
      listSessions: options.listSessions ?? vi.fn(async () => []),
      setConfig: vi.fn(async () => undefined),
    },
    requireSession:
      options.requireSession ??
      vi.fn(() => ({
        workDir: '/tmp/fleet-ws',
        getStatus: vi.fn(async () => ({})),
        listBackgroundTasks: vi.fn(async () => []),
      })),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

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

  it('builds worktree block with env off', () => {
    const lines = buildFleetWorktreeSettingsLines(loadFleetWorktreeGlance({})).join('\n');
    expect(lines).toContain(FLEET_WORKTREE_ENV);
    expect(lines).toContain('AgentSwarm/UltraSwarm');
    expect(lines).toContain('per-worker git worktrees');
    expect(lines).toContain('--worktree');
  });

  it('surfaces env-on soft opt-in when SUPERLIORA_FLEET_WORKTREE=1', () => {
    const lines = buildFleetWorktreeSettingsLines(
      loadFleetWorktreeGlance({ [FLEET_WORKTREE_ENV]: '1' }),
    ).join('\n');
    expect(lines).toContain(`${FLEET_WORKTREE_ENV}=ON`);
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

});

describe('showFleetSettings picker', () => {
  it('mounts ChoicePicker with status, max-workers, and tip actions — tip-free', () => {
    const host = makeFleetHost();
    showFleetSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'max-workers',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('persists max workers via harness.setConfig', async () => {
    const host = makeFleetHost();
    showFleetSettings(host);
    selectFleetAction(host, 'max-workers');
    selectFleetAction(host, '4', 1);
    await vi.waitFor(() => {
      expect(host.harness.setConfig).toHaveBeenCalledWith(
        buildFleetMaxRunningTasksConfigPatch(4),
      );
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'Max background workers → 4 (background.maxRunningTasks).',
      'success',
    );
  });

});

describe('showFleetSettings panel', () => {
  it('formats background worker counts', () => {
    expect(
      formatFleetWorkersSettingsLine({
        backgroundActive: { bash: 2, agent: 1 },
      }),
    ).toContain('2 bash · 1 agent');
    expect(
      formatFleetWorkersSettingsLine({
        backgroundActive: { bash: 2, agent: 1 },
      }),
    ).toContain('background active');
    expect(formatFleetWorkersSettingsLine({})).toBe(
      'Workers: none active — /fleet to spawn',
    );
  });

  it('builds Session (live) with parallel tools from getStatus', () => {
    const lines = buildFleetSessionLiveLines({
      parallelTools: { parallelToolsInFlight: 2, maxParallelTools: 4 },
      worktree: loadFleetWorktreeGlance({ [FLEET_WORKTREE_ENV]: '1' }),
    }).join('\n');
    expect(lines).toContain('── Session (live) ─');
    expect(lines).toContain('Workers:');
    expect(lines).toContain('Parallel tools: 2 in flight · peak 4');
    expect(lines).toContain(OPS_FLEET_MAKER_CHECKER_SOFT_TIP);
    expect(lines).toContain(`${FLEET_WORKTREE_ENV}=ON`);
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
    const host = makeFleetHost({
      appState: {
        swarmMode: false,
        permissionMode: 'auto',
        sessionCostUsd: undefined,
      },
      getConfig: vi.fn(async () => ({ background: { maxRunningTasks: 4 } })),
      listSessions: vi.fn(async () => [{ id: 'a' }]),
      requireSession: vi.fn(() => ({
        workDir: '/tmp/fleet-ws',
        getStatus: vi.fn(async () => ({
          parallelToolsInFlight: 2,
          maxParallelTools: 3,
        })),
        listBackgroundTasks: vi.fn(async () => []),
      })),
    });

    showFleetSettings(host);
    selectFleetAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Workers: none active — /fleet to spawn');
    expect(text).toContain('Parallel tools: 2 in flight · peak 3');
    expect(text).toContain(`${FLEET_WORKTREE_ENV}: off`);
    expect(text).toContain('background.maxRunningTasks = 4');
  });

  it('shows live worktree env ON in fleet settings when SUPERLIORA_FLEET_WORKTREE=1', async () => {
    const prev = process.env[FLEET_WORKTREE_ENV];
    process.env[FLEET_WORKTREE_ENV] = '1';
    try {
      const host = makeFleetHost({
        requireSession: vi.fn(() => ({
          workDir: '/tmp/fleet-ws',
          getStatus: vi.fn(async () => ({})),
          listBackgroundTasks: vi.fn(async () => []),
        })),
      });

      showFleetSettings(host);
      selectFleetAction(host, 'status');
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
    const host = makeFleetHost({
      appState: {
        swarmMode: true,
        permissionMode: 'auto',
        sessionCostUsd: undefined,
        makerCheckerSoftWarn: warn,
      },
      requireSession: vi.fn(() => ({
        workDir: '/tmp/fleet-ws',
        getStatus: vi.fn(async () => ({})),
        listBackgroundTasks: vi.fn(async () => []),
      })),
    });

    showFleetSettings(host);
    selectFleetAction(host, 'status');
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
