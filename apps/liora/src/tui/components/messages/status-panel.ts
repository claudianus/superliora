/**
 * Status report line builder for `/status`.
 *
 * It mirrors `/usage` visual language but keeps runtime status formatting
 * separate from the TUI orchestration layer.
 */

import type {
  ModelAlias,
  PermissionMode,
  ProviderConfig,
  ProviderRouteCandidateStatus,
  ProviderRouteStatus,
  SessionStatus,
} from '@superliora/sdk';

import { PRODUCT_NAME } from '#/constant/app';
import { renderRendererRatioProgressBar } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  formatTokenCount,
  ratioSeverity,
  safeUsageRatio,
} from '#/utils/usage/usage-format';
import { formatGitBadgeBase, type GitStatus } from '#/utils/git/git-status';

import { buildManagedUsageReportLines, type ManagedUsageReport } from './usage-panel';

interface FieldRow {
  readonly label: string;
  readonly value: string;
  readonly severity?: 'error' | 'warning';
}

type StatusGoalStatus = 'active' | 'paused' | 'blocked' | 'complete';

export interface StatusHumanWritingReadiness {
  readonly ready: boolean;
  readonly advisoryOnly: boolean;
  readonly nextAction: string;
}

export interface StatusRecoveryReadiness {
  readonly ready: boolean;
  readonly nextAction: string;
  readonly evidencePath?: string;
}

export interface StatusReportOptions {
  readonly version: string;
  readonly model: string;
  readonly workDir: string;
  readonly sessionId: string;
  readonly sessionTitle: string | null;
  readonly thinking: boolean;
  readonly permissionMode: PermissionMode;
  readonly planMode: boolean;
  readonly ultraworkMode?: boolean;
  readonly premiumQualityMode?: boolean;
  readonly swarmMode?: boolean;
  readonly goalStatus?: StatusGoalStatus;
  readonly contextUsage: number;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly availableModels: Record<string, ModelAlias>;
  readonly availableProviders?: Record<string, ProviderConfig>;
  readonly providerRouteStatus?: ProviderRouteStatus | null;
  readonly status?: SessionStatus;
  readonly statusError?: string;
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
  readonly gitStatus?: GitStatus | null;
  readonly humanWriting?: StatusHumanWritingReadiness;
  readonly recovery?: StatusRecoveryReadiness;
  readonly upstreamBaseline?: string;
  readonly ultraworkRun?: { readonly stage: string } | null;
  readonly contextOS?: {
    readonly pageCount: number;
    readonly readyPageCount: number;
    readonly needsRehydrationPageCount: number;
    readonly atRiskPageCount: number;
    readonly missingEvidencePageCount: number;
    readonly evidenceIdRecallScore: number;
    readonly latestContinuityStatus: string;
  };
  readonly microCompaction?: {
    readonly total: number;
    readonly lastTrigger: string | null;
    readonly lastContextUsageRatio: number | null;
    readonly byTrigger: Readonly<Record<string, number>>;
  };
  /** Product telemetry enabled (false ≈ ZDR-friendlier local posture). */
  readonly privacyTelemetryEnabled?: boolean;
  /** Active tool names from the session (for research/media readiness). */
  readonly activeToolNames?: readonly string[];
}

type Colorize = (text: string) => string;

function displayModelName(alias: string, models: Record<string, ModelAlias>): string {
  const model = models[alias];
  return model?.displayName ?? model?.model ?? alias;
}

function formatModelStatus(options: StatusReportOptions): string {
  const model = options.status?.model ?? options.model;
  if (model.trim().length === 0) return 'not set';

  const thinking = options.status?.thinkingLevel ?? (options.thinking ? 'on' : 'off');
  return `${displayModelName(model, options.availableModels)} (thinking ${thinking})`;
}

function addFieldRows(
  lines: string[],
  rows: readonly FieldRow[],
  muted: Colorize,
  value: Colorize,
  errorStyle: Colorize,
  warningStyle: Colorize = value,
): void {
  const labelWidth = Math.max(10, ...rows.map((row) => row.label.length));
  for (const row of rows) {
    const colorize =
      row.severity === 'error'
        ? errorStyle
        : row.severity === 'warning'
          ? warningStyle
          : value;
    lines.push(`  ${muted(row.label.padEnd(labelWidth, ' '))}  ${colorize(row.value)}`);
  }
}

function contextValues(options: StatusReportOptions): {
  ratio: number;
  tokens: number;
  maxTokens: number;
} {
  return {
    ratio: options.status?.contextUsage ?? options.contextUsage,
    tokens: options.status?.contextTokens ?? options.contextTokens,
    maxTokens: options.status?.maxContextTokens ?? options.maxContextTokens,
  };
}

function formatWorktreeStatus(status: GitStatus): string {
  return `${formatGitBadgeBase(status)} ${status.dirty ? 'dirty' : 'clean'}`;
}

const READINESS_CHECKS = 'inspect -> test -> change -> verify -> summarize';
const WORKFLOW_GATE = 'research → interview → goal → swarm → integrate → verify → learn';
const ENGINE_GATE = 'UltraPlan | UltraGoal | Research | Swarm decision | Integrate | Verify | Learn';
const AUTO_GATE = 'Shift-Tab toggles Ultrawork/off; no regex promotion';
const AUTONOMY_GATE = 'bounded now -> headless target';
const TOOLS_GATE = 'search first; load tools on demand';
const RESEARCH_GATE = 'WebSearch + FetchURL + Context7 ready (local fallback)';
const BENCH_GATE = 'LioraBench seed/holdout · web/media/office/ZDR · a1/m2/sw3/s1.001';
const MEDIA_GATE =
  'set OPENAI_API_KEY or GOOGLE/GEMINI_API_KEY for GenerateImage/GenerateVideo (no MCP)';
const OFFICE_GATE =
  'SearchSkill → docx / pptx / xlsx for Word, slides, and sheets (zero MCP)';
const MEMORY_GATE = 'prefs | session recall | long-run notes | auto-dream';
const SCOPE_GATE = 'small focused diff; no broad refactor';
const COVERAGE_GATE = 'test public behavior changes';
const WRITING_GATE = 'human voice lanes; detectors advisory-only';
const WRITING_BLOCKED_GATE = 'voice-lane guidance blocked; detectors must stay advisory-only';
const SCREEN_CHECK_GATE = 'open changed screen before finishing';
const DONE_GATE = 'tests + typecheck/lint/build + clean diff + TUI';

function hasActiveTool(options: StatusReportOptions, name: string): boolean | undefined {
  if (options.activeToolNames === undefined) return undefined;
  return options.activeToolNames.includes(name);
}

function imageProviderKeyReady(): boolean {
  return (
    nonEmptyEnv(process.env['OPENAI_API_KEY']) !== undefined ||
    nonEmptyEnv(process.env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(process.env['GEMINI_API_KEY']) !== undefined
  );
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatResearchGate(options: StatusReportOptions): string {
  const web = hasActiveTool(options, 'WebSearch');
  const fetch = hasActiveTool(options, 'FetchURL');
  const c7Resolve = hasActiveTool(options, 'Context7Resolve');
  const c7Docs = hasActiveTool(options, 'Context7Docs');
  if (web === undefined || fetch === undefined) return RESEARCH_GATE;
  const context7 =
    c7Resolve === true || c7Docs === true
      ? ' · Context7 on'
      : c7Resolve === false && c7Docs === false
        ? ' · Context7 off'
        : '';
  if (web && fetch) {
    return `ready · WebSearch + FetchURL active${context7} (local/managed ok)`;
  }
  if (!web && !fetch) return 'unavailable · Web research tools missing in this session';
  return `partial · WebSearch ${web ? 'on' : 'off'} · FetchURL ${fetch ? 'on' : 'off'}${context7}`;
}

function formatMediaGate(options: StatusReportOptions): string {
  const image = hasActiveTool(options, 'GenerateImage');
  const video = hasActiveTool(options, 'GenerateVideo');
  if (image === true && video === true) {
    return 'ready · GenerateImage + GenerateVideo active (keys detected)';
  }
  if (image === true) return 'ready · GenerateImage active (key detected)';
  if (video === true) return 'ready · GenerateVideo active (Google/Gemini key)';
  if (imageProviderKeyReady()) {
    return 'key ready · GenerateImage/GenerateVideo will register when profile allows';
  }
  return MEDIA_GATE;
}

function humanWritingBlocked(options: StatusReportOptions): boolean {
  const humanWriting = options.humanWriting;
  return humanWriting !== undefined && (!humanWriting.ready || !humanWriting.advisoryOnly);
}

function verifyBlockedByReadiness(options: StatusReportOptions): boolean {
  const model = (options.status?.model ?? options.model).trim();
  const { ratio, maxTokens } = contextValues(options);
  return (
    model.length === 0 ||
    (maxTokens > 0 && safeUsageRatio(ratio) >= 0.011) ||
    options.gitStatus?.dirty === true ||
    options.goalStatus === 'blocked' ||
    humanWritingBlocked(options)
  );
}

function formatUltraworkStageStatus(options: StatusReportOptions): string {
  const planMode = options.status?.planMode ?? options.planMode;
  const blocked = verifyBlockedByReadiness(options);
  const canAutoOrchestrate = options.goalStatus === undefined && !blocked;
  const plan = planMode ? 'Plan on' : options.ultraworkMode ? 'Plan required' : 'Plan off';
  const goal = `Goal ${formatGoalStatus(options.goalStatus)}`;
  const swarm = `Swarm ${options.swarmMode === true ? 'armed' : canAutoOrchestrate ? 'decision pending' : 'off'}`;
  const verify = `Verify ${formatVerifyStatus(options.goalStatus, planMode, blocked)}`;
  
  // Add current Ultrawork stage if available
  let stageInfo = '';
  if (options.ultraworkRun !== undefined && options.ultraworkRun !== null) {
    const stage = options.ultraworkRun.stage;
    const stageLabel = stage.replaceAll('_', ' ');
    stageInfo = ` | Stage: ${stageLabel}`;
  }
  
  return `${plan} | ${goal} | ${swarm} | ${verify}${stageInfo}`;
}

function formatUltraworkFlow(options: StatusReportOptions): FieldRow {
  const planMode = options.status?.planMode ?? options.planMode;
  const blocked = verifyBlockedByReadiness(options);
  const verify = formatVerifyStatus(options.goalStatus, planMode, blocked);
  if (verify === 'passed') {
    return {
      label: 'Flow',
      value: `${renderRendererRatioProgressBar({ ratio: 1, width: 4 })} 4/4 verified`,
    };
  }
  if (verify === 'blocked') {
    return {
      label: 'Flow',
      value: `${renderRendererRatioProgressBar({ ratio: 0.75, width: 4 })} 3/4 verify blocked`,
      severity: 'error',
    };
  }
  if (verify === 'queued') {
    return {
      label: 'Flow',
      value: `${renderRendererRatioProgressBar({ ratio: 0.75, width: 4 })} 3/4 verify queued`,
    };
  }
  return {
    label: 'Flow',
    value: `${renderRendererRatioProgressBar({ ratio: 1, width: 4 })} 4/4 ready to run`,
  };
}

function formatPremiumQualityStatus(options: StatusReportOptions): string {
  const enabled =
    options.status?.premiumQualityMode ?? options.premiumQualityMode === true;
  return enabled ? 'mode on' : 'mode off';
}

function formatUltraworkStatus(options: StatusReportOptions): string {
  const blocked = verifyBlockedByReadiness(options);
  if (blocked && options.goalStatus !== 'blocked') return 'needs readiness';
  if (options.ultraworkMode === true) return 'mode on';

  switch (options.goalStatus) {
    case 'active':
      return 'goal active';
    case 'paused':
      return 'goal paused';
    case 'blocked':
      return 'goal blocked';
    case 'complete':
      return 'verified';
    case undefined:
      return 'mode off';
  }
}

function formatGoalStatus(status: StatusGoalStatus | undefined): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'blocked':
      return 'blocked';
    case 'complete':
      return 'complete';
    case undefined:
      return 'ready';
  }
}

function formatVerifyStatus(status: StatusGoalStatus | undefined, planMode: boolean, blocked: boolean): string {
  if (status === 'complete') return 'passed';
  if (status === 'blocked' || blocked) return 'blocked';

  switch (status) {
    case 'active':
    case 'paused':
      return 'queued';
    case undefined:
      return planMode ? 'queued' : 'ready';
  }
}

function formatReadinessBlockers(options: StatusReportOptions): string {
  const blockers: string[] = [];
  const model = (options.status?.model ?? options.model).trim();
  if (model.length === 0) blockers.push('model setup');
  const { ratio, maxTokens } = contextValues(options);
  if (maxTokens > 0 && safeUsageRatio(ratio) >= 0.011) blockers.push('context high');
  if (options.gitStatus?.dirty === true) blockers.push('worktree dirty');
  if (options.goalStatus === 'blocked') blockers.push('goal blocked');
  if (humanWritingBlocked(options)) blockers.push('writing guidance');
  return blockers.length === 0 ? 'none detected' : blockers.join(', ');
}

function formatRecoveryGate(options: StatusReportOptions): string {
  return options.recovery?.ready === true
    ? 'resumable evidence ready -> durable target'
    : 'resumable evidence needed -> durable target';
}

function formatModelCatalogGate(options: StatusReportOptions): string {
  const modelCount = Object.keys(options.availableModels).length;
  const providerCount = Object.keys(options.availableProviders ?? {}).length;
  const model = (options.status?.model ?? options.model).trim();
  const activeProvider = model.length > 0 ? options.availableModels[model]?.provider : undefined;

  if (modelCount === 0 && providerCount === 0) return 'no catalog loaded';
  if (activeProvider === undefined) {
    return `${String(modelCount)} models / ${String(providerCount)} providers; choose model`;
  }
  return (
    `${String(modelCount)} models / ${String(providerCount)} providers; ` +
    `active ${compactCatalogValue(activeProvider)}`
  );
}

function compactCatalogValue(value: string): string {
  const maxLength = 28;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, 12)}...${value.slice(value.length - 13)}`;
}

function formatProviderRouteSummary(route: ProviderRouteStatus): string {
  const now = Date.now();
  const cooling = route.candidates.filter((candidate) => isCoolingDown(candidate, now)).length;
  const ready = Math.max(0, route.candidates.length - cooling);
  const coolingSuffix = cooling > 0 ? `; ${String(cooling)} cooling` : '';
  return `${route.strategy} ${String(ready)}/${String(route.candidates.length)} ready${coolingSuffix}`;
}

function providerRouteRows(route: ProviderRouteStatus): readonly FieldRow[] {
  const rows: FieldRow[] = [
    { label: 'Strategy', value: formatProviderRouteSummary(route) },
  ];
  const visibleCandidates = route.candidates.slice(0, 6);
  for (let index = 0; index < visibleCandidates.length; index += 1) {
    const candidate = visibleCandidates[index]!;
    const cooling = isCoolingDown(candidate, Date.now());
    rows.push({
      label: `#${String(index + 1)}`,
      value: formatProviderRouteCandidate(candidate),
      severity: cooling ? 'error' : undefined,
    });
  }
  const hidden = route.candidates.length - visibleCandidates.length;
  if (hidden > 0) rows.push({ label: 'More', value: `${String(hidden)} more candidates` });
  return rows;
}

function formatProviderRouteCandidate(candidate: ProviderRouteCandidateStatus): string {
  const now = Date.now();
  const target = compactCatalogValue(`${candidate.modelAlias}/${candidate.providerModel}`);
  const provider = compactCatalogValue(routeCandidateProvider(candidate));
  const weight = candidate.weight === undefined ? '' : ` weight ${String(candidate.weight)}`;
  const latency = formatProviderRouteCandidateLatency(candidate);
  const headroom = formatProviderRouteCandidateHeadroom(candidate);
  const limits = formatProviderRouteCandidateRateLimits(candidate, now);
  const stats = formatProviderRouteCandidateStats(candidate);
  if (isCoolingDown(candidate, now)) {
    const reason = candidate.cooldownKind ?? candidate.lastFailureKind ?? 'failure';
    return `cooling ${reason} ${formatCooldownRemaining(candidate.cooldownUntil!, now)} ${provider} -> ${target}${weight}${latency}${headroom}${limits}${stats}`;
  }
  if (candidate.lastFailureKind !== undefined) {
    return `ready; last ${candidate.lastFailureKind} ${provider} -> ${target}${weight}${latency}${headroom}${limits}${stats}`;
  }
  return `ready ${provider} -> ${target}${weight}${latency}${headroom}${limits}${stats}`;
}

function formatProviderRouteCandidateLatency(candidate: ProviderRouteCandidateStatus): string {
  if (candidate.avgLatencyMs !== undefined) return ` latency ${String(candidate.avgLatencyMs)}ms`;
  if (candidate.lastLatencyMs !== undefined) {
    return ` last_latency ${String(candidate.lastLatencyMs)}ms`;
  }
  return '';
}

function formatProviderRouteCandidateHeadroom(candidate: ProviderRouteCandidateStatus): string {
  if (candidate.rateLimitHeadroom === undefined) return '';
  const percent = Math.round(Math.max(0, Math.min(1, candidate.rateLimitHeadroom)) * 100);
  return ` headroom ${String(percent)}%`;
}

function formatProviderRouteCandidateRateLimits(
  candidate: ProviderRouteCandidateStatus,
  now: number,
): string {
  if (candidate.rateLimits === undefined || candidate.rateLimits.length === 0) return '';
  return ` [${candidate.rateLimits
    .map((rateLimit) => {
      const quota =
        rateLimit.remaining === undefined && rateLimit.limit === undefined
          ? rateLimit.name
          : `${rateLimit.name}:${String(rateLimit.remaining ?? '?')}/${String(rateLimit.limit ?? '?')}`;
      return rateLimit.resetAt === undefined
        ? quota
        : `${quota}@${formatCooldownRemaining(rateLimit.resetAt, now)}`;
    })
    .join(',')}]`;
}

function formatProviderRouteCandidateStats(candidate: ProviderRouteCandidateStatus): string {
  const parts: string[] = [];
  if (candidate.successCount !== undefined && candidate.successCount > 0) {
    parts.push(`ok ${String(candidate.successCount)}`);
  }
  if (candidate.failureCount !== undefined && candidate.failureCount > 0) {
    parts.push(`fail ${String(candidate.failureCount)}`);
  }
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

function routeCandidateProvider(candidate: ProviderRouteCandidateStatus): string {
  if (candidate.credentialLabel === undefined || candidate.credentialLabel.length === 0) {
    return candidate.providerName;
  }
  return `${candidate.providerName}:${candidate.credentialLabel}`;
}

function isCoolingDown(candidate: ProviderRouteCandidateStatus, now: number): boolean {
  return candidate.cooldownUntil !== undefined && candidate.cooldownUntil > now;
}

function formatCooldownRemaining(cooldownUntil: number, now: number): string {
  const remainingMs = Math.max(0, cooldownUntil - now);
  if (remainingMs < 60_000) return `${String(Math.ceil(remainingMs / 1000))}s`;
  if (remainingMs < 60 * 60_000) return `${String(Math.ceil(remainingMs / 60_000))}m`;
  return `${String(Math.ceil(remainingMs / (60 * 60_000)))}h`;
}

function readinessGateRows(options: StatusReportOptions): readonly FieldRow[] {
  const writingBlocked = humanWritingBlocked(options);
  const writingRow: FieldRow = writingBlocked
    ? { label: 'Writing', value: WRITING_BLOCKED_GATE, severity: 'error' }
    : { label: 'Writing', value: WRITING_GATE };
  return [
    { label: 'Checks', value: READINESS_CHECKS },
    { label: 'Workflow', value: WORKFLOW_GATE },
    { label: 'Engine', value: ENGINE_GATE },
    { label: 'Auto', value: AUTO_GATE },
    { label: 'Autonomy', value: AUTONOMY_GATE },
    { label: 'Recovery', value: formatRecoveryGate(options) },
    { label: 'Tools', value: TOOLS_GATE },
    { label: 'Research', value: formatResearchGate(options) },
    { label: 'Bench', value: BENCH_GATE },
    { label: 'Media', value: formatMediaGate(options) },
    { label: 'Office', value: OFFICE_GATE },
    { label: 'Catalog', value: formatModelCatalogGate(options) },
    { label: 'Memory', value: MEMORY_GATE },
    formatUltraworkFlow(options),
    { label: 'Stages', value: formatUltraworkStageStatus(options) },
    { label: 'Blockers', value: formatReadinessBlockers(options) },
    { label: 'Scope', value: SCOPE_GATE },
    { label: 'Coverage', value: COVERAGE_GATE },
    writingRow,
    { label: 'Screen check', value: SCREEN_CHECK_GATE },
    { label: 'Done gate', value: DONE_GATE },
  ];
}

function readinessRows(options: StatusReportOptions): readonly FieldRow[] {
  const gateRows = readinessGateRows(options);
  const model = (options.status?.model ?? options.model).trim();
  if (model.length === 0) {
    return [
      { label: 'State', value: 'Model needed', severity: 'error' },
      ...gateRows,
      { label: 'Next', value: 'Run /login to add a provider, then /model to pick one.' },
    ];
  }

  const { ratio, maxTokens } = contextValues(options);
  if (maxTokens > 0 && safeUsageRatio(ratio) >= 0.011) {
    return [
      { label: 'State', value: 'Context high' },
      ...gateRows,
      { label: 'Next', value: 'Run /compact before long work.' },
    ];
  }

  if (options.gitStatus?.dirty === true) {
    return [
      { label: 'State', value: 'Worktree dirty' },
      ...gateRows,
      { label: 'Next', value: 'Review changed files before finishing.' },
    ];
  }

  if (humanWritingBlocked(options)) {
    return [
      { label: 'State', value: 'Writing guidance blocked', severity: 'error' },
      ...gateRows,
      {
        label: 'Next',
        value: options.humanWriting?.nextAction ?? 'Restore writing-quality guidance before long autonomous work.',
      },
    ];
  }

  if (options.goalStatus === 'blocked') {
    return [
      { label: 'State', value: 'Goal blocked', severity: 'error' },
      ...gateRows,
      { label: 'Next', value: 'Resolve or replace the blocked goal before continuing.' },
    ];
  }

  return [
    { label: 'State', value: 'Ready' },
    ...gateRows,
    {
      label: 'Next',
      value: options.ultraworkMode === true
        ? 'Type task; Ultrawork will interview before goal, swarm, and edits.'
        : 'Press Shift-Tab to toggle Ultrawork/off, or type normally.',
    },
  ];
}

function formatContextOSStatus(options: StatusReportOptions): string | undefined {
  const health = options.contextOS ?? options.status?.contextOS;
  if (health === undefined || health.pageCount <= 0) return undefined;
  const evidence =
    health.missingEvidencePageCount > 0
      ? `evidence ${health.evidenceIdRecallScore.toFixed(2)} (missing ${String(health.missingEvidencePageCount)})`
      : `evidence ${health.evidenceIdRecallScore.toFixed(2)}`;
  return `${health.latestContinuityStatus} · pages ${String(health.readyPageCount)}/${String(health.pageCount)} ready · ${evidence}`;
}



function privacyStatusRows(options: StatusReportOptions): readonly FieldRow[] {
  if (options.privacyTelemetryEnabled === undefined) return [];
  if (options.privacyTelemetryEnabled) {
    return [
      {
        label: 'Privacy',
        value: 'Telemetry ON (opt-in) · omit/false for ZDR-friendly local',
        severity: 'warning',
      },
    ];
  }
  return [
    {
      label: 'Privacy',
      value: 'Telemetry OFF (default) · ZDR-friendly local',
    },
  ];
}

function contextOSStatusRows(options: StatusReportOptions): readonly FieldRow[] {
  const value = formatContextOSStatus(options);
  if (value === undefined) return [];
  const health = options.contextOS ?? options.status?.contextOS;
  const severity: FieldRow['severity'] =
    health !== undefined && health.missingEvidencePageCount > 0
      ? 'error'
      : health !== undefined && health.latestContinuityStatus !== 'ready'
        ? 'warning'
        : undefined;
  return [{ label: 'Context OS', value, severity }];
}

function microCompactionStatusRows(options: StatusReportOptions): readonly FieldRow[] {
  const value = formatMicroCompactionStatus(options);
  if (value === undefined) return [];
  const micro = options.microCompaction ?? options.status?.microCompaction;
  const last = micro?.lastTrigger;
  const severity: FieldRow['severity'] =
    last === 'swarm_pressure' || last === 'usage_and_cache_miss' ? 'warning' : undefined;
  return [{ label: 'Micro clear', value, severity }];
}

function formatMicroCompactionStatus(options: StatusReportOptions): string | undefined {
  const micro = options.microCompaction ?? options.status?.microCompaction;
  if (micro === undefined || micro.total <= 0) return undefined;
  const last = micro.lastTrigger ?? 'unknown';
  const usage =
    micro.lastContextUsageRatio === null || micro.lastContextUsageRatio === undefined
      ? ''
      : ` @${(micro.lastContextUsageRatio * 100).toFixed(0)}%`;
  const top = Object.entries(micro.byTrigger)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name}:${String(count)}`)
    .join(',');
  return `${String(micro.total)} clears · last ${last}${usage}${top.length > 0 ? ` · ${top}` : ''}`;
}

export function buildStatusReportLines(options: StatusReportOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);
  const warningStyle = (text: string) => currentTheme.fg('warning', text);
  const severityToken = (sev: 'ok' | 'warn' | 'danger'): 'error' | 'warning' | 'success' =>
    sev === 'danger' ? 'error' : sev === 'warn' ? 'warning' : 'success';

  const permission = options.status?.permission ?? options.permissionMode;
  const sessionId = options.sessionId.trim().length > 0 ? options.sessionId : 'none';
  const rows: FieldRow[] = [
    { label: 'Model', value: formatModelStatus(options) },
    { label: 'Directory', value: options.workDir },
    { label: 'Permissions', value: permission },
    { label: 'Ultrawork', value: formatUltraworkStatus(options) },
    { label: 'Premium', value: formatPremiumQualityStatus(options) },
    ...contextOSStatusRows(options),
    ...microCompactionStatusRows(options),
    ...privacyStatusRows(options),
    { label: 'Session', value: sessionId },
  ];
  if (options.providerRouteStatus !== undefined && options.providerRouteStatus !== null) {
    rows.splice(1, 0, {
      label: 'Route',
      value: formatProviderRouteSummary(options.providerRouteStatus),
    });
  }
  if (options.gitStatus !== undefined && options.gitStatus !== null) {
    rows.splice(2, 0, { label: 'Worktree', value: formatWorktreeStatus(options.gitStatus) });
  }
  const title = options.sessionTitle?.trim();
  if (title !== undefined && title.length > 0) rows.push({ label: 'Title', value: title });
  if (options.statusError !== undefined) {
    rows.push({ label: 'Warning', value: options.statusError, severity: 'error' });
  }

  const lines: string[] = [
    `${accent(`>_ ${PRODUCT_NAME}`)} ${muted(`(v${options.version})`)}`,
  ];
  if (options.upstreamBaseline !== undefined && options.upstreamBaseline.length > 0) {
    lines.push(`${muted('Upstream')}  ${value(options.upstreamBaseline)}`);
  }
  lines.push('');
  addFieldRows(lines, rows, muted, value, errorStyle, warningStyle);

  const { ratio, tokens, maxTokens } = contextValues(options);
  lines.push('');
  lines.push(accent('Context window'));
  if (maxTokens > 0) {
    const safeRatio = safeUsageRatio(ratio);
    const barColor = severityToken(ratioSeverity(safeRatio));
    const barColoured = renderRendererRatioProgressBar({
      ratio: safeRatio,
      width: 20,
      filledStyle: (text) => currentTheme.fg(barColor, text),
      emptyStyle: (text) => currentTheme.fg(barColor, text),
    });
    lines.push(
      `  ${barColoured}  ${value(`${(safeRatio * 100).toFixed(1)}%`.padStart(6, ' '))}  ` +
        muted(`(${formatTokenCount(tokens)} / ${formatTokenCount(maxTokens)})`),
    );
  } else {
    lines.push(`  ${muted('No context window data available.')}`);
  }

  if (options.providerRouteStatus !== undefined && options.providerRouteStatus !== null) {
    lines.push('');
    lines.push(accent('Provider route'));
    addFieldRows(
      lines,
      providerRouteRows(options.providerRouteStatus),
      muted,
      value,
      errorStyle,
      warningStyle,
    );
  }

  lines.push('');
  lines.push(accent('Readiness'));
  addFieldRows(
    lines,
    readinessRows(options),
    muted,
    value,
    errorStyle,
    warningStyle,
  );

  const managedSection = buildManagedUsageReportLines({
    managedUsage: options.managedUsage,
    managedUsageError: options.managedUsageError,
  });
  if (managedSection.length > 0) {
    lines.push('');
    lines.push(...managedSection);
  }

  return lines;
}
