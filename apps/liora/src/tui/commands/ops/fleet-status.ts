/**
 * Lightweight Fleet command status — sessions, swarm, permission.
 * Slash: /fleet (no args) shows panel instead of toggling swarm mode.
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { formatCacheHitMeter } from '../../utils/cache/cache-hit-meter';
import {
  formatFleetParallelToolsOpsLine,
  resolveFleetParallelToolsGlanceFromStatus,
} from '../../utils/fleet/fleet-glance';
import { formatOpsAuthLineFromSessionStatus } from '../../utils/never-halt/auth-glance';
import { resolveOpsBreakerLine } from '../../utils/never-halt/breaker-glance';
import { activeRuntimeDegraded } from '../../utils/never-halt/runtime-degraded';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { isMotionTheatreActive } from '../../utils/render/motion-beats';

import type { SlashCommandHost } from '../hub/dispatch';

export async function showFleetStatus(host: SlashCommandHost): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const lines = await buildFleetStatusLines(host);

  host.motionBeats.play({
    name: 'status_open',
    seed: 'fleet',
    title: 'Fleet',
    nowMs: appearanceAnimationNow(),
    theatreActive: isMotionTheatreActive(host.state.appState),
  });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Fleet ',
    enterBeatSeed: 'fleet',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

async function buildFleetStatusLines(host: SlashCommandHost): Promise<string[]> {
  const session = host.requireSession();
  const { swarmMode, permissionMode } = host.state.appState;
  const refreshedAt = new Date().toLocaleTimeString();

  let sessionsLine = 'Sessions: (unknown)';
  try {
    const sessions = await host.harness.listSessions({ workDir: session.workDir });
    sessionsLine = `Sessions: ${String(sessions.length)} in workspace`;
  } catch {
    sessionsLine = 'Sessions: (list unavailable)';
  }

  const fleetEntry = host.state.swarmModeEntry;
  const fleetDetail =
    swarmMode && fleetEntry !== undefined ? ` · entry: ${fleetEntry}` : '';

  const degraded = activeRuntimeDegraded(host.state.appState.runtimeDegraded);
  let cacheHitLine = formatCacheHitMeter(undefined).line;
  let breakerLine = resolveOpsBreakerLine({
    appStateBreakers: host.state.appState.circuitBreakers,
    degraded,
  });
  const modelProvider = host.state.appState.model.trim().length > 0
    ? host.state.appState.availableModels[host.state.appState.model]?.provider
    : undefined;
  let sessionStatusForAuth: unknown;
  let authLine = formatOpsAuthLineFromSessionStatus({
    degraded,
    secretsMissing:
      host.state.appState.lastModelRouteNotice?.reason === 'provider-credential',
    showOkTip: true,
    providers: host.state.appState.availableProviders,
    providerId: modelProvider,
  });
  let parallelToolsLine = formatFleetParallelToolsOpsLine(undefined);
  try {
    const status = await session.getStatus();
    sessionStatusForAuth = status;
    cacheHitLine = formatCacheHitMeter(status.cacheHitRate, status.cacheWarmStreak).line;
    breakerLine = resolveOpsBreakerLine({
      appStateBreakers: host.state.appState.circuitBreakers,
      statusBreakers: status.circuitBreakers,
      degraded,
    });
    authLine = formatOpsAuthLineFromSessionStatus({
      degraded,
      secretsMissing:
        host.state.appState.lastModelRouteNotice?.reason === 'provider-credential',
      showOkTip: true,
      status: sessionStatusForAuth,
      providers: host.state.appState.availableProviders,
      providerId: modelProvider,
    });
    parallelToolsLine = formatFleetParallelToolsOpsLine(
      resolveFleetParallelToolsGlanceFromStatus(status),
    );
  } catch {
    /* keep defaults */
  }

  return [
    `── Fleet status ──────────── ${refreshedAt} ──`,
    sessionsLine,
    `Fleet mode: ${swarmMode ? 'ON' : 'OFF'}${fleetDetail}`,
    `Permission: ${permissionMode}`,
    `Model: ${host.state.appState.model || '(unset)'}`,
    cacheHitLine,
    breakerLine,
    authLine,
    parallelToolsLine,
    'Surface: Mission/Fleet — not Ultra*.',
    '── Commands ────────────────────────────────',
    '  /fleet on|off     toggle fleet mode',
    '  /fleet <task>     specialist delegation',
    '  /mission          long-running Mission mode',
    '  /ops              full runtime theatre',
  ];
}
