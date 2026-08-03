/**
 * Ops Theatre — one-screen monitor: agents · goal · git · runtime health.
 * Slash: /ops — refreshes live for a few minutes while the panel stays visible.
 */

import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import {
  buildOpsTheatreInterventionTray,
  buildOpsTheatrePanes,
  DEFAULT_OPS_THEATRE_WIDTH,
  OpsTheatrePanelComponent,
  renderOpsTheatreGrid,
  type OpsTheatreInput,
} from '../../features/ops-theatre';
import {
  fleetDualEmitStatusLine,
  missionDualEmitStatusLine,
  type PermissionMode,
  type UsageStatus,
} from '@superliora/sdk';

import { resolveGoalXpOpsGlance } from '../../utils/goal/goal-glance';
import { isActiveMissionRun } from '../../utils/mission/mission-contract';

import {
  formatCacheDiagnosticsLine,
  formatCacheMissReasonOpsHealthLine,
} from '../../utils/cache/cache-diagnostics';
import { resolveCacheHitSources } from '../../utils/cache/cache-glance';
import { formatCacheFreezeOpsHealthLine } from '../../utils/cache/cache-freeze-line';
import {
  loadFleetBudgetGlance,
  resolveFleetParallelToolsGlanceFromStatus,
  type FleetParallelToolsGlance,
} from '../../utils/fleet/fleet-glance';
import { resolveFleetCostGuardOpsLine } from '../../utils/fleet/fleet-cost-guard-glance';
import { formatOpsTokenGlance } from '../../utils/usage/ops-token-glance';
import {
  resolveSearchCascadeOpsHealthLines,
  staleSearchCascadeClearPatch,
} from '../../utils/search/search-cascade';
import { formatLocalResearchCacheOpsHealthLine } from '../../utils/search/local-research-cache-glance';
import { formatSearchNeverEmptyOpsHealthLine } from '../../utils/search/search-never-empty-telemetry';
import {
  formatHostTtftLine,
  formatHostTtftP50Line,
  resolveHostRuntimeMode,
} from '../../utils/host/host-glance';
import { formatOpsRouteLine } from '../../utils/model/route-glance';
import { formatOpsAuthLineFromSessionStatus } from '../../utils/never-halt/auth-glance';
import { resolveOpsBreakerLineFromAppState } from '../../utils/never-halt/breaker-glance';
import {
  activeRuntimeDegraded,
  staleRuntimeDegradedClearPatch,
} from '../../utils/never-halt/runtime-degraded';
import { formatErrorMessage } from '../../utils/event-payload';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { isMotionTheatreActive } from '../../utils/render/motion-beats';
import { tickGitChurnSpark } from '../../utils/git/git-churn-spark';
import { createGitStatusCache } from '#/utils/git/git-status';
import { collectGitDiff } from '#/utils/git/git-diff';
import { collectOpsGitDiffSnippetLines } from '../../features/ops-theatre/build-panes';

import type { SlashCommandHost } from '../hub/dispatch';
import { detectSearchProviderEnvKeys, detectSearchLateChannelEnv, formatSearchLateChannelOpsSuffix } from '../config/search/search-status';

const OPS_REFRESH_MS = 2_000;
const OPS_REFRESH_MAX_TICKS = 90; // ~3 minutes

export async function showOpsTheatre(host: SlashCommandHost): Promise<void> {
  let lines = await buildOpsLines(host);
  let ticks = 0;

  host.motionBeats.play({
    name: 'status_open',
    seed: 'ops',
    title: 'Ops',
    nowMs: appearanceAnimationNow(),
    theatreActive: isMotionTheatreActive(host.state.appState),
  });

  const panel = new OpsTheatrePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Ops Theatre ',
    enterBeatSeed: 'ops',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
    hasPendingApproval: () => host.state.livePane.pendingApproval !== null,
    onFocusApproval: () => {
      host.focusPendingApprovalPanel();
    },
    onDismiss: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(panel);
  requestTUILayoutRender(host.state);

  const timer = setInterval(() => {
    ticks += 1;
    if (ticks > OPS_REFRESH_MAX_TICKS) {
      clearInterval(timer);
      return;
    }
    void buildOpsLines(host)
      .then((next) => {
        lines = next;
        panel.invalidate();
        requestTUILayoutRender(host.state);
      })
      .catch(() => {
        /* keep last snapshot */
      });
  }, OPS_REFRESH_MS);

  // Avoid keeping the interval if the process tears down the TUI early.
  const unref = (timer as NodeJS.Timeout & { unref?: () => void }).unref;
  unref?.call(timer);
}

async function buildOpsLines(host: SlashCommandHost): Promise<string[]> {
  const input = await collectOpsTheatreInput(host);
  const panes = buildOpsTheatrePanes(input);
  const grid = renderOpsTheatreGrid(panes, DEFAULT_OPS_THEATRE_WIDTH);
  const intervention = buildOpsTheatreInterventionTray({
    pendingApprovalToolName: input.pendingApprovalToolName,
    interventionCount: input.interventionCount,
    staleInterventionCount: input.staleInterventionCount,
    oldestInterventionAgeMs: input.oldestInterventionAgeMs,
  });
  return [...grid, ...intervention];
}

async function collectOpsTheatreInput(host: SlashCommandHost): Promise<OpsTheatreInput> {
  const session = host.requireSession();
  const gitStatus = createGitStatusCache(session.workDir).getStatus();
  const refreshedAt = new Date().toLocaleTimeString();
  const fleetBudgetUsd = loadFleetBudgetGlance().budgetUsd ?? undefined;

  let goal: OpsTheatreInput['goal'] = null;
  let goalSnapshot = host.state.appState.goal ?? null;
  try {
    if (goalSnapshot == null) {
      const { goal: remoteGoal } = await session.getGoal();
      goalSnapshot = remoteGoal;
    }
    if (goalSnapshot != null) {
      goal = {
        status: goalSnapshot.status,
        objective: goalSnapshot.objective,
        xpGlance: resolveGoalXpOpsGlance({
          goal: goalSnapshot,
          appState: host.state.appState,
        }),
      };
    }
  } catch {
    goal = 'unavailable';
  }

  let mcpLine = 'MCP: (none)';
  try {
    const servers = await session.listMcpServers();
    if (servers.length > 0) {
      const connected = servers.filter((s) => s.status === 'connected').length;
      const failed = servers.filter((s) => s.status === 'failed' || s.status === 'needs-auth').length;
      mcpLine = `MCP: ${String(connected)}/${String(servers.length)} connected${
        failed > 0 ? ` · ${String(failed)} need attention` : ''
      }`;
    }
  } catch (error) {
    mcpLine = `MCP: error · ${formatErrorMessage(error)}`;
  }

  let sessionsLine = 'Sessions: (unknown)';
  try {
    const sessions = await host.harness.listSessions({ workDir: session.workDir });
    sessionsLine = `Sessions: ${String(sessions.length)} in workspace`;
  } catch {
    sessionsLine = 'Sessions: (list unavailable)';
  }

  let cacheHitLine = resolveCacheHitSources({
    appStateCacheMeter: host.state.appState.cacheMeter,
  }).line;
  let cachePrefixLine: string | null = null;
  let cacheMissReasonLine: string | null = null;
  let cacheFreezeLine: string | null = null;
  let tokenGlanceLine = formatOpsTokenGlance({
    costUsd: host.state.appState.sessionCostUsd,
    budgetUsd: fleetBudgetUsd,
  });
  const staleDegradedPatch = staleRuntimeDegradedClearPatch(host.state.appState.runtimeDegraded);
  if (staleDegradedPatch !== null) host.setAppState(staleDegradedPatch);
  const staleCascadePatch = staleSearchCascadeClearPatch(host.state.appState.searchCascade);
  if (staleCascadePatch !== null) host.setAppState(staleCascadePatch);
  const degraded = activeRuntimeDegraded(host.state.appState.runtimeDegraded);

  let routeLine = formatOpsRouteLine({
    providerRouteStatus: host.state.appState.providerRouteStatus,
    lastModelRouteNotice: host.state.appState.lastModelRouteNotice,
    availableModels: host.state.appState.availableModels,
  });
  let interventionCount: number | undefined;
  let staleInterventionCount: number | undefined;
  let oldestInterventionAgeMs: number | undefined;
  let parallelToolsGlance: FleetParallelToolsGlance | undefined;
  let neverEmptyTelemetryLine: string | null = null;
  let localResearchCacheHitLine: string | null = null;
  let sessionStatusForAuth: unknown;
  let permissionFromSession: PermissionMode | undefined;
  let missionRun: OpsTheatreInput['missionRun'];
  const ultraworkMode = host.state.appState.ultraworkMode === true;
  const modelProvider =
    host.state.appState.model.trim().length > 0
      ? host.state.appState.availableModels[host.state.appState.model]?.provider
      : undefined;
  let statusContextOS = host.state.appState.contextOS ?? null;
  try {
    const status = await session.getStatus();
    sessionStatusForAuth = status;
    statusContextOS = status.contextOS ?? statusContextOS;
    if (goal != null && goal !== 'unavailable') {
      goal = {
        ...goal,
        xpGlance: resolveGoalXpOpsGlance({
          goal: goalSnapshot,
          appState: host.state.appState,
          statusContextOS,
        }),
      };
    }
    const usage = status.usage as UsageStatus | undefined;
    neverEmptyTelemetryLine = formatSearchNeverEmptyOpsHealthLine(usage);
    localResearchCacheHitLine = formatLocalResearchCacheOpsHealthLine(usage);
    cacheHitLine = resolveCacheHitSources({
      appStateCacheMeter: host.state.appState.cacheMeter,
      statusHitRate: status.cacheHitRate,
      statusWarmStreak: status.cacheWarmStreak,
    }).line;
    cachePrefixLine =
      formatCacheDiagnosticsLine(usage?.cacheDiagnostics)?.line ?? null;
    cacheMissReasonLine = formatCacheMissReasonOpsHealthLine(usage);
    cacheFreezeLine = formatCacheFreezeOpsHealthLine(
      status.cacheFrozen,
      status.cacheFreezeViolations,
    );
    tokenGlanceLine = formatOpsTokenGlance({
      usage: status.usage,
      cacheHitRate: status.cacheHitRate,
      costUsd: host.state.appState.sessionCostUsd,
      budgetUsd: fleetBudgetUsd,
    });
    if (status.circuitBreakers !== undefined) {
      host.setAppState({ circuitBreakers: status.circuitBreakers });
    }
    routeLine = formatOpsRouteLine({
      providerRouteStatus: status.providerRouteStatus ?? host.state.appState.providerRouteStatus,
      lastModelRouteNotice: host.state.appState.lastModelRouteNotice,
      availableModels: host.state.appState.availableModels,
    });
    if (typeof status.pendingInterventions === 'number') {
      interventionCount = status.pendingInterventions;
    }
    if (typeof status.staleInterventions === 'number') {
      staleInterventionCount = status.staleInterventions;
    }
    if (typeof status.oldestInterventionAgeMs === 'number') {
      oldestInterventionAgeMs = status.oldestInterventionAgeMs;
    }
    parallelToolsGlance = resolveFleetParallelToolsGlanceFromStatus(status);
    permissionFromSession = status.permission;
  } catch {
    /* keep default */
  }

  try {
    const run = await session.getUltraworkRun();
    if (run != null) {
      missionRun = {
        active: isActiveMissionRun(run),
        status: run.status,
        stage: run.stage,
        objective: run.objective,
      };
    } else if (ultraworkMode) {
      missionRun = { active: false, status: 'awaiting' };
    }
  } catch {
    if (ultraworkMode) {
      missionRun = { active: false, status: 'awaiting' };
    }
  }

  const search = detectSearchProviderEnvKeys();
  const late = detectSearchLateChannelEnv();
  const { cascadeLine, researchHopsLine } = resolveSearchCascadeOpsHealthLines(
    host.state.appState.searchCascade,
  );

  const breakerLine = resolveOpsBreakerLineFromAppState(
    host.state.appState.circuitBreakers,
    degraded,
  );

  const runtimeMode = resolveHostRuntimeMode(host.harness, process.env);
  const lastStepTtft = host.state.appState.lastStepTtft ?? null;
  const lastStepTtftLine =
    lastStepTtft != null ? formatHostTtftLine(lastStepTtft, runtimeMode) : null;
  const ttftWindow = host.state.appState.lastStepTtftMsWindow ?? null;
  const lastStepTtftP50Line =
    ttftWindow != null && ttftWindow.length > 0
      ? formatHostTtftP50Line(ttftWindow, runtimeMode)
      : null;

  let gitChurnDelta: number | undefined;
  let gitDiffSnippet: readonly string[] | undefined;
  if (gitStatus != null) {
    const spark = tickGitChurnSpark(
      session.workDir,
      gitStatus.dirty,
      gitStatus.changedFileCount,
    );
    if (spark != null) {
      host.setAppState({ gitChurn: spark });
      gitChurnDelta = spark.count;
    }
    if (gitStatus.dirty) {
      const diffReport = collectGitDiff(session.workDir);
      if (diffReport != null && diffReport.files.length > 0) {
        gitDiffSnippet = collectOpsGitDiffSnippetLines(diffReport.files);
      }
    }
  }

  return {
    refreshedAt,
    sessionsLine,
    fleetWorkers: undefined,
    goal,
    git:
      gitStatus == null
        ? null
        : {
            branch: gitStatus.branch,
            dirty: gitStatus.dirty,
            changedFileCount: gitStatus.changedFileCount,
            diffAdded: gitStatus.diffAdded,
            diffDeleted: gitStatus.diffDeleted,
            ahead: gitStatus.ahead,
            behind: gitStatus.behind,
            changedFiles: gitStatus.changedFiles,
            ...(gitDiffSnippet != null && gitDiffSnippet.length > 0
              ? { diffSnippet: gitDiffSnippet }
              : {}),
            ...(gitChurnDelta != null ? { churnDelta: gitChurnDelta } : {}),
          },
    cwd: session.workDir,
    mcpLine,
    cacheHitLine,
    cachePrefixLine,
    cacheMissReasonLine,
    cacheFreezeLine,
    tokenGlanceLine,
    lastStepTtftLine,
    lastStepTtftP50Line,
    breakerLine,
    authLine: formatOpsAuthLineFromSessionStatus({
      degraded,
      secretsMissing:
        host.state.appState.lastModelRouteNotice?.reason === 'provider-credential',
      showOkTip: true,
      status: sessionStatusForAuth,
      providers: host.state.appState.availableProviders,
      providerId: modelProvider,
    }),
    routeLine,
    search: {
      configured: search.configured,
      searchDegraded: degraded?.scope === 'search',
      lateChannelSuffix: formatSearchLateChannelOpsSuffix(late),
      cascadeLine,
      researchHopsLine,
      neverEmptyTelemetryLine,
      localResearchCacheHitLine,
    },
    degraded:
      degraded != null
        ? {
            scope: degraded.scope,
            reason: degraded.reason,
            hint: degraded.hint,
          }
        : null,
    model: host.state.appState.model,
    permissionMode: host.state.appState.permissionMode,
    permissionFromSession,
    pendingApprovalToolName: host.state.livePane.pendingApproval?.data.tool_name ?? null,
    interventionCount: interventionCount ?? host.state.appState.interventionCount,
    staleInterventionCount:
      staleInterventionCount ?? host.state.appState.staleInterventionCount,
    oldestInterventionAgeMs:
      oldestInterventionAgeMs ?? host.state.appState.oldestInterventionAgeMs,
    parallelTools: parallelToolsGlance,
    makerCheckerSoftWarn: host.state.appState.makerCheckerSoftWarn,
    costGuardOpsLine: resolveFleetCostGuardOpsLine({
      governanceWarn: host.state.appState.makerCheckerSoftWarn,
      sessionCostUsd: host.state.appState.sessionCostUsd,
    }),
    goalSoftAdvisory: host.state.appState.goalSoftAdvisory,
    missionRun,
    ultraworkMode,
    missionDualEmitLine: missionDualEmitStatusLine(),
    fleetDualEmitLine: fleetDualEmitStatusLine(),
  };
}

