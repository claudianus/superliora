import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { workspaceRelativePath, CANONICAL_EVIDENCE_ROOT, WORKSPACE_DATA_DIR } from '#/constant/workspace-data';

import type { MemorySearchResult, MemoryStats } from '@superliora/sdk';

import { loadBenchStatus, redactBenchStatusText, type BenchStatus } from './bench';
import type { SlashCommandHost } from './dispatch';
import { requestTUILayoutRender } from '../utils/frame-render';
import {
  formatEvidenceSignal,
  loadMemoryReadinessEvidence,
  type MemoryReadinessSnapshot,
} from './evidence-readiness';
import { redactMemoryReadinessText } from './memory';

const DEFAULT_PREFLIGHT_RECALL_QUERY = 'superliora harness knowledge-map browser-use computer-use llm-wiki readiness';
const PREFLIGHT_RECALL_MEMORY_SUBJECT = 'preflight-readiness';
const PREFLIGHT_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREFLIGHT_REFRESH_COMMAND = 'node scripts/liora-preflight-refresh.mjs';
const PREFLIGHT_BENCH_LOOP_COMMAND = 'node scripts/liora-agent-bench.mjs --loop --max-iterations 2';
const PREFLIGHT_BENCH_LOOP_MAX_ITERATIONS = 2;
const PREFLIGHT_BENCH_LOOP_MAX_TOTAL_MS = 600_000;
const PREFLIGHT_ULTRAWORK_CONTRACT_PATH = 'apps/liora/src/tui/commands/ultrawork-contract.ts';

const CANONICAL_PREFLIGHT_REFRESH_EVIDENCE_ROOT = `${CANONICAL_EVIDENCE_ROOT}/superliora-preflight-refresh`;
const CANONICAL_PREFLIGHT_RUNTIME_EVIDENCE_ROOT = `${CANONICAL_EVIDENCE_ROOT}/preflight-readiness`;
const CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT = `${CANONICAL_EVIDENCE_ROOT}/liora-agent-bench`;
const CANONICAL_SOTA_CRITERIA_PATH = `${WORKSPACE_DATA_DIR}/bench/sota-criteria.json`;

function preflightRefreshEvidenceRoot(workDir: string): string {
  return workspaceRelativePath(workDir, 'evidence', 'superliora-preflight-refresh');
}

function preflightRuntimeEvidenceRoot(workDir: string): string {
  return workspaceRelativePath(workDir, 'evidence', 'preflight-readiness');
}

function preflightBenchLoopEvidenceRoot(workDir: string): string {
  return workspaceRelativePath(workDir, 'evidence', 'liora-agent-bench');
}

function preflightSotaCriteriaPath(workDir: string): string {
  return workspaceRelativePath(workDir, 'bench', 'sota-criteria.json');
}
const HUMAN_WRITING_CONTRACT_PHRASES = [
  'Human Writing / Anti-Slop',
  'not a bottleneck on code',
  'light pass',
  'Dynamic routing',
  'response language',
  'Locale-specific skills are discovered via SearchSkill',
  'never assume a default language',
  'surface-specific voice lane',
  'plain specific claims, concrete nouns and verbs',
  'source-backed details',
  'self-audit for template openings',
  'avoid-ai-writing style checks',
  'Do not treat AI-writing detectors as truth',
  'never use detector signals to accuse an author',
  'deterministic unslop cleanup only as advisory pattern checks',
  'reread for changed meaning',
] as const;
const HUMAN_WRITING_RUBRIC_PHRASES = [
  'quality gate for user-facing prose',
  'light pass',
  'Dynamic routing',
  'response language',
  'Locale-specific skills are discovered',
  'surface-specific voice lane',
  'plain specific claims',
  'source-backed details',
  'Self-audit for template openings',
  'avoid-ai-writing checks',
  'Do not treat AI-writing detectors as truth',
  'accuse an author',
  'second-pass rewrite or deterministic cleanup',
  'reread for changed meaning',
] as const;

type PreflightFreshnessState = 'fresh' | 'stale' | 'missing';

export interface PreflightFreshnessSignal {
  readonly state: PreflightFreshnessState;
  readonly ageMs?: number;
  readonly sourcePath?: string;
}

export interface PreflightFreshness {
  readonly ready: boolean;
  readonly windowMs: number;
  readonly bench: PreflightFreshnessSignal;
  readonly llmWiki: PreflightFreshnessSignal;
  readonly knowledgeMap: PreflightFreshnessSignal;
  readonly browserUse: PreflightFreshnessSignal;
  readonly computerUse: PreflightFreshnessSignal;
}

export interface PreflightRefreshPlan {
  readonly needed: boolean;
  readonly reason: string;
  readonly command: string;
  readonly evidencePath: string;
  readonly runtimeEvidencePath: string;
}

export interface PreflightRefreshRun {
  readonly status: string;
  readonly evidencePath: string;
  readonly durationMs?: number;
  readonly completedAt?: string;
  readonly bench?: PreflightRefreshBench;
  readonly readinessGates?: PreflightRefreshGates;
  readonly runtimeCandidates: readonly PreflightRuntimeCandidate[];
  readonly missingChannels: readonly string[];
  readonly warning?: string;
}

export interface PreflightRuntimeCandidate {
  readonly channel: string;
  readonly state: string;
  readonly sourcePath: string;
}

export interface PreflightRefreshGates {
  readonly total?: number;
  readonly passed?: number;
  readonly blocked: readonly string[];
  readonly nextAction?: string;
}

export interface PreflightRefreshBench {
  readonly score?: number;
  readonly passRate?: number;
  readonly scored?: number;
  readonly passed?: number;
  readonly failed?: number;
  readonly blocked?: number;
  readonly quarantined?: number;
  readonly wallClockMs?: number;
  readonly estimatedTokens?: number;
  readonly commandCount?: number;
}

export interface PreflightLoopRun {
  readonly status: string;
  readonly evidencePath: string;
  readonly evidenceRoot?: string;
  readonly rerunCommand?: string;
  readonly completedAt?: string;
  readonly evidenceMtimeMs?: number;
  readonly stopReason?: string;
  readonly bestScore?: number;
  readonly firstScore?: number;
  readonly lastScore?: number;
  readonly iterations?: number;
  readonly maxIterations?: number;
  readonly selected?: number;
  readonly scored?: number;
  readonly passed?: number;
  readonly failed?: number;
  readonly blocked?: number;
  readonly quarantined?: number;
  readonly quarantineTask?: string;
  readonly quarantineFindings?: readonly string[];
  readonly proposal?: string;
  readonly warning?: string;
}

export interface PreflightHumanWriting {
  readonly ready: boolean;
  readonly contractReady: boolean;
  readonly rubricReady: boolean;
  readonly advisoryOnly: boolean;
  readonly contractPath: string;
  readonly rubricPath: string;
  readonly nextAction: string;
  readonly warning?: string;
}

export interface PreflightStatus {
  readonly bench: BenchStatus;
  readonly memory: MemoryReadinessSnapshot;
  readonly freshness: PreflightFreshness;
  readonly humanWriting: PreflightHumanWriting;
  readonly refreshPlan: PreflightRefreshPlan;
  readonly refreshRun?: PreflightRefreshRun;
  readonly loopRun?: PreflightLoopRun;
  readonly ready: boolean;
  readonly nextAction: string;
}

interface PreflightArgs {
  readonly benchArgs: string;
  readonly query: string;
}

export async function handlePreflightCommand(host: SlashCommandHost, rawArgs: string): Promise<void> {
  const { UsagePanelComponent } = await import('../components/messages/usage-panel');
  const status = await loadPreflightStatus(host, rawArgs);
  const panel = new UsagePanelComponent(() => buildPreflightLines(status), 'primary', ' Preflight ');
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

export async function loadPreflightStatus(
  host: SlashCommandHost,
  rawArgs: string,
): Promise<PreflightStatus> {
  const args = parsePreflightArgs(rawArgs);
  const bench = loadBenchStatus(host.state.appState.workDir, args.benchArgs);
  const statsResult = await loadPreflightMemoryStats(host);
  const searchResult = await loadPreflightMemorySearch(host, args.query);
  return buildPreflightStatus({
    bench,
    memory: {
      stats: 'stats' in statsResult ? statsResult.stats : undefined,
      statsError: 'error' in statsResult ? statsResult.error : undefined,
      query: args.query,
      searchResults: searchResult.results,
      searchError: searchResult.error,
      evidence: loadMemoryReadinessEvidence(host.state.appState.workDir),
    },
    refreshRun: loadPreflightRefreshRun(host.state.appState.workDir),
    loopRun: loadPreflightLoopRun(host.state.appState.workDir),
    humanWriting: loadPreflightHumanWriting(host.state.appState.workDir),
  });
}

export function buildPreflightStatus(input: {
  readonly bench: BenchStatus;
  readonly memory: MemoryReadinessSnapshot;
  readonly freshness?: PreflightFreshness;
  readonly humanWriting?: PreflightHumanWriting;
  readonly refreshRun?: PreflightRefreshRun;
  readonly loopRun?: PreflightLoopRun;
  readonly nowMs?: number;
  readonly freshnessWindowMs?: number;
}): PreflightStatus {
  const freshness = input.freshness ?? buildPreflightFreshness({
    bench: input.bench,
    memory: input.memory,
    nowMs: input.nowMs ?? Date.now(),
    windowMs: input.freshnessWindowMs ?? PREFLIGHT_FRESHNESS_WINDOW_MS,
  });
  const nextAction = nextPreflightAction(input.bench, input.memory, freshness);
  const refreshPlan = buildPreflightRefreshPlan(input.bench, input.memory, freshness);
  const humanWriting = input.humanWriting ?? defaultPreflightHumanWriting();
  return {
    bench: input.bench,
    memory: input.memory,
    freshness,
    humanWriting,
    refreshPlan,
    refreshRun: input.refreshRun,
    loopRun: input.loopRun,
    ready: isBenchReady(input.bench)
      && isMemoryReady(input.memory)
      && isRecallReady(input.memory)
      && input.memory.evidence.llmWiki.verified
      && input.memory.evidence.knowledgeMap.verified
      && input.memory.evidence.browserUse.ready
      && input.memory.evidence.computerUse.ready
      && freshness.ready
      && humanWriting.ready,
    nextAction: humanWriting.ready ? nextAction : humanWriting.nextAction,
  };
}

export function buildPreflightFreshness(input: {
  readonly bench: BenchStatus;
  readonly memory: MemoryReadinessSnapshot;
  readonly nowMs?: number;
  readonly windowMs?: number;
}): PreflightFreshness {
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = input.windowMs ?? PREFLIGHT_FRESHNESS_WINDOW_MS;
  const freshness = {
    windowMs,
    bench: evidenceFreshnessSignal(input.bench.sourcePath, nowMs, windowMs),
    llmWiki: evidenceFreshnessSignal(input.memory.evidence.llmWiki.sourcePath, nowMs, windowMs),
    knowledgeMap: evidenceFreshnessSignal(input.memory.evidence.knowledgeMap.sourcePath, nowMs, windowMs),
    browserUse: evidenceFreshnessSignal(input.memory.evidence.browserUse.sourcePath, nowMs, windowMs),
    computerUse: evidenceFreshnessSignal(input.memory.evidence.computerUse.sourcePath, nowMs, windowMs),
  };
  return {
    ...freshness,
    ready: freshness.bench.state === 'fresh'
      && freshness.llmWiki.state === 'fresh'
      && freshness.knowledgeMap.state === 'fresh'
      && freshness.browserUse.state === 'fresh'
      && freshness.computerUse.state === 'fresh',
  };
}

export function buildPreflightLines(status: PreflightStatus): string[] {
  const lines = [
    'SuperLiora Preflight',
    `Unified status  ${status.ready ? 'ready' : 'blocked'}`,
    `Bench  ${readyWord(isBenchReady(status.bench))}; status ${status.bench.status}`,
    `Bench score  ${formatScore(status.bench.score)}; passRate ${formatPassRate(status.bench.passRate)}`,
    `Memory  ${readyWord(isMemoryReady(status.memory))}; ${memoryStatsSummary(status.memory.stats, status.memory.statsError)}`,
    `Recall  ${readyWord(isRecallReady(status.memory))}; ${recallSummary(status.memory)}`,
    `LLM-wiki evidence  ${readyWord(status.memory.evidence.llmWiki.verified)}; ${formatEvidenceSignal(status.memory.evidence.llmWiki)}`,
    `Knowledge-map evidence  ${readyWord(status.memory.evidence.knowledgeMap.verified)}; ${formatEvidenceSignal(status.memory.evidence.knowledgeMap)}`,
    `Browser-use evidence  ${readyWord(status.memory.evidence.browserUse.ready)}`,
    `Computer-use evidence  ${readyWord(status.memory.evidence.computerUse.ready)}`,
    `Ready gates  ${readinessGateSummary(status)}`,
    `Human writing  ${readyWord(status.humanWriting.ready)}; ${humanWritingSummary(status.humanWriting)}`,
    `Freshness  ${readyWord(status.freshness.ready)}; window ${formatDuration(status.freshness.windowMs)}`,
    `Bench age  ${freshnessSummary(status.freshness.bench)}`,
    `LLM-wiki age  ${freshnessSummary(status.freshness.llmWiki)}`,
    `Knowledge-map age  ${freshnessSummary(status.freshness.knowledgeMap)}`,
    `Browser-use age  ${freshnessSummary(status.freshness.browserUse)}`,
    `Computer-use age  ${freshnessSummary(status.freshness.computerUse)}`,
    `Boundary  ${status.bench.noSecret ? 'no secret-looking strings displayed' : 'review evidence before sharing'}`,
    'No-web  browser UI excluded',
    `Next  ${status.nextAction}`,
    `Loop cue  ${loopCueSummary(status)}`,
    `Loop command  ${loopCommandSummary(status)}`,
    `Loop evidence  ${loopEvidenceSummary(status)}`,
    `Loop rerun  ${loopRerunSummary(status.loopRun)}`,
    `Loop inspect  ${loopInspectSummary(status.loopRun)}`,
    `Loop budget  ${loopBudgetSummary(status)}`,
    `Loop last  ${loopRunSummary(status.loopRun)}`,
    `Loop scope  ${loopScopeSummary(status.loopRun)}`,
    `Loop guard  ${loopGuardSummary(status.loopRun)}`,
    `Loop files  ${loopGuardFilesSummary(status.loopRun)}`,
    `Loop delta  ${loopDeltaSummary(status.loopRun)}`,
    `Loop age  ${loopAgeSummary(status.loopRun)}`,
    `Loop proposal  ${loopProposalSummary(status.loopRun)}`,
    `Loop next  ${loopNextSummary(status.loopRun)}`,
  ];

  if (status.refreshPlan.needed) {
    lines.push(`Refresh  ${status.refreshPlan.reason}`);
    lines.push(`Refresh command  ${status.refreshPlan.command}`);
    lines.push(`Refresh evidence  ${status.refreshPlan.evidencePath}`);
    lines.push(`Refresh runtime  ${status.refreshPlan.runtimeEvidencePath}`);
  }

  if (status.refreshRun !== undefined) {
    lines.push(`Refresh last  ${refreshRunSummary(status.refreshRun)}`);
    lines.push(`Refresh age  ${refreshAgeSummary(status.refreshRun)}`);
    const benchSummary = refreshBenchSummary(status.refreshRun.bench);
    if (benchSummary !== undefined) lines.push(`Refresh bench  ${benchSummary}`);
    const gatesSummary = refreshGatesSummary(status.refreshRun.readinessGates);
    if (gatesSummary !== undefined) lines.push(`Refresh gates  ${gatesSummary}`);
    const candidatesSummary = refreshCandidatesSummary(status.refreshRun.runtimeCandidates);
    if (candidatesSummary !== undefined) {
      lines.push(`Refresh candidates  ${candidatesSummary}`);
      lines.push('Refresh candidate inspect  summary.md under Refresh last evidence');
      lines.push(`Refresh candidate action  ${refreshCandidateActionSummary(
        status.refreshRun.runtimeCandidates,
      )}`);
      lines.push(`Refresh candidate target  ${status.refreshPlan.runtimeEvidencePath}`);
      lines.push('Refresh candidate rerun  node scripts/liora-preflight-refresh.mjs');
    }
    lines.push(`Refresh last evidence  ${status.refreshRun.evidencePath}`);
  }

  for (const warning of status.bench.warnings) {
    lines.push(`Warning  bench: ${warning}`);
  }
  for (const warning of status.memory.evidence.warnings) {
    lines.push(`Warning  memory: ${warning}`);
  }
  if (status.refreshRun?.warning !== undefined) {
    lines.push(`Warning  refresh: ${status.refreshRun.warning}`);
  }
  if (status.loopRun?.warning !== undefined) {
    lines.push(`Warning  loop: ${status.loopRun.warning}`);
  }
  if (status.humanWriting.warning !== undefined) {
    lines.push(`Warning  human-writing: ${status.humanWriting.warning}`);
  }

  lines.push(`Bench source  ${status.bench.sourcePath}`);
  lines.push(`Memory source  ${status.memory.evidence.sourceRoot}`);
  lines.push(`Human writing source  ${status.humanWriting.contractPath}; ${status.humanWriting.rubricPath}`);
  return lines.map(redactPreflightText);
}

export function redactPreflightText(text: string): string {
  return redactMemoryReadinessText(redactBenchStatusText(text))
    .replaceAll('[[REDACTED_ENV]]', '[REDACTED_SECRET]');
}

function parsePreflightArgs(rawArgs: string): PreflightArgs {
  const args = rawArgs.trim();
  if (args.length === 0) {
    return { benchArgs: '', query: DEFAULT_PREFLIGHT_RECALL_QUERY };
  }

  const queryIndex = args.indexOf('--query=');
  if (queryIndex >= 0) {
    return {
      benchArgs: args.slice(0, queryIndex).trim(),
      query: args.slice(queryIndex + '--query='.length).trim() || DEFAULT_PREFLIGHT_RECALL_QUERY,
    };
  }

  return { benchArgs: args, query: DEFAULT_PREFLIGHT_RECALL_QUERY };
}

export function loadPreflightRefreshRun(workDir: string): PreflightRefreshRun | undefined {
  const summaryPath = join(workDir, preflightRefreshEvidenceRoot(workDir), 'summary.json');
  if (!existsSync(summaryPath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
    const bench = asRecord(data['bench']);
    const missing = Array.isArray(data['missingOrStaleRuntimeEvidence'])
      ? data['missingOrStaleRuntimeEvidence']
        .map((item) => asRecord(item)?.['channel'])
        .filter((channel): channel is string => typeof channel === 'string')
      : [];
    return {
      status: typeof data['status'] === 'string' ? data['status'] : 'UNKNOWN',
      evidencePath: preflightRefreshEvidenceRoot(workDir),
      durationMs: typeof data['durationMs'] === 'number' ? data['durationMs'] : undefined,
      completedAt: typeof data['completedAt'] === 'string' ? data['completedAt'] : undefined,
      bench: loadPreflightRefreshBench(bench),
      readinessGates: loadPreflightRefreshGates(asRecord(data['readinessGates'])),
      runtimeCandidates: loadPreflightRuntimeCandidates(
        asRecord(data['runtimeEvidenceCandidates']),
        workDir,
      ),
      missingChannels: missing,
    };
  } catch (error) {
    return {
      status: 'UNREADABLE',
      evidencePath: preflightRefreshEvidenceRoot(workDir),
      runtimeCandidates: [],
      missingChannels: [],
      warning: `unreadable refresh summary at ${summaryPath}: ${formatPreflightError(error)}`,
    };
  }
}

export function loadPreflightHumanWriting(workDir: string): PreflightHumanWriting {
  const contractPath = join(workDir, PREFLIGHT_ULTRAWORK_CONTRACT_PATH);
  const rubricPath = join(workDir, preflightSotaCriteriaPath(workDir));
  const contractText = readText(contractPath);
  const rubric = readJsonRecord(rubricPath);
  const rubricItems = asRecord(rubric?.['loopScoreRubric'])?.['humanWriting'];
  const rubricText = Array.isArray(rubricItems) ? rubricItems.join('\n') : '';
  const missingContract = contractText === undefined
    ? [...HUMAN_WRITING_CONTRACT_PHRASES]
    : missingPhrases(contractText, HUMAN_WRITING_CONTRACT_PHRASES);
  const missingRubric = missingPhrases(rubricText, HUMAN_WRITING_RUBRIC_PHRASES);
  const advisoryOnly = contractText !== undefined
    && /AI-writing detectors[\s\S]*truth/i.test(contractText)
    && /advisory pattern checks/i.test(contractText);
  const contractReady = contractText !== undefined && missingContract.length === 0 && advisoryOnly;
  const rubricReady = rubricText.length > 0 && missingRubric.length === 0;
  const ready = contractReady && rubricReady;
  const blocked = [
    ...(contractReady ? [] : ['contract']),
    ...(rubricReady ? [] : ['rubric']),
    ...(advisoryOnly ? [] : ['advisoryOnly']),
  ];
  return {
    ready,
    contractReady,
    rubricReady,
    advisoryOnly,
    contractPath: displayPath(workDir, contractPath),
    rubricPath: displayPath(workDir, rubricPath),
    nextAction: ready
      ? 'Human-writing anti-slop contract ready; keep detector signals advisory-only.'
      : `Restore human-writing ${blocked.join('/')} guidance, then rerun /preflight.`,
    warning: ready ? undefined : `blocked ${blocked.join(',')}`,
  };
}

export function loadPreflightLoopRun(workDir: string): PreflightLoopRun | undefined {
  const loopEvidenceRoot = join(workDir, preflightBenchLoopEvidenceRoot(workDir));
  if (!existsSync(loopEvidenceRoot)) return undefined;
  const summaryPath = latestLoopSummaryPath(loopEvidenceRoot);
  if (summaryPath === undefined) return undefined;
  const data = readJsonRecord(summaryPath);
  const evidencePath = displayPath(workDir, summaryPath);
  const displayEvidenceRoot = displayPath(workDir, dirname(summaryPath));
  if (data === undefined) {
    return {
      status: 'UNREADABLE',
      evidencePath,
      evidenceRoot: displayEvidenceRoot,
      warning: `unreadable loop summary at ${summaryPath}`,
    };
  }
  const rerun = asRecord(data['rerun']);
  const iterations = Array.isArray(data['iterations']) ? data['iterations'].length : undefined;
  const firstIteration = Array.isArray(data['iterations'])
    ? asRecord(data['iterations'].at(0))
    : undefined;
  const lastIteration = Array.isArray(data['iterations'])
    ? asRecord(data['iterations'].at(-1))
    : undefined;
  const counts = asRecord(lastIteration?.['counts']);
  const quarantine = asRecord(lastIteration?.['quarantine']);
  const quarantineTasks = Array.isArray(quarantine?.['tasks']) ? quarantine['tasks'] : [];
  const quarantineTask = asRecord(quarantineTasks.at(0));
  const quarantineFindings = Array.isArray(quarantineTask?.['findings'])
    ? quarantineTask['findings'].filter((finding): finding is string => typeof finding === 'string')
    : undefined;
  return {
    status: typeof data['status'] === 'string' ? data['status'] : 'UNKNOWN',
    evidencePath,
    evidenceRoot: displayEvidenceRoot,
    rerunCommand: typeof rerun?.['command'] === 'string'
      ? rerun['command']
      : fallbackLoopRerunCommand(displayEvidenceRoot, numberField(data, 'maxIterations')),
    completedAt: timestampField(data),
    evidenceMtimeMs: fileMtimeMs(summaryPath),
    stopReason: typeof data['stopReason'] === 'string' ? data['stopReason'] : undefined,
    bestScore: numberField(data, 'bestScore'),
    firstScore: numberField(firstIteration, 'score'),
    lastScore: numberField(lastIteration, 'score'),
    iterations,
    maxIterations: numberField(data, 'maxIterations'),
    selected: numberField(counts, 'selected'),
    scored: numberField(counts, 'scored'),
    passed: numberField(counts, 'passed'),
    failed: numberField(counts, 'failed'),
    blocked: numberField(counts, 'blocked'),
    quarantined: numberField(counts, 'quarantined'),
    quarantineTask: typeof quarantineTask?.['id'] === 'string' ? quarantineTask['id'] : undefined,
    quarantineFindings,
    proposal: typeof lastIteration?.['proposal'] === 'string' ? lastIteration['proposal'] : undefined,
  };
}

function fallbackLoopRerunCommand(evidenceRoot: string | undefined, maxIterations: number | undefined): string {
  const iterations = maxIterations ?? PREFLIGHT_BENCH_LOOP_MAX_ITERATIONS;
  if (evidenceRoot === undefined) return PREFLIGHT_BENCH_LOOP_COMMAND;
  return `node scripts/liora-agent-bench.mjs --loop --max-iterations ${iterations} --evidence-root ${evidenceRoot}`;
}

function latestLoopSummaryPath(root: string): string | undefined {
  const candidates: Array<{ readonly path: string; readonly timestamp: number }> = [];
  collectLoopSummaryPaths(root, 0, candidates);
  return candidates.toSorted((a, b) => b.timestamp - a.timestamp)[0]?.path;
}

function collectLoopSummaryPaths(
  dir: string,
  depth: number,
  candidates: Array<{ readonly path: string; readonly timestamp: number }>,
): void {
  if (depth > 4) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLoopSummaryPaths(path, depth + 1, candidates);
      continue;
    }
    if (entry.isFile() && entry.name === 'loop-summary.json') {
      candidates.push({ path, timestamp: fileTimestamp(path) });
    }
  }
}

function fileTimestamp(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function displayPath(workDir: string, path: string): string {
  const prefix = `${workDir}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function loadPreflightRefreshBench(bench: Record<string, unknown> | undefined): PreflightRefreshBench | undefined {
  if (bench === undefined) return undefined;
  const summaryPath = typeof bench['summaryPath'] === 'string' ? bench['summaryPath'] : undefined;
  const summary = summaryPath === undefined ? undefined : readJsonRecord(summaryPath);
  const counts = asRecord(summary?.['counts']);
  const metrics = asRecord(summary?.['metrics']) ?? asRecord(summary?.['aggregateSummary']);
  return {
    score: numberField(bench, 'score') ?? numberField(metrics, 'score'),
    passRate: numberField(bench, 'passRate') ?? numberField(metrics, 'passRate'),
    scored: numberField(counts, 'scored'),
    passed: numberField(counts, 'passed'),
    failed: numberField(counts, 'failed'),
    blocked: numberField(counts, 'blocked'),
    quarantined: numberField(counts, 'quarantined'),
    wallClockMs: numberField(metrics, 'wallClockMs'),
    estimatedTokens: numberField(metrics, 'estimatedTokens'),
    commandCount: numberField(metrics, 'commandCount'),
  };
}

function loadPreflightRefreshGates(record: Record<string, unknown> | undefined): PreflightRefreshGates | undefined {
  if (record === undefined) return undefined;
  const blocked = Array.isArray(record['blocked'])
    ? record['blocked']
      .map((item) => {
        if (typeof item === 'string') return item;
        return asRecord(item)?.['id'];
      })
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  const nextAction = typeof record['nextAction'] === 'string' ? record['nextAction'] : undefined;
  const gates = {
    total: numberField(record, 'total'),
    passed: numberField(record, 'passed'),
    blocked,
    nextAction,
  };
  if (gates.total === undefined && gates.passed === undefined && blocked.length === 0 && nextAction === undefined) {
    return undefined;
  }
  return gates;
}

function loadPreflightRuntimeCandidates(
  record: Record<string, unknown> | undefined,
  workDir: string,
): readonly PreflightRuntimeCandidate[] {
  if (record === undefined) return [];
  return Object.entries(record).flatMap(([channel, value]) => {
    const candidate = asRecord(value);
    const state = typeof candidate?.['state'] === 'string' ? candidate['state'] : undefined;
    const sourcePath = typeof candidate?.['sourcePath'] === 'string' ? candidate['sourcePath'] : undefined;
    if (state === undefined || sourcePath === undefined) return [];
    return [{ channel, state, sourcePath: displayPath(workDir, sourcePath) }];
  });
}

function readJsonRecord(path: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function loadPreflightMemoryStats(
  host: SlashCommandHost,
): Promise<{ readonly stats: MemoryStats } | { readonly error: string }> {
  try {
    return { stats: await host.harness.memory.stats() };
  } catch (error) {
    return { error: formatPreflightError(error) };
  }
}

async function loadPreflightMemorySearch(
  host: SlashCommandHost,
  query: string,
): Promise<{ readonly results?: readonly MemorySearchResult[]; readonly error?: string }> {
  if (query.length === 0) return {};
  try {
    const results = host.session === undefined
      ? await host.harness.memory.search({ query, limit: 3 })
      : await host.session.recall(query, { limit: 3 });
    return { results };
  } catch (error) {
    return { error: formatPreflightError(error) };
  }
}

function isBenchReady(bench: BenchStatus): boolean {
  if (!bench.noSecret || bench.status === 'UNAVAILABLE') return false;
  const status = bench.status.toUpperCase();
  return status.includes('PASS') || status.includes('APPROVE') || bench.score === 1 || bench.passRate === 1;
}

function isMemoryReady(memory: MemoryReadinessSnapshot): boolean {
  return memory.stats !== undefined && memory.stats.active > 0;
}

function isRecallReady(memory: MemoryReadinessSnapshot): boolean {
  return memory.query.length > 0
    && memory.searchError === undefined
    && (memory.searchResults?.length ?? 0) > 0;
}

function nextPreflightAction(
  bench: BenchStatus,
  memory: MemoryReadinessSnapshot,
  freshness: PreflightFreshness,
): string {
  if (!isBenchReady(bench)) return bench.nextAction;
  if (!isMemoryReady(memory)) return `Run ${preflightRecallMemoryCommand(memory.query)}.`;
  if (memory.query.length === 0) return 'Run /preflight --query=<recall query> to verify Liora Recall retrieval.';
  if (memory.searchError !== undefined) return 'Fix recall search, then rerun /preflight.';
  if ((memory.searchResults?.length ?? 0) === 0) return `Run ${preflightRecallMemoryCommand(memory.query)}, then rerun /preflight.`;
  if (!memory.evidence.llmWiki.ready) return preflightRuntimeEvidenceAction('llm-wiki/durable-memory');
  if (!memory.evidence.llmWiki.verified) {
    return `Run /memory verify to promote LLM Wiki seed to verified, then rerun /preflight.`;
  }
  if (!memory.evidence.knowledgeMap.ready) return preflightRuntimeEvidenceAction('Liora Knowledge Map');
  if (!memory.evidence.knowledgeMap.verified) {
    return `Run /memory verify to promote Liora Knowledge Map seed to verified, then rerun /preflight.`;
  }
  if (!memory.evidence.browserUse.ready) return preflightRuntimeEvidenceAction('browser-use');
  if (!memory.evidence.computerUse.ready) return preflightRuntimeEvidenceAction('computer-use');
  if (!freshness.ready) {
    return 'Run the Refresh commands below, recapture runtime evidence, then rerun /preflight.';
  }
  return 'Ready: run the next bounded Ultrawork loop from this preflight.';
}

function preflightRecallMemoryCommand(query: string): string {
  const content = query.trim().length === 0 ? DEFAULT_PREFLIGHT_RECALL_QUERY : query.trim();
  return `/memory remember ${PREFLIGHT_RECALL_MEMORY_SUBJECT} :: ${content}`;
}

function preflightRuntimeEvidenceAction(label: string): string {
  return `Capture ${label} evidence under ${CANONICAL_PREFLIGHT_RUNTIME_EVIDENCE_ROOT}, then run Refresh command below.`;
}

function buildPreflightRefreshPlan(
  bench: BenchStatus,
  memory: MemoryReadinessSnapshot,
  freshness: PreflightFreshness,
): PreflightRefreshPlan {
  const missingRuntimeEvidence = !memory.evidence.llmWiki.verified
    || !memory.evidence.knowledgeMap.verified
    || !memory.evidence.browserUse.ready
    || !memory.evidence.computerUse.ready;
  const needed = !isBenchReady(bench) || missingRuntimeEvidence || !freshness.ready;
  return {
    needed,
    reason: needed ? refreshReason(bench, memory, freshness) : 'not needed',
    command: PREFLIGHT_REFRESH_COMMAND,
    evidencePath: `${CANONICAL_PREFLIGHT_REFRESH_EVIDENCE_ROOT} (bench + runtime audit)`,
    runtimeEvidencePath: CANONICAL_PREFLIGHT_RUNTIME_EVIDENCE_ROOT,
  };
}

function refreshReason(
  bench: BenchStatus,
  memory: MemoryReadinessSnapshot,
  freshness: PreflightFreshness,
): string {
  if (!isBenchReady(bench)) return 'benchmark evidence unavailable';
  if (!freshness.ready) return 'evidence stale or missing';
  if (!memory.evidence.llmWiki.ready) return 'llm-wiki evidence missing';
  if (!memory.evidence.llmWiki.verified) return 'llm-wiki evidence seed-only';
  if (!memory.evidence.knowledgeMap.ready) return 'knowledge-map evidence missing';
  if (!memory.evidence.knowledgeMap.verified) return 'knowledge-map evidence seed-only';
  if (!memory.evidence.browserUse.ready) return 'browser-use evidence missing';
  if (!memory.evidence.computerUse.ready) return 'computer-use evidence missing';
  return 'not needed';
}

function evidenceFreshnessSignal(
  sourcePath: string | undefined,
  nowMs: number,
  windowMs: number,
): PreflightFreshnessSignal {
  if (sourcePath === undefined) return { state: 'missing' };
  try {
    const stat = statSync(sourcePath);
    const ageMs = Math.max(0, nowMs - stat.mtimeMs);
    return {
      state: ageMs <= windowMs ? 'fresh' : 'stale',
      ageMs,
      sourcePath,
    };
  } catch {
    return { state: 'missing', sourcePath };
  }
}

function readyWord(ready: boolean): string {
  return ready ? 'ready' : 'blocked';
}

function readinessGateSummary(status: PreflightStatus): string {
  const gates = [
    { name: 'bench', ready: isBenchReady(status.bench) },
    { name: 'memory', ready: isMemoryReady(status.memory) },
    { name: 'recall', ready: isRecallReady(status.memory) },
    { name: 'llmWiki', ready: status.memory.evidence.llmWiki.verified },
    { name: 'knowledgeMap', ready: status.memory.evidence.knowledgeMap.verified },
    { name: 'browserUse', ready: status.memory.evidence.browserUse.ready },
    { name: 'computerUse', ready: status.memory.evidence.computerUse.ready },
    { name: 'freshness', ready: status.freshness.ready },
    { name: 'humanWriting', ready: status.humanWriting.ready },
  ];
  const readyCount = gates.filter((gate) => gate.ready).length;
  const blocked = gates.filter((gate) => !gate.ready).map((gate) => gate.name);
  return `${readyCount}/${gates.length}; blocked ${blocked.length === 0 ? 'none' : blocked.join(',')}`;
}

function humanWritingSummary(humanWriting: PreflightHumanWriting): string {
  if (humanWriting.ready) return 'anti-slop advisory-only';
  const blocked = [
    ...(humanWriting.contractReady ? [] : ['contract']),
    ...(humanWriting.rubricReady ? [] : ['rubric']),
    ...(humanWriting.advisoryOnly ? [] : ['advisory-only']),
  ];
  return `blocked ${blocked.join(',')}; advisory-only required`;
}

function defaultPreflightHumanWriting(): PreflightHumanWriting {
  return {
    ready: true,
    contractReady: true,
    rubricReady: true,
    advisoryOnly: true,
    contractPath: PREFLIGHT_ULTRAWORK_CONTRACT_PATH,
    rubricPath: CANONICAL_SOTA_CRITERIA_PATH,
    nextAction: 'Human-writing anti-slop contract ready; keep detector signals advisory-only.',
  };
}

function missingPhrases(text: string, phrases: readonly string[]): readonly string[] {
  return phrases.filter((phrase) => !text.includes(phrase));
}

function freshnessSummary(signal: PreflightFreshnessSignal): string {
  if (signal.ageMs === undefined) return signal.state;
  return `${signal.state}; ${formatDuration(signal.ageMs)}`;
}

function formatDuration(durationMs: number): string {
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (durationMs < minuteMs) return '0m';
  if (durationMs < hourMs) return `${Math.floor(durationMs / minuteMs)}m`;
  if (durationMs <= dayMs) return `${Math.floor(durationMs / hourMs)}h`;
  return `${Math.floor(durationMs / dayMs)}d`;
}

function refreshRunSummary(run: PreflightRefreshRun): string {
  const elapsed = run.durationMs === undefined ? 'elapsed unknown' : `elapsed ${formatElapsed(run.durationMs)}`;
  const missing = run.missingChannels.length === 0 ? 'runtime ok' : `missing ${run.missingChannels.join(',')}`;
  return `${run.status}; ${elapsed}; ${missing}`;
}

interface RefreshAgeDetails {
  readonly state: 'fresh' | 'stale';
  readonly ageMs: number;
  readonly horizonMs: number;
}

function refreshAgeSummary(run: PreflightRefreshRun, nowMs = Date.now()): string {
  const details = refreshAgeDetails(run, nowMs);
  if (details === undefined) return 'unknown';
  const horizonLabel = details.state === 'fresh' ? 'due' : 'expired';
  return `${details.state}; ${formatDuration(details.ageMs)}; ${horizonLabel} ${formatDuration(details.horizonMs)}`;
}

function refreshAgeDetails(run: PreflightRefreshRun, nowMs = Date.now()): RefreshAgeDetails | undefined {
  if (run.completedAt === undefined) return undefined;
  const completedMs = Date.parse(run.completedAt);
  if (!Number.isFinite(completedMs)) return undefined;
  const ageMs = Math.max(0, nowMs - completedMs);
  return {
    state: ageMs <= PREFLIGHT_FRESHNESS_WINDOW_MS ? 'fresh' : 'stale',
    ageMs,
    horizonMs: Math.abs(PREFLIGHT_FRESHNESS_WINDOW_MS - ageMs),
  };
}

function loopCueSummary(status: PreflightStatus, nowMs = Date.now()): string {
  const refreshRun = status.refreshRun;
  if (refreshRun === undefined) {
    return status.ready ? 'run_next_loop; refresh_due unknown' : 'refresh_now; no refresh_summary';
  }
  const details = refreshAgeDetails(refreshRun, nowMs);
  if (details === undefined) return 'review_refresh_summary; age unknown';
  if (details.state === 'stale') return `refresh_now; expired ${formatDuration(details.horizonMs)}`;
  return status.ready
    ? `run_next_loop; refresh_due ${formatDuration(details.horizonMs)}`
    : `refresh_now; refresh_due ${formatDuration(details.horizonMs)}`;
}

function loopCommandSummary(status: PreflightStatus, nowMs = Date.now()): string {
  if (shouldRunBenchLoop(status, nowMs)) return PREFLIGHT_BENCH_LOOP_COMMAND;
  return status.refreshPlan.command;
}

function loopEvidenceSummary(status: PreflightStatus, nowMs = Date.now()): string {
  if (shouldRunBenchLoop(status, nowMs)) return CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT;
  return status.refreshPlan.evidencePath;
}

function loopBudgetSummary(status: PreflightStatus, nowMs = Date.now()): string {
  if (!shouldRunBenchLoop(status, nowMs)) return 'refresh once; no bench iteration';
  return `${PREFLIGHT_BENCH_LOOP_MAX_ITERATIONS} iters; ${formatDuration(PREFLIGHT_BENCH_LOOP_MAX_TOTAL_MS)}; stop ceiling/no_delta`;
}

function loopRunSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `${run.status}; inspect ${run.evidencePath}`;
  const score = `score ${formatScore(run.bestScore)}`;
  const stop = run.stopReason === undefined ? 'stop unknown' : `stop ${run.stopReason}`;
  const iterations = run.iterations === undefined
    ? 'iter unknown'
    : `iter ${run.iterations}/${formatMetric(run.maxIterations)}`;
  return `${run.status}; ${score}; ${stop}; ${iterations}`;
}

function loopProposalSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect ${run.evidencePath}`;
  if (run.proposal === undefined || run.proposal.trim().length === 0) return 'none recorded';
  return compactLoopProposal(run.proposal);
}

function loopScopeSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  if (run.scored === undefined && run.selected === undefined) return 'unknown';
  const scope = `scored ${formatMetric(run.scored)}/${formatMetric(run.selected)}`;
  const passed = `pass ${formatMetric(run.passed)}`;
  const quarantined = `q ${formatMetric(run.quarantined)}`;
  const blocked = `blocked ${formatMetric(run.blocked)}`;
  const failed = `failed ${formatMetric(run.failed)}`;
  return `${scope}; ${passed}; ${quarantined}; ${blocked}; ${failed}`;
}

function loopRerunSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return `${PREFLIGHT_BENCH_LOOP_COMMAND} --evidence-root ${CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT}/latest`;
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  return run.rerunCommand ?? fallbackLoopRerunCommand(run.evidenceRoot ?? loopEvidenceRootFromPath(run.evidencePath), run.maxIterations);
}

function loopInspectSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return `${CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT}/latest/loop-summary.json`;
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  return run.evidencePath;
}

function loopEvidenceRootFromPath(evidencePath: string): string | undefined {
  if (!evidencePath.endsWith('/loop-summary.json')) return undefined;
  return dirname(evidencePath);
}

function loopGuardSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  if ((run.quarantined ?? 0) <= 0) return 'none';
  if (run.quarantineTask === undefined) return 'q details unknown';
  return `q ${run.quarantineTask}`;
}

function loopGuardFilesSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  if ((run.quarantined ?? 0) <= 0) return 'none';
  if (run.quarantineTask === undefined) return 'q details unknown';
  return run.quarantineFindings?.length ? run.quarantineFindings.join(',') : 'no_findings';
}

function loopDeltaSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  if (run.firstScore === undefined || run.lastScore === undefined) return 'unknown';
  if (run.iterations === undefined || run.iterations <= 1) return `single_iter score ${formatScore(run.lastScore)}`;
  const delta = run.lastScore - run.firstScore;
  const verdict = Math.abs(delta) < 0.005 ? 'no_delta' : delta > 0 ? 'improved' : 'regressed';
  return `${verdict} ${formatSignedDelta(delta)} from ${formatScore(run.firstScore)} to ${formatScore(run.lastScore)}`;
}

function loopAgeSummary(run: PreflightLoopRun | undefined, nowMs = Date.now()): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  const details = loopAgeDetails(run, nowMs);
  if (details === undefined) return 'unknown';
  const horizonLabel = details.state === 'fresh' ? 'due' : 'expired';
  return `${details.state}; ${formatDuration(details.ageMs)}; ${horizonLabel} ${formatDuration(details.horizonMs)}`;
}

function loopAgeDetails(run: PreflightLoopRun, nowMs = Date.now()): RefreshAgeDetails | undefined {
  const completedMs = run.completedAt === undefined ? undefined : Date.parse(run.completedAt);
  const sourceMs = completedMs !== undefined && Number.isFinite(completedMs)
    ? completedMs
    : run.evidenceMtimeMs;
  if (sourceMs === undefined || !Number.isFinite(sourceMs)) return undefined;
  const ageMs = Math.max(0, nowMs - sourceMs);
  return {
    state: ageMs <= PREFLIGHT_FRESHNESS_WINDOW_MS ? 'fresh' : 'stale',
    ageMs,
    horizonMs: Math.abs(PREFLIGHT_FRESHNESS_WINDOW_MS - ageMs),
  };
}

function loopNextSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'run_loop_first';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  const age = loopAgeDetails(run);
  if (age?.state === 'stale') return 'rerun_loop_first';
  if (age === undefined) return 'review_loop_age';
  if ((run.quarantined ?? 0) > 0) return 'fix_quarantine_then_rerun_loop';
  if (run.proposal === undefined || run.proposal.trim().length === 0) return 'review_loop_result';
  return 'implement_proposal_then_rerun_loop';
}

function compactLoopProposal(proposal: string): string {
  const normalized = proposal.trim().replaceAll(/\s+/g, ' ');
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 93)}...`;
}

function shouldRunBenchLoop(status: PreflightStatus, nowMs = Date.now()): boolean {
  const refreshRun = status.refreshRun;
  if (status.ready && refreshRun !== undefined) {
    const details = refreshAgeDetails(refreshRun, nowMs);
    if (details?.state === 'fresh') return true;
  }
  return status.ready && refreshRun === undefined;
}

function refreshBenchSummary(bench: PreflightRefreshBench | undefined): string | undefined {
  if (bench === undefined) return undefined;
  const quality = `score ${formatScore(bench.score)}; passRate ${formatPassRate(bench.passRate)}`;
  const counts = bench.scored === undefined
    ? 'tasks unavailable'
    : `tasks ${bench.passed ?? 0}/${bench.scored} passed; q ${bench.quarantined ?? 0}`;
  const cost = `cost ${formatMetric(bench.wallClockMs, 'ms')}; tok ${formatMetric(bench.estimatedTokens)}; cmd ${formatMetric(bench.commandCount)}`;
  return `${quality}; ${counts}; ${cost}`;
}

function refreshGatesSummary(gates: PreflightRefreshGates | undefined): string | undefined {
  if (gates === undefined) return undefined;
  const count = gates.total === undefined || gates.passed === undefined
    ? 'count unknown'
    : `${Math.round(gates.passed)}/${Math.round(gates.total)}`;
  const blocked = gates.blocked.length === 0 ? 'none' : gates.blocked.join(',');
  const next = gates.nextAction === undefined ? '' : `; next ${gates.nextAction}`;
  return `${count}; blocked ${blocked}${next}`;
}

function refreshCandidatesSummary(candidates: readonly PreflightRuntimeCandidate[]): string | undefined {
  if (candidates.length === 0) return undefined;
  const noun = candidates.length === 1 ? 'candidate' : 'candidates';
  const staleCount = candidates.filter((candidate) => candidate.state !== 'fresh').length;
  if (staleCount === 0) return `${candidates.length} ${noun}; all fresh`;
  return `${candidates.length} ${noun}; ${staleCount} stale`;
}

function refreshCandidateActionSummary(
  candidates: readonly PreflightRuntimeCandidate[],
): string {
  const count = candidates.length;
  const noun = count === 1 ? 'candidate' : 'candidates';
  return `recapture ${count} ${noun}`;
}

function formatMetric(value: number | undefined, suffix = ''): string {
  return value === undefined ? 'unknown' : `${String(Math.round(value))}${suffix}`;
}

function formatElapsed(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  if (durationMs < 60 * 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return formatDuration(durationMs);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function timestampField(record: Record<string, unknown>): string | undefined {
  for (const key of ['completedAt', 'finishedAt', 'endedAt', 'updatedAt']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function fileMtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

function memoryStatsSummary(stats: MemoryStats | undefined, error: string | undefined): string {
  if (stats === undefined) return `stats unavailable: ${error ?? 'stats failed'}`;
  return `active ${stats.active} / total ${stats.total}`;
}

function recallSummary(memory: MemoryReadinessSnapshot): string {
  if (memory.query.length === 0) return 'skipped; pass --query=<recall query>';
  if (memory.searchError !== undefined) return `unavailable for "${memory.query}": ${memory.searchError}`;
  const count = memory.searchResults?.length ?? 0;
  if (count === 0) return `0 matches for "${memory.query}"`;
  const top = memory.searchResults?.[0];
  const topSubject = top === undefined ? 'top unavailable' : `top ${top.score.toFixed(2)} ${top.memory.subject}`;
  const matchWord = count === 1 ? 'match' : 'matches';
  return `${count} ${matchWord} for "${memory.query}"; ${topSubject}`;
}

function formatScore(score: number | undefined): string {
  return score === undefined ? 'unavailable' : score.toFixed(2);
}

function formatSignedDelta(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
}

function formatPassRate(passRate: number | undefined): string {
  if (passRate === undefined) return 'unavailable';
  return `${Math.round(passRate * 100)}%`;
}

function formatPreflightError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
