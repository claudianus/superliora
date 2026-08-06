import type {
  ContextOSRetrievalDiagnostics,
  McpServerInfo,
  AllProvidersUsageSnapshot,
} from '@superliora/sdk';
import { resolveGlobalLogPath, resolveSessionLogPath } from '@superliora/sdk';

import { buildMcpStatusReportLines } from '../../components/messages/mcp-status-panel';
import {
  buildStatusReportLines,
  createStatusFieldMotionState,
} from '../../components/messages/status-panel/index';
import { buildUsageReportLines, buildContextCompositionLines, UsagePanelComponent, type ManagedUsageReport } from '../../components/messages/usage-panel/index';
import { isManagedUsageProvider } from '../../constant/liora-tui';
import { formatUpstreamBaselineSummary } from '#/cli/upstream-baseline';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { formatErrorMessage } from '../../utils/event-payload';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { createGitStatusCache } from '#/utils/git/git-status';
import { getDataDir } from '#/utils/paths';
import { loadPreflightHumanWriting } from '../preflight/human-writing';
import type { SlashCommandHost } from '../hub/dispatch';

import { buildContextOsReportLines, loadPrivacySnapshot } from './context-os-report';
import {
  loadActiveToolNames,
  loadContextComposition,
  loadLoopModelRouting,
  loadManagedUsageReport,
  loadRuntimeStatusReport,
  loadSessionUsageReport,
} from './info-loaders';
import { loadStatusRecoveryReadiness } from './status-recovery-evidence';

export { buildContextOsReportLines } from './context-os-report';
export { loadStatusRecoveryReadiness } from './status-recovery-evidence';

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
      workingSet: host.state.appState.workingSet,
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
    title: ' Usage ',
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
  let quota: AllProvidersUsageSnapshot | null = host.state.appState.providerQuota ?? null;
  if (quota === null) {
    try {
      quota = await host.harness.auth.getAllProvidersUsage();
      host.setAppState({ providerQuota: quota });
    } catch {
      // Leave quota null; the panel will show an appropriate message.
    }
  }

  const buildLines = () => {
    if (quota === null || quota.providers.length === 0) {
      return ['No provider quota data available.', '', 'Run /login to connect a provider.'];
    }
    return buildUsageReportLines({
      contextUsage: 0,
      contextTokens: 0,
      maxContextTokens: 0,
      providerQuota: quota,
      providerQuotaOnly: true,
    });
  };

  playStatusOpenBeat(host, 'Quota', 'quota');
  const panel = new UsagePanelComponent({
    buildLines,
    borderToken: 'primary',
    title: ' Provider Quotas ',
    enterBeatSeed: 'quota',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

export async function showStatusReport(host: SlashCommandHost): Promise<void> {
  const [runtimeStatus, managedUsage, activeToolNames, loopModelRouting] = await Promise.all([
    loadRuntimeStatusReport(host),
    loadManagedUsageReport(host),
    loadActiveToolNames(host),
    loadLoopModelRouting(host),
  ]);
  const appState = host.state.appState;
  const humanWriting = loadPreflightHumanWriting(appState.workDir);
  const recovery = loadStatusRecoveryReadiness(appState.workDir);
  const privacy = loadPrivacySnapshot(host);
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
    planMode: appState.planMode,
    premiumQualityMode: appState.premiumQualityMode,
    goalStatus: appState.goal?.status,
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
    contextOS: runtimeStatus.status?.contextOS,
    autoDream: runtimeStatus.status?.autoDream,
    privacyTelemetryEnabled: privacy.telemetryEnabled,
    gitStatus: createGitStatusCache(appState.workDir).getStatus(),
    humanWriting: {
      ready: humanWriting.ready,
      advisoryOnly: humanWriting.advisoryOnly,
      nextAction: humanWriting.ready
        ? 'Describe the task to start.'
        : 'Restore writing-quality guidance before long autonomous work.',
    },
    recovery,
    managedUsage: managedUsage?.usage,
    managedUsageError: managedUsage?.error,
    loopModelRouting: loopModelRouting.config,
    loopModelRoutingError: loopModelRouting.error,
    upstreamBaseline: formatUpstreamBaselineSummary(),
    fieldMotion,
    activeToolNames,
  };
  playStatusOpenBeat(host, 'Status', 'status');
  const panel = new UsagePanelComponent({
    buildLines: () => buildStatusReportLines(reportArgs),
    borderToken: 'primary',
    title: ' Status ',
    enterBeatSeed: 'status',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

export async function showMcpServers(host: SlashCommandHost): Promise<void> {
  let servers: readonly McpServerInfo[];
  try {
    servers = await host.requireSession().listMcpServers();
  } catch (error) {
    host.showError(`Failed to load MCP servers: ${formatErrorMessage(error)}`);
    return;
  }

  const title = servers.length > 0 ? ` MCP (${servers.length}) ` : ' MCP ';
  playStatusOpenBeat(host, 'MCP', 'mcp');
  const panel = new UsagePanelComponent({
    buildLines: () => buildMcpStatusReportLines({ servers }),
    borderToken: 'primary',
    title,
    enterBeatSeed: 'mcp',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

export async function showContextOsReport(host: SlashCommandHost, rawArgs = ''): Promise<void> {
  const query = rawArgs.trim();
  let diagnostics: ContextOSRetrievalDiagnostics;
  try {
    const session = host.requireSession();
    if (typeof session.diagnoseContextOS !== 'function') {
      host.showError('Context OS diagnose is unavailable in this session.');
      return;
    }
    diagnostics = await session.diagnoseContextOS(query.length > 0 ? query : 'current work');
  } catch (error) {
    host.showError(`Failed to diagnose Context OS: ${formatErrorMessage(error)}`);
    return;
  }

  const privacy = loadPrivacySnapshot(host);
  const lines = buildContextOsReportLines(diagnostics, privacy, query);
  const panel = new UsagePanelComponent(() => lines, 'primary', ' Context OS ');
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
