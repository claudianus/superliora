/**
 * Settings → Fleet / Parallel — read-only glance + tips (SSOT §9.2).
 * No fake budget/worker toggles until Fleet config schema lands.
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import {
  buildFleetSessionLiveLines,
  buildFleetCostGuardSettingsLines,
  buildFleetWorktreeSettingsLines,
  FLEET_GOVERNANCE_TIPS,
  loadFleetBudgetGlance,
  loadFleetWorktreeGlance,
  resolveFleetParallelToolsGlanceFromStatus,
  type FleetSessionLiveGlance,
} from '../../utils/fleet/fleet-glance';
import { countActiveBackgroundTasks } from '../../utils/session/message-replay';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  FLEET_DUAL_EMIT_ENV,
  fleetDualEmitStatusLine,
} from '@superliora/sdk';

import type { SlashCommandHost } from '../hub/dispatch';

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
  void showFleetSettingsPanel(host);
}

async function loadFleetSessionLiveGlance(host: SlashCommandHost): Promise<FleetSessionLiveGlance> {
  const glance: FleetSessionLiveGlance = {
    orchestratorWorkers: host.state.appState.orchestratorWorkers,
    makerCheckerSoftWarn: host.state.appState.makerCheckerSoftWarn,
    worktree: loadFleetWorktreeGlance(),
  };

  try {
    const session = host.requireSession();
    const status = await session.getStatus();
    glance.parallelTools = resolveFleetParallelToolsGlanceFromStatus(status);

    if (glance.orchestratorWorkers == null || glance.orchestratorWorkers.length === 0) {
      const tasks = await session.listBackgroundTasks({ activeOnly: true }).catch(() => undefined);
      if (tasks != null && tasks.length > 0) {
        const counts = countActiveBackgroundTasks(
          new Map(tasks.map((task) => [task.taskId, task])),
        );
        if (counts.bashTasks > 0 || counts.agentTasks > 0) {
          glance.backgroundActive = {
            bash: counts.bashTasks,
            agent: counts.agentTasks,
          };
        }
      }
    }
  } catch {
    glance.sessionUnavailable = true;
  }

  return glance;
}

async function showFleetSettingsPanel(host: SlashCommandHost): Promise<void> {
  const { swarmMode, orchestratorMode, permissionMode } = host.state.appState;
  let maxWorkersLine = 'Max workers: background.maxRunningTasks (config default)';
  let sessionsLine = 'Sessions in workspace: (unknown)';

  try {
    const config = await host.harness.getConfig({ reload: true });
    const maxTasks = config.background?.maxRunningTasks;
    if (maxTasks !== undefined) {
      maxWorkersLine = `Max workers: background.maxRunningTasks = ${String(maxTasks)}`;
    }
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
    '── Fleet / Parallel (read-only) ────────────',
    'Specialist delegation + parallel workers — §7.1.',
    '',
    ...buildFleetSessionLiveLines(sessionLive),
    '── Status ───────────────────────────────────',
    sessionsLine,
    `Fleet mode: ${swarmMode ? 'ON' : 'OFF'}${fleetDetail}`,
    `Orchestrator: ${orchestratorMode === true ? 'ON' : 'OFF'}`,
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
    ...buildFleetWorktreeSettingsLines(loadFleetWorktreeGlance(), orchestratorMode === true),
    '',
    '── Commands ─────────────────────────────────',
    '  /fleet              live status panel (same family as this view)',
    '  /fleet on|off       toggle fleet mode',
    '  /fleet <task>       delegate to specialists',
    '  /orchestrator       background worker pool',
    '  /ops                Fleet theatre + git diff + health',
    '',
    'No persist controls here until Fleet config schema ships.',
  ];

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Fleet ',
    enterBeatSeed: 'fleet-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
