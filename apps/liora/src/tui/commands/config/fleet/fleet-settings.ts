/**
 * Settings → Fleet / Parallel — live glance + max workers config (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  buildFleetSessionLiveLines,
  buildFleetCostGuardSettingsLines,
  buildFleetWorktreeSettingsLines,
  FLEET_GOVERNANCE_TIPS,
  FLEET_MAX_RUNNING_TASKS_PICKER_OPTIONS,
  formatFleetMaxRunningTasksLine,
  loadFleetBudgetGlance,
  loadFleetWorktreeGlance,
  resolveFleetMaxRunningTasks,
  resolveFleetParallelToolsGlanceFromStatus,
  buildFleetMaxRunningTasksConfigPatch,
  type FleetSessionLiveGlance,
} from '../../../utils/fleet/fleet-glance';
import { countActiveBackgroundTasks } from '../../../utils/session/message-replay';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import {
  FLEET_DUAL_EMIT_ENV,
  fleetDualEmitStatusLine,
} from '@superliora/sdk';

import type { SlashCommandHost } from '../../hub/dispatch';

/** Import-path soft path — hard disk rename pending (W5). */
export const FLEET_IMPORT_PATH_TIPS = [
  'Hard rename pending: collaboration/ folder stays on disk until W5 cutover.',
  'New wiring: import via @superliora/agent-core/fleet or agent-core #/fleet (not #/collaboration).',
  'SDK apps: @superliora/sdk/fleet — wire types remain ultrawork.collaboration.* / ultrawork.swarm.*.',
] as const;

/** Protocol rename soft path — mirrors agent-core/fleet/event-alias.ts. */
export const FLEET_PROTOCOL_ALIAS_TIPS = [
  'Wire emits canonical ultrawork.collaboration.* / ultrawork.swarm.*; fleet.* accepted on read (normalize alias).',
  `Live fleet.* duplicate: opt-in ${FLEET_DUAL_EMIT_ENV}=1 or SUPERLIORA_SOVEREIGN=1 (WS/RPC only — never journal).`,
  'Journal golden sequences require dual-emit OFF; durable trace stays ultrawork.* only.',
] as const;

export { fleetDualEmitStatusLine };

export function showFleetSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Fleet / Parallel',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Fleet status',
          description: 'Live workers · parallel tools · orchestrator · evidence / budget tips.',
        },
        {
          value: 'max-workers',
          label: 'Max workers',
          description: 'harness.setConfig → background.maxRunningTasks (background/bash cap).',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showFleetSettingsPanel(host);
          return;
        }
        if (value === 'max-workers') {
          showFleetMaxWorkersPicker(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Fleet' },
  );
}

function showFleetMaxWorkersPicker(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Max background workers',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: FLEET_MAX_RUNNING_TASKS_PICKER_OPTIONS.map((option) => ({ ...option })),
      onSelect: (value) => {
        dismissPickerDialog(host);
        void setFleetMaxRunningTasks(host, Number.parseInt(value, 10));
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Fleet max workers' },
  );
}

async function setFleetMaxRunningTasks(host: SlashCommandHost, maxRunningTasks: number): Promise<void> {
  try {
    const patch = buildFleetMaxRunningTasksConfigPatch(maxRunningTasks);
    const clamped = patch.background.maxRunningTasks;
    await host.harness.setConfig(patch);
    host.showStatus(
      `Max background workers → ${String(clamped)} (background.maxRunningTasks).`,
      'success',
    );
  } catch (error) {
    host.showStatus(
      `Failed to update background.maxRunningTasks: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

async function loadFleetSessionLiveGlance(host: SlashCommandHost): Promise<FleetSessionLiveGlance> {
  const base: FleetSessionLiveGlance = {
    makerCheckerSoftWarn: host.state.appState.makerCheckerSoftWarn,
    worktree: loadFleetWorktreeGlance(),
  };

  try {
    const session = host.requireSession();
    const status = await session.getStatus();
    const parallelTools = resolveFleetParallelToolsGlanceFromStatus(status);

    let backgroundActive: FleetSessionLiveGlance['backgroundActive'];
    const tasks = await session.listBackgroundTasks({ activeOnly: true }).catch(() => undefined);
    if (tasks != null && tasks.length > 0) {
      const counts = countActiveBackgroundTasks(
        new Map(tasks.map((task) => [task.taskId, task])),
      );
      if (counts.bashTasks > 0 || counts.agentTasks > 0) {
        backgroundActive = {
          bash: counts.bashTasks,
          agent: counts.agentTasks,
        };
      }
    }

    return {
      ...base,
      ...(parallelTools !== undefined ? { parallelTools } : {}),
      ...(backgroundActive !== undefined ? { backgroundActive } : {}),
    };
  } catch {
    return { ...base, sessionUnavailable: true };
  }
}

async function showFleetSettingsPanel(host: SlashCommandHost): Promise<void> {
  const { swarmMode, permissionMode } = host.state.appState;
  let maxWorkersLine = formatFleetMaxRunningTasksLine(undefined);
  let sessionsLine = 'Sessions in workspace: (unknown)';

  try {
    const config = await host.harness.getConfig({ reload: true });
    maxWorkersLine = formatFleetMaxRunningTasksLine(resolveFleetMaxRunningTasks(config));
  } catch {
    /* keep default tip */
  }

  try {
    const session = host.requireSession();
    const sessions = await host.harness.listSessions({ workDir: session.workDir });
    sessionsLine = `Sessions in workspace: ${String(sessions.length)}`;
  } catch {
    /* optional when no session */
  }

  const sessionLive = await loadFleetSessionLiveGlance(host);

  const fleetEntry = host.state.swarmModeEntry;
  const fleetDetail =
    swarmMode && fleetEntry !== undefined ? ` · entry: ${fleetEntry}` : '';

  const lines = [
    '── Fleet / Parallel ─────────────────────────',
    'Specialist delegation + parallel workers — §7.1.',
    '',
    ...buildFleetSessionLiveLines(sessionLive),
    '── Status ───────────────────────────────────',
    sessionsLine,
    `Fleet mode: ${swarmMode ? 'ON' : 'OFF'}${fleetDetail}`,
    `Permission: ${permissionMode ?? '(unset)'}`,
    maxWorkersLine,
    '',
    '── Same-turn tool calls ─────────────────────',
    'Independent tool_calls in one turn run in parallel.',
    'Conflicting file writes serialize via agent-core ToolScheduler.',
    '',
    '── Max workers ──────────────────────────────',
    'Config key: background.maxRunningTasks (liora.toml / harness.setConfig).',
    'Caps concurrent background/bash admissions — not Fleet DAG width yet.',
    'Toggle: Settings → Fleet → Max workers → background.maxRunningTasks.',
    'Future: fleet.maxWorkers for specialist pool — not in Settings yet.',
    '',
    '── Evidence & budget (agent-core) ───────────',
    ...FLEET_GOVERNANCE_TIPS.map((tip) => `· ${tip}`),
    '',
    ...buildFleetCostGuardSettingsLines(
      loadFleetBudgetGlance(),
      host.state.appState.sessionCostUsd,
    ),
    'No budget slider here until fleet.budgetUsd schema lands.',
    '',
    '── Protocol aliases ─────────────────────────',
    fleetDualEmitStatusLine(),
    ...FLEET_PROTOCOL_ALIAS_TIPS.map((tip) => `· ${tip}`),
    '',
    '── Import path (soft rename) ────────────────',
    ...FLEET_IMPORT_PATH_TIPS.map((tip) => `· ${tip}`),
    '',
    ...buildFleetWorktreeSettingsLines(loadFleetWorktreeGlance()),
    '',
    '── Commands ─────────────────────────────────',
    '  /fleet              live status panel (same family as this view)',
    '  /fleet on|off       toggle fleet mode',
    '  /fleet <task>       delegate to specialists',
    '  /ops                Fleet theatre + git diff + health',
  ];

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Fleet ',
    enterBeatSeed: 'fleet-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
