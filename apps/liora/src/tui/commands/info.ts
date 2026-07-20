import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { resolveEvidenceRoot } from '#/constant/workspace-data';
import type {
  ContextOSRetrievalDiagnostics,
  ContextComposition,
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
  createStatusFieldMotionState,
  type StatusRecoveryReadiness,
} from '../components/messages/status-panel';
import { buildUsageReportLines, buildContextCompositionLines, UsagePanelComponent, type ManagedUsageReport } from '../components/messages/usage-panel';
import type { AllProvidersUsageSnapshot } from '@superliora/sdk';
import { isManagedUsageProvider } from '../constant/liora-tui';
import { formatUpstreamBaselineSummary } from '#/cli/upstream-baseline';
import { appearanceAnimationNow } from '../utils/appearance-effects';
import { formatErrorMessage } from '../utils/event-payload';
import { requestTUILayoutRender } from '../utils/frame-render';
import { isMotionTheatreActive } from '../utils/motion-beats';
import { createGitStatusCache } from '#/utils/git/git-status';
import { loadPreflightHumanWriting } from './preflight';
import type { SlashCommandHost } from './dispatch';

function playStatusOpenBeat(host: SlashCommandHost, title: string, seed: string): void {
  host.motionBeats.play({
    name: 'status_open',
    seed,
    title,
    nowMs: appearanceAnimationNow(),
    theatreActive: isMotionTheatreActive(host.state.appState),
  });
}

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
  const [sessionUsage, composition] = await Promise.all([
    loadSessionUsageReport(host),
    loadContextComposition(host),
  ]);
  const alias = host.state.appState.model;
  const providerKey = host.state.appState.availableModels[alias]?.provider;
  const managedProvider = isManagedUsageProvider(providerKey);

  // Show session/context immediately; fill managed Plan usage asynchronously so
  // multi-account fetches can animate loading → ready without blocking the panel.
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
    title: ' Usage ',
    enterBeatSeed: 'usage',
    phase: managedProvider ? 'loading' : 'ready',
    requestRender: () => requestTUILayoutRender(host.state),
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
  // Use the cached snapshot from the background monitor when available;
  // otherwise fetch fresh data on the spot.
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
    // Reuse the multi-provider quota section builder via buildUsageReportLines
    // with only the providerQuota field populated.
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
    requestRender: () => requestTUILayoutRender(host.state),
  });
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
  const fieldMotion = createStatusFieldMotionState();
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
    upstreamBaseline: formatUpstreamBaselineSummary(),
    fieldMotion,
  };
  playStatusOpenBeat(host, 'Status', 'status');
  const panel = new UsagePanelComponent({
    buildLines: () => buildStatusReportLines(reportArgs),
    borderToken: 'primary',
    title: ' Status ',
    enterBeatSeed: 'status',
    requestRender: () => requestTUILayoutRender(host.state),
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
    requestRender: () => requestTUILayoutRender(host.state),
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

function loadPrivacySnapshot(host: SlashCommandHost): {
  readonly telemetryEnabled: boolean;
  readonly configPath: string;
} {
  try {
    const homeDir = host.harness.homeDir ?? resolveLioraHome();
    const configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });
    const { config } = loadRuntimeConfigSafe(configPath);
    return {
      telemetryEnabled: config.telemetry === true,
      configPath,
    };
  } catch {
    return {
      telemetryEnabled: false,
      configPath: '(unknown)',
    };
  }
}


function nonEmptyEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function imageProviderKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    nonEmptyEnv(env['OPENAI_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GEMINI_API_KEY']) !== undefined
  );
}

function videoProviderKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    nonEmptyEnv(env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GEMINI_API_KEY']) !== undefined
  );
}

function formatMediaReadinessLines(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const imageReady = imageProviderKeyReady(env);
  const videoReady = videoProviderKeyReady(env);
  return [
    'Media & research (zero-config when keys already exist)',
    '  Web: multi-provider WebSearch (Brave/Tavily/Exa/Serper env keys + free DuckDuckGo) + FetchURL.',
    '  Docs: Context7Resolve → Context7Docs for library APIs (built-in).',
    imageReady
      ? '  Images: ready · GenerateImage (OPENAI/GOOGLE/GEMINI key detected).'
      : '  Images: set OPENAI_API_KEY or GOOGLE_API_KEY/GEMINI_API_KEY to enable GenerateImage.',
    videoReady
      ? '  Video: ready · GenerateVideo (GOOGLE/GEMINI key detected).'
      : '  Video: set GOOGLE_API_KEY/GEMINI_API_KEY to enable GenerateVideo.',
    '  Office: SearchSkill → docx / pptx / xlsx (Word, slides, sheets · zero MCP).',
  ];
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
    `  Telemetry: ${privacy.telemetryEnabled ? 'ON (opt-in)' : 'OFF (default · ZDR-friendly)'}`,
    `  Config: ${privacy.configPath}`,
    '  Tip: product telemetry is off by default. Set `telemetry = true` in config.toml only if you want usage analytics.',
    '  Session transcripts still stay local to this machine unless you export them.',
    '',
    ...formatMediaReadinessLines(),
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

async function loadContextComposition(
  host: SlashCommandHost,
): Promise<ContextComposition | undefined> {
  try {
    const session = host.requireSession();
    if (typeof session.getContextComposition !== 'function') return undefined;
    return await session.getContextComposition();
  } catch {
    return undefined;
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

  const auth = host.harness.auth as {
    getManagedUsageForAllAccounts?: (
      providerName?: string,
    ) => Promise<
      readonly {
        readonly accountKey: string;
        readonly label?: string;
        readonly isPrimary: boolean;
        readonly kind: 'ok' | 'error';
        readonly summary?: ManagedUsageReport['summary'];
        readonly limits?: ManagedUsageReport['limits'];
        readonly message?: string;
      }[]
    >;
    getManagedUsage: (providerName?: string) => Promise<{
      readonly kind: 'ok' | 'error';
      readonly summary?: ManagedUsageReport['summary'];
      readonly limits?: ManagedUsageReport['limits'];
      readonly message?: string;
    }>;
  };

  try {
    if (typeof auth.getManagedUsageForAllAccounts === 'function') {
      const accounts = await auth.getManagedUsageForAllAccounts(providerKey);
      if (accounts.length === 0) {
        return { usage: { summary: null, limits: [], accounts: [] } };
      }

      const mapped = accounts.map((account) => {
        if (account.kind === 'ok') {
          return {
            accountKey: account.accountKey,
            ...(account.label === undefined ? {} : { label: account.label }),
            isPrimary: account.isPrimary,
            summary: account.summary ?? null,
            limits: account.limits ?? [],
            status: 'ok' as const,
          };
        }
        return {
          accountKey: account.accountKey,
          ...(account.label === undefined ? {} : { label: account.label }),
          isPrimary: account.isPrimary,
          summary: null,
          limits: [],
          error: account.message ?? 'Failed to load usage.',
          status: 'error' as const,
        };
      });

      const primaryOk = mapped.find((account) => account.isPrimary && account.status === 'ok');
      const firstOk = mapped.find((account) => account.status === 'ok');
      const summarySource = primaryOk ?? firstOk;
      // Partial and total account failures stay in `accounts` so successful
      // rows still render; avoid a top-level error that would hide the list.
      return {
        usage: {
          summary: summarySource?.summary ?? null,
          limits: summarySource?.limits ?? [],
          accounts: mapped,
        },
      };
    }

    const res = await auth.getManagedUsage(providerKey);
    if (res.kind === 'error') {
      return { error: res.message ?? 'Failed to load usage.' };
    }
    return {
      usage: {
        summary: res.summary ?? null,
        limits: res.limits ?? [],
      },
    };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
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
