import type {
  AllProvidersUsageSnapshot,
} from '@superliora/sdk';
import { resolveGlobalLogPath, resolveSessionLogPath } from '@superliora/sdk';

import {
  buildStatusReportLines,
  createStatusFieldMotionState,
} from '../../components/messages/status-panel/index';
import { buildUsageReportLines, buildContextCompositionLines, UsagePanelComponent, type ManagedUsageReport } from '../../components/messages/usage-panel/index';
import { QuotaOverlayComponent } from '../../components/messages/usage-panel/quota-overlay';
import {
  rememberOpenSurface,
  SURFACE_QUOTA,
  toggleOffOpenSurface,
} from '../../features/surfaces/editor-surface-toggle';
import { isManagedUsageProvider } from '../../constant/liora-tui';
import { formatUpstreamBaselineSummary } from '#/cli/upstream-baseline';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { resolveLiveQuotaSnapshot } from '#/tui/utils/usage/quota-glance';
import { createGitStatusCache } from '#/utils/git/git-status';
import { getDataDir } from '#/utils/paths';
import type { SlashCommandHost } from '../hub/dispatch';
import { ttui } from '../../utils/tui-i18n';

import {
  loadContextComposition,
  loadManagedUsageReport,
  loadRuntimeStatusReport,
  loadSessionUsageReport,
} from './info-loaders';

function playStatusOpenBeat(host: SlashCommandHost, title: string, seed: string): void {
  host.motionBeats.play({
    name: 'status_open',
    seed,
    title,
    nowMs: appearanceAnimationNow(),
  });
}

export async function showUsage(host: SlashCommandHost): Promise<void> {
  const [sessionUsage, composition] = await Promise.all([
    loadSessionUsageReport(host),
    loadContextComposition(host),
  ]);
  const alias = host.state.appState.model;
  const providerKey = host.state.appState.availableModels[alias]?.provider;
  const managedProvider = isManagedUsageProvider(providerKey);

  const reportState: {
    managedUsage?: ManagedUsageReport;
    managedUsageError?: string;
  } = {
    managedUsage: managedProvider
      ? {
          summary: null,
          limits: [],
          accounts: [
            {
              accountKey: 'loading',
              summary: null,
              limits: [],
              status: 'loading',
              isPrimary: true,
            },
          ],
        }
      : undefined,
    managedUsageError: undefined,
  };

  const buildLines = (fillProgress: number) => {
    const lines = buildUsageReportLines({
      sessionUsage: sessionUsage.usage,
      sessionUsageError: sessionUsage.error,
      contextUsage: host.state.appState.contextUsage,
      contextTokens: host.state.appState.contextTokens,
      maxContextTokens: host.state.appState.maxContextTokens,
      managedUsage: reportState.managedUsage,
      managedUsageError: reportState.managedUsageError,
      managedUsageFillProgress: fillProgress,
      providerQuota: host.state.appState.providerQuota,
    });
    if (composition !== undefined) {
      lines.push('');
      lines.push(...buildContextCompositionLines(composition));
    }
    return lines;
  };

  playStatusOpenBeat(host, 'Usage', 'usage');
  const panel = new UsagePanelComponent({
    buildLines,
    borderToken: 'primary',
    title: ttui('tui.panel.usage'),
    enterBeatSeed: 'usage',
    phase: managedProvider ? 'loading' : 'ready',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);

  if (!managedProvider) return;

  const managedUsage = await loadManagedUsageReport(host);
  if (managedUsage === undefined) {
    reportState.managedUsage = undefined;
    reportState.managedUsageError = undefined;
    panel.setPhase('ready');
    requestTUILayoutRender(host.state);
    return;
  }
  reportState.managedUsage = managedUsage.usage;
  reportState.managedUsageError = managedUsage.error;
  panel.setPhase('ready');
  requestTUILayoutRender(host.state);
}

export async function showQuota(host: SlashCommandHost): Promise<void> {
  // Bare repeat Q toggles an already-open Quota overlay shut (editor has been
  // replaced), instead of re-fetching and stacking a duplicate report.
  if (toggleOffOpenSurface(host, SURFACE_QUOTA)) return;
  const sessionUsage = await loadSessionUsageReport(host);
  let quota: AllProvidersUsageSnapshot | null = host.state.appState.providerQuota ?? null;
  try {
    quota = await host.harness.auth.getAllProvidersUsage({ refresh: true });
    host.setAppState({ providerQuota: quota });
  } catch {
    // Keep the last snapshot; the panel still overlays last-response headers.
  }
  const liveQuota = resolveLiveQuotaSnapshot(quota, host.state.appState.providerRouteStatus);

  const buildLines = () => {
    const lines: string[] = [];
    if (liveQuota === null || liveQuota.providers.length === 0) {
      lines.push('No provider quota data available.', '', 'Run /login to connect a provider.');
    } else {
      lines.push(
        ...buildUsageReportLines({
          contextUsage: 0,
          contextTokens: 0,
          maxContextTokens: 0,
          providerQuota: liveQuota,
          providerQuotaOnly: true,
        }),
      );
    }
    const cost = host.state.appState.sessionCostUsd;
    if (sessionUsage.usage !== undefined || (typeof cost === 'number' && cost > 0)) {
      lines.push('');
      lines.push('This session (estimate — not remaining quota)');
      if (typeof cost === 'number' && cost > 0) {
        lines.push(`  spend  $${cost.toFixed(2)}  (catalog pricing)`);
      }
      if (sessionUsage.error !== undefined) {
        lines.push(`  ${sessionUsage.error}`);
      }
    }
    return lines;
  };

  playStatusOpenBeat(host, 'Quota', 'quota');
  const panel = new QuotaOverlayComponent({
    buildLines,
    borderToken: 'primary',
    title: ttui('tui.panel.quotas'),
    onCancel: () => {
      host.restoreEditor();
    },
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.mountEditorReplacement(panel);
  rememberOpenSurface(SURFACE_QUOTA, panel);
  requestTUILayoutRender(host.state);
}

export async function showStatusReport(host: SlashCommandHost): Promise<void> {
  const [runtimeStatus, managedUsage, config] = await Promise.all([
    loadRuntimeStatusReport(host),
    loadManagedUsageReport(host),
    host.harness.getConfig(),
  ]);
  const appState = host.state.appState;
  const privacyTelemetryEnabled = config.telemetry === true;
  const fieldMotion = createStatusFieldMotionState();
  const homeDir = host.harness.homeDir ?? getDataDir();
  const sessionDir = host.session?.summary?.sessionDir;
  const reportArgs = {
    version: appState.version,
    model: appState.model,
    workDir: appState.workDir,
    sessionId: appState.sessionId,
    globalLogPath: resolveGlobalLogPath(homeDir),
    sessionLogPath:
      sessionDir !== undefined && sessionDir.trim().length > 0
        ? resolveSessionLogPath(sessionDir)
        : undefined,
    sessionTitle: appState.sessionTitle,
    thinking: appState.thinking,
    permissionMode: appState.permissionMode,
    contextUsage: appState.contextUsage,
    contextTokens: appState.contextTokens,
    maxContextTokens: appState.maxContextTokens,
    availableModels: appState.availableModels,
    availableProviders: appState.availableProviders,
    providerRouteStatus: runtimeStatus.status?.providerRouteStatus ?? appState.providerRouteStatus,
    lastProviderRouteSelection: appState.lastProviderRouteSelection ?? null,
    lastModelRouteNotice: appState.lastModelRouteNotice ?? null,
    status: runtimeStatus.status,
    statusError: runtimeStatus.error,
    privacyTelemetryEnabled,
    gitStatus: createGitStatusCache(appState.workDir).getStatus(),
    managedUsage: managedUsage?.usage,
    managedUsageError: managedUsage?.error,
    upstreamBaseline: formatUpstreamBaselineSummary(),
    fieldMotion,
  };
  // When the session has 2+ Conductor jobs, open the outcome board (Job Deck)
  // instead of only the usage/status panel — same key/slash, no third board.
  const jobs = host.state.appState.conductorJobs?.jobs ?? [];
  if (jobs.length >= 2) {
    host.jobBoardController.openDeck();
    return;
  }

  playStatusOpenBeat(host, 'Status', 'status');
  const panel = new UsagePanelComponent({
    buildLines: () => buildStatusReportLines(reportArgs),
    borderToken: 'primary',
    title: ttui('tui.panel.status'),
    enterBeatSeed: 'status',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

