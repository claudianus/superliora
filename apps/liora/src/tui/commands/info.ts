import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { resolveEvidenceRoot } from '#/constant/workspace-data';
import type {
  ContextOSRetrievalDiagnostics,
  McpServerInfo,
  SessionStatus,
  SessionUsage,
} from '@superliora/sdk';
import {
  formatContextOSDiagnoseLine,
  formatContextOSHealthLine,
  loadRuntimeConfigSafe,
  resolveConfigPath,
  resolveLioraHome,
} from '@superliora/sdk';

import { buildMcpStatusReportLines } from '../components/messages/mcp-status-panel';
import {
  buildStatusReportLines,
  type StatusRecoveryReadiness,
} from '../components/messages/status-panel';
import { buildUsageReportLines, UsagePanelComponent, type ManagedUsageReport } from '../components/messages/usage-panel';
import { isManagedUsageProvider } from '../constant/liora-tui';
import { formatUpstreamBaselineSummary } from '#/cli/upstream-baseline';
import { formatErrorMessage } from '../utils/event-payload';
import { requestTUILayoutRender } from '../utils/frame-render';
import { createGitStatusCache } from '#/utils/git/git-status';
import { loadPreflightHumanWriting } from './preflight';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Info commands
// ---------------------------------------------------------------------------

interface SessionUsageResult {
  readonly usage?: SessionUsage;
  readonly error?: string;
}

interface RuntimeStatusResult {
  readonly status?: SessionStatus;
  readonly error?: string;
}

interface ManagedUsageResult {
  readonly usage?: ManagedUsageReport;
  readonly error?: string;
}

interface SotaRecoveryCandidate {
  readonly path: string;
  readonly mtimeMs: number;
}

const SOTA_SUMMARY_FILENAME = 'sota-gate-summary.json';
const SOTA_RECOVERY_SCAN_MAX_DEPTH = 5;
const SOTA_RECOVERY_SCAN_LIMIT = 2_000;

export async function showUsage(host: SlashCommandHost): Promise<void> {
  const sessionUsage = await loadSessionUsageReport(host);
  const managedUsage = await loadManagedUsageReport(host);
  const reportArgs = {
    sessionUsage: sessionUsage.usage,
    sessionUsageError: sessionUsage.error,
    contextUsage: host.state.appState.contextUsage,
    contextTokens: host.state.appState.contextTokens,
    maxContextTokens: host.state.appState.maxContextTokens,
    managedUsage: managedUsage?.usage,
    managedUsageError: managedUsage?.error,
  };
  const panel = new UsagePanelComponent(() => buildUsageReportLines(reportArgs), 'primary');
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

export async function showStatusReport(host: SlashCommandHost): Promise<void> {
  const [runtimeStatus, managedUsage, ultraworkRun] = await Promise.all([
    loadRuntimeStatusReport(host),
    loadManagedUsageReport(host),
    (async () => {
      if (!host.session) return null;
      if (typeof host.session.getUltraworkRun !== 'function') return null;
      try {
        return await host.session.getUltraworkRun();
      } catch {
        return null;
      }
    })(),
  ]);
  const appState = host.state.appState;
  const humanWriting = loadPreflightHumanWriting(appState.workDir);
  const recovery = loadStatusRecoveryReadiness(appState.workDir);
  const privacy = loadPrivacySnapshot(host);
  const reportArgs = {
    version: appState.version,
    model: appState.model,
    workDir: appState.workDir,
    sessionId: appState.sessionId,
    sessionTitle: appState.sessionTitle,
    thinking: appState.thinking,
    permissionMode: appState.permissionMode,
    planMode: appState.planMode,
    ultraworkMode: appState.ultraworkMode,
    premiumQualityMode: appState.premiumQualityMode,
    swarmMode: appState.swarmMode,
    goalStatus: appState.goal?.status,
    ultraworkRun: ultraworkRun ? { stage: ultraworkRun.stage } : null,
    contextUsage: appState.contextUsage,
    contextTokens: appState.contextTokens,
    maxContextTokens: appState.maxContextTokens,
    availableModels: appState.availableModels,
    availableProviders: appState.availableProviders,
    providerRouteStatus: runtimeStatus.status?.providerRouteStatus ?? appState.providerRouteStatus,
    status: runtimeStatus.status,
    statusError: runtimeStatus.error,
    contextOS: runtimeStatus.status?.contextOS,
    microCompaction: runtimeStatus.status?.microCompaction,
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
    upstreamBaseline: formatUpstreamBaselineSummary(),
  };
  const panel = new UsagePanelComponent(() => buildStatusReportLines(reportArgs), 'primary', ' Status ');
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
  const panel = new UsagePanelComponent(
    () => buildMcpStatusReportLines({ servers }),
    'primary',
    title,
  );
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

function loadPrivacySnapshot(host: SlashCommandHost): {
  readonly telemetryEnabled: boolean;
  readonly configPath: string;
} {
  try {
    const homeDir = host.harness.homeDir ?? resolveLioraHome();
    const configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });
    const { config } = loadRuntimeConfigSafe(configPath);
    return {
      telemetryEnabled: config.telemetry !== false,
      configPath,
    };
  } catch {
    return {
      telemetryEnabled: true,
      configPath: '(unknown)',
    };
  }
}

export function buildContextOsReportLines(
  diagnostics: ContextOSRetrievalDiagnostics,
  privacy: { readonly telemetryEnabled: boolean; readonly configPath: string },
  query: string,
): string[] {
  const health = diagnostics.health;
  const lines = [
    formatContextOSDiagnoseLine(diagnostics),
    '',
    `Query: ${query.length > 0 ? query : '(default: current work)'}`,
    `Health: ${formatContextOSHealthLine(health)}`,
    `Pages: ${String(health.pageCount)} · ready ${String(health.readyPageCount)} · rehydrate ${String(health.needsRehydrationPageCount)} · at-risk ${String(health.atRiskPageCount)}`,
    `Evidence: score ${health.evidenceIdRecallScore.toFixed(2)} · missing pages ${String(health.missingEvidencePageCount)}`,
    `Selection: candidates ${String(diagnostics.candidatePageCount)} · selected ${String(diagnostics.selectedPageCount)} · superseded ${String(diagnostics.supersededPageCount)}`,
    `Reasons: ${diagnostics.selectedReasons.length > 0 ? diagnostics.selectedReasons.join(', ') : 'none'}`,
  ];
  if (diagnostics.selectedPageSequences.length > 0) {
    lines.push(
      `Selected pages: ${diagnostics.selectedPageSequences.map(String).join(', ')}`,
    );
  }
  lines.push(
    '',
    'Privacy / ZDR posture',
    `  Telemetry: ${privacy.telemetryEnabled ? 'ON (can be disabled)' : 'OFF (local-preferring)'}`,
    `  Config: ${privacy.configPath}`,
    '  Tip: set `telemetry = false` in config.toml for zero product telemetry (ZDR-friendly).',
    '  Session transcripts still stay local to this machine unless you export them.',
    '',
    'Media & research (no extra setup when keys already exist)',
    '  Web: WebSearch + FetchURL + LocalResearchStack (built-in).',
    '  Images: SearchSkill → workspace-imagen / image-generator (provider keys if required).',
    '  Video: SearchSkill → gemini-omni-flash-api when video generation is available.',
  );
  return lines;
}

async function loadSessionUsageReport(host: SlashCommandHost): Promise<SessionUsageResult> {
  try {
    return { usage: await host.requireSession().getUsage() };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}

async function loadRuntimeStatusReport(host: SlashCommandHost): Promise<RuntimeStatusResult> {
  try {
    return { status: await host.requireSession().getStatus() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadManagedUsageReport(host: SlashCommandHost): Promise<ManagedUsageResult | undefined> {
  const alias = host.state.appState.model;
  const providerKey = host.state.appState.availableModels[alias]?.provider;
  if (!isManagedUsageProvider(providerKey)) return undefined;

  let res;
  try {
    res = await host.harness.auth.getManagedUsage(providerKey);
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
  if (res.kind === 'error') {
    return { error: res.message };
  }
  return { usage: { summary: res.summary, limits: res.limits } };
}

export function loadStatusRecoveryReadiness(workDir: string): StatusRecoveryReadiness {
  const evidenceRoot = join(workDir, resolveEvidenceRoot(workDir));
  const latest = latestPassingSotaRecoveryEvidence(evidenceRoot);
  if (latest === undefined) {
    return {
      ready: false,
      nextAction: 'Run live TUI SOTA gate to capture recovery evidence.',
    };
  }
  return {
    ready: true,
    evidencePath: displayStatusEvidencePath(workDir, latest.path),
    nextAction: 'Recovery evidence ready.',
  };
}

function latestPassingSotaRecoveryEvidence(root: string): SotaRecoveryCandidate | undefined {
  if (!existsSync(root)) return undefined;
  const candidates: SotaRecoveryCandidate[] = [];
  collectPassingSotaRecoveryEvidence(root, 0, { visited: 0 }, candidates);
  return candidates.toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

function collectPassingSotaRecoveryEvidence(
  dir: string,
  depth: number,
  state: { visited: number },
  candidates: SotaRecoveryCandidate[],
): void {
  if (state.visited >= SOTA_RECOVERY_SCAN_LIMIT || depth > SOTA_RECOVERY_SCAN_MAX_DEPTH) return;
  state.visited += 1;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPassingSotaRecoveryEvidence(entryPath, depth + 1, state, candidates);
      continue;
    }
    if (!entry.isFile() || entry.name !== SOTA_SUMMARY_FILENAME) continue;
    const summary = readStatusJsonRecord(entryPath);
    if (summary === undefined || !isPassingSotaRecoverySummary(summary)) continue;
    candidates.push({ path: entryPath, mtimeMs: fileMtimeMs(entryPath) });
  }
}

function isPassingSotaRecoverySummary(summary: Record<string, unknown>): boolean {
  return (
    summary['status'] === 'PASS' &&
    statusField(summary['tuiWorkflowProof']) === 'PASS' &&
    statusField(summary['tuiUltraworkProof']) === 'PASS' &&
    statusField(summary['harnessRadarGate']) === 'PASS'
  );
}

function statusField(value: unknown): string | undefined {
  return isRecord(value) && typeof value['status'] === 'string' ? value['status'] : undefined;
}

function readStatusJsonRecord(path: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fileMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function displayStatusEvidencePath(workDir: string, path: string): string {
  const rel = relative(workDir, path);
  return rel.length > 0 && !rel.startsWith('..') ? rel : path;
}
