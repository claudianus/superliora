import { existsSync, readdirSync, statSync, type Stats } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { workspaceRelativePath } from '#/constant/workspace-data';

import type { SlashCommandHost } from './dispatch';
import {
  budgetActionLines,
  budgetLine,
  formatHoldout,
  formatPassRate,
  formatScore,
  nextActionFor,
  providerBlockLine,
} from './bench-format';
import { normalizeLoopSummary } from './bench-loop';
import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  readJson,
  stringList,
  timestampOf,
} from './bench-parse';
import { displaySourcePath, resolveInputPath } from './bench-path';
import { normalizeReplaySummary } from './bench-replay';
import type { BenchStatus, BudgetTaskStatus, CandidateStatus } from './bench-types';
import { requestTUILayoutRender } from '../utils/frame-render';

export type { BenchStatus } from './bench-types';

const DEFAULT_BENCH_SUFFIX = ['evidence', 'superliora-provider-bench', 'final-quality-gate'] as const;
const CANDIDATE_JSON_NAMES = new Set([
  'summary.json',
  'loop-summary.json',
  'replay-summary.json',
  'gate-summary.json',
  'quality-gate.json',
]);

export async function handleBenchCommand(host: SlashCommandHost, args: string): Promise<void> {
  const { UsagePanelComponent } = await import('../components/messages/usage-panel');
  const status = loadBenchStatus(host.state.appState.workDir, args);
  const panel = new UsagePanelComponent(() => buildBenchStatusLines(status), 'primary', ' Bench ');
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

export function loadBenchStatus(workDir: string, args: string): BenchStatus {
  const requestedPath = args.trim();
  const root = requestedPath.length > 0
    ? resolveInputPath(workDir, requestedPath)
    : join(workDir, workspaceRelativePath(workDir, ...DEFAULT_BENCH_SUFFIX));

  if (!existsSync(root)) {
    return unavailableStatus(root, `No bench evidence found at ${root}`);
  }

  const candidates = collectCandidateFiles(root)
    .map((file) => loadCandidateStatus(workDir, file))
    .filter((status): status is CandidateStatus => status !== null)
    .toSorted(compareCandidateStatus);

  return candidates[0] ?? unavailableStatus(root, `No bench evidence found at ${root}`);
}

export function buildBenchStatusLines(status: BenchStatus): string[] {
  const lines = [
    'LioraBench',
    `Latest status  ${redactBenchStatusText(status.status)}`,
  ];

  if (status.score !== undefined || status.passRate !== undefined) {
    lines.push(`Score/passRate  ${formatScore(status.score)} / ${formatPassRate(status.passRate)}`);
  } else {
    lines.push('Score/passRate  unavailable');
  }

  lines.push(`Holdout  ${redactBenchStatusText(status.holdout ?? 'not recorded')}`);
  if (status.loopTrend !== undefined) lines.push(`Loop trend  ${redactBenchStatusText(status.loopTrend)}`);
  if (status.loopLatest !== undefined) lines.push(`Loop latest  ${redactBenchStatusText(status.loopLatest)}`);
  if (status.loopFocus !== undefined) lines.push(`Loop focus  ${redactBenchStatusText(status.loopFocus)}`);
  if (status.loopReason !== undefined) lines.push(`Loop reason  ${redactBenchStatusText(status.loopReason)}`);
  if (status.loopAction !== undefined) lines.push(`Loop action  ${redactBenchStatusText(status.loopAction)}`);
  if (status.loopInspect !== undefined) lines.push(`Loop inspect  ${redactBenchStatusText(status.loopInspect)}`);
  if (status.loopCost !== undefined) lines.push(`Loop cost  ${redactBenchStatusText(status.loopCost)}`);
  if (status.loopGuard !== undefined) lines.push(`Loop guard  ${redactBenchStatusText(status.loopGuard)}`);
  if (status.loopStop !== undefined) lines.push(`Loop stop  ${redactBenchStatusText(status.loopStop)}`);
  if (status.loopRerun !== undefined) lines.push(`Loop rerun  ${redactBenchStatusText(status.loopRerun)}`);
  if (status.loopReplay !== undefined) lines.push(`Loop replay  ${redactBenchStatusText(status.loopReplay)}`);
  if (status.replaySummary !== undefined) lines.push(`Replay  ${redactBenchStatusText(status.replaySummary)}`);
  if (status.replayVerdict !== undefined) lines.push(`Replay verdict  ${redactBenchStatusText(status.replayVerdict)}`);
  if (status.replaySource !== undefined) lines.push(`Replay source  ${redactBenchStatusText(status.replaySource)}`);
  if (status.replayEvidence !== undefined) lines.push(`Replay evidence  ${redactBenchStatusText(status.replayEvidence)}`);
  if (status.replayInspect !== undefined) lines.push(`Replay inspect  ${redactBenchStatusText(status.replayInspect)}`);
  if (status.replayLog !== undefined) lines.push(`Replay log  ${redactBenchStatusText(status.replayLog)}`);
  if (status.replayDiff !== undefined) lines.push(`Replay diff  ${redactBenchStatusText(status.replayDiff)}`);
  lines.push(`Budget  ${redactBenchStatusText(budgetLine(status))}`);
  for (const line of budgetActionLines(status)) lines.push(`Budget ${redactBenchStatusText(line)}`);
  lines.push(`Provider  ${redactBenchStatusText(status.providerBlock ?? 'not blocked')}`);
  lines.push(`Secrets  redaction ${redactBenchStatusText(status.redaction ?? 'not recorded')}; ${status.noSecret ? 'no secret-looking strings displayed' : 'review evidence before sharing'}`);
  lines.push(`Next  ${redactBenchStatusText(status.nextAction)}`);

  for (const warning of status.warnings) {
    lines.push(`Warning  ${redactBenchStatusText(warning)}`);
  }

  lines.push(`Source  ${redactBenchStatusText(status.sourceDisplayPath ?? status.sourcePath)}`);
  return lines;
}

export function redactBenchStatusText(text: string): string {
  return text
    .replaceAll(/\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\b/g, '[REDACTED_ENV]')
    .replaceAll(/\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password)[A-Za-z0-9_-]*)=([^\s,;]+)/gi, '$1=[REDACTED_SECRET]')
    .replaceAll(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_SECRET]');
}

function collectCandidateFiles(root: string): string[] {
  if (safeStat(root)?.isFile() === true) return [root];

  const files: string[] = [];
  visit(root, 0, files);
  return files;
}

function visit(dir: string, depth: number, files: string[]): void {
  if (depth > 3) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(path, depth + 1, files);
      continue;
    }
    if (entry.isFile() && isCandidateJson(path)) files.push(path);
  }
}

function isCandidateJson(path: string): boolean {
  const name = basename(path);
  return CANDIDATE_JSON_NAMES.has(name) || name.endsWith('-gate-summary.json') || name.endsWith('-quality-gate.json');
}

function candidatePriority(path: string): number {
  const name = basename(path);
  if (name === 'replay-summary.json') return 30;
  if (name === 'loop-summary.json') return 20;
  if (name === 'gate-summary.json' || name.endsWith('-gate-summary.json')) return 10;
  return 0;
}

function compareCandidateStatus(a: CandidateStatus, b: CandidateStatus): number {
  if (dirname(a.sourcePath) === dirname(b.sourcePath)) {
    return candidatePriority(b.sourcePath) - candidatePriority(a.sourcePath) || b.timestamp - a.timestamp;
  }
  return b.timestamp - a.timestamp;
}

function loadCandidateStatus(workDir: string, path: string): CandidateStatus | null {
  const data = readJson(path);
  if (data === null) return null;

  const qualityGate = normalizeQualityGate(workDir, path, data);
  if (qualityGate !== null) return withSourceDisplayPath(workDir, qualityGate);

  const record = asRecord(data);
  if (record === null) return null;

  if (record['benchmark'] === 'liora-agent-bench-loop-replay') {
    return withSourceDisplayPath(workDir, normalizeReplaySummary(workDir, path, record));
  }

  if (record['benchmark'] === 'liora-agent-bench-loop' || record['bestScore'] !== undefined) {
    return withSourceDisplayPath(workDir, normalizeLoopSummary(workDir, path, record));
  }

  if (record['provider'] !== undefined && record['fixture'] !== undefined) {
    return withSourceDisplayPath(workDir, normalizeGateSummary(path, record));
  }

  return withSourceDisplayPath(workDir, normalizeBenchSummary(path, record));
}

function withSourceDisplayPath(workDir: string, status: CandidateStatus): CandidateStatus {
  return {
    ...status,
    sourceDisplayPath: displaySourcePath(workDir, status.sourcePath),
  };
}

function normalizeQualityGate(workDir: string, path: string, data: unknown): CandidateStatus | null {
  const record = asRecord(data);
  const evidence = asRecord(record?.['evidence']);
  const gateSummary = asString(evidence?.['gateSummary']);
  if (record === null || gateSummary === undefined) return null;

  const gatePath = resolveInputPath(workDir, gateSummary);
  const gateData = readJson(gatePath);
  const gateRecord = asRecord(gateData);
  const gateStatus = gateRecord === null ? null : normalizeGateSummary(path, gateRecord);
  if (gateStatus === null) {
    return {
      sourcePath: path,
      status: asString(record['status']) ?? 'UNKNOWN',
      redaction: asString(record['status']),
      noSecret: asString(record['status']) === 'APPROVE',
      nextAction: 'Run node scripts/liora-agent-bench.mjs to refresh local benchmark evidence.',
      warnings: [`Quality gate did not contain readable gate summary evidence: ${gateSummary}`],
      timestamp: timestampOf(record, path),
    };
  }

  return {
    ...gateStatus,
    sourcePath: path,
    status: asString(record['status']) ?? gateStatus.status,
    redaction: gateStatus.redaction ?? asString(record['status']),
    noSecret: gateStatus.noSecret || asString(record['status']) === 'APPROVE',
    timestamp: timestampOf(record, path),
  };
}

function normalizeGateSummary(path: string, record: Record<string, unknown>): CandidateStatus {
  const providerRun = asRecord(record['provider']);
  const fixtureRun = asRecord(record['fixture']);
  const loopRun = asRecord(record['loop']);
  const provider = asRecord(providerRun?.['provider']);
  const metrics = asRecord(fixtureRun?.['metrics']) ?? asRecord(providerRun?.['metrics']);
  const holdout = asRecord(providerRun?.['holdout']) ?? asRecord(fixtureRun?.['holdout']);
  const redactionAttack = asRecord(record['redactionAttack']);
  const missingEnv = stringList(provider?.['missingEnv']);
  const preflight = asString(provider?.['credentialPreflight']);
  const providerCallStarted = asBoolean(provider?.['providerCallStarted']);
  const providerStatus = asString(providerRun?.['status']);
  const fixtureStatus = asString(fixtureRun?.['status']);
  const loopStatus = asString(loopRun?.['status']);

  return {
    sourcePath: path,
    status: [providerStatus && `provider ${providerStatus}`, fixtureStatus && `fixture ${fixtureStatus}`, loopStatus && `loop ${loopStatus}`]
      .filter((item): item is string => item !== undefined)
      .join(' / ') || 'UNKNOWN',
    score: asNumber(metrics?.['score']),
    passRate: asNumber(metrics?.['passRate']),
    holdout: formatHoldout(holdout),
    providerBlock: providerBlockLine(preflight, missingEnv, providerCallStarted),
    redaction: asString(redactionAttack?.['status']),
    noSecret: asString(redactionAttack?.['status']) === 'PASS',
    nextAction: nextActionFor(preflight, missingEnv),
    warnings: [],
    timestamp: timestampOf(record, path),
  };
}

function normalizeBenchSummary(path: string, record: Record<string, unknown>): CandidateStatus {
  const metrics = asRecord(record['metrics']) ?? asRecord(record['aggregateSummary']);
  const provider = asRecord(record['provider']);
  const budget = asRecord(record['budget']);
  const budgetTasks = budgetTaskStatuses(budget);
  const missingEnv = stringList(provider?.['missingEnv']);
  const preflight = asString(provider?.['credentialPreflight']);
  const providerCallStarted = asBoolean(provider?.['providerCallStarted']);

  return {
    sourcePath: path,
    status: asString(record['status']) ?? 'UNKNOWN',
    score: asNumber(metrics?.['score']),
    passRate: asNumber(metrics?.['passRate']),
    budget: asString(budget?.['status']),
    budgetExceeded: asNumber(budget?.['exceeded']),
    budgetTasks,
    budgetInspect: budgetInspectPath(path, budgetTasks[0]?.id),
    budgetRerun: budgetRerunCommand(record),
    holdout: formatHoldout(asRecord(record['holdout'])),
    providerBlock: providerBlockLine(preflight, missingEnv, providerCallStarted),
    redaction: 'not recorded',
    noSecret: true,
    nextAction: nextActionFor(preflight, missingEnv),
    warnings: [],
    timestamp: timestampOf(record, path),
  };
}

function budgetTaskStatuses(budget: Record<string, unknown> | null): BudgetTaskStatus[] {
  const taskRecords = budget?.['tasks'];
  const tasks = Array.isArray(taskRecords) ? taskRecords : [];
  return tasks.flatMap((item) => {
    const record = asRecord(item);
    const id = asString(record?.['id']);
    if (id === undefined) return [];
    return [{ id, violations: stringList(record?.['violations']) }];
  });
}

function budgetInspectPath(summaryPath: string, taskId: string | undefined): string | undefined {
  if (taskId === undefined) return undefined;
  return join(dirname(summaryPath), 'tasks', safeFileName(taskId), 'result.json');
}

function budgetRerunCommand(record: Record<string, unknown>): string | undefined {
  const taskDir = asString(record['taskDir']);
  const suite = asString(record['suite']);
  const runner = asString(record['runner']);
  const evidenceRoot = asString(record['evidenceRoot']);
  if (taskDir === undefined || suite === undefined || runner === undefined || evidenceRoot === undefined) return undefined;
  return `node scripts/liora-agent-bench.mjs --task-dir ${taskDir} --suite ${suite} --runner ${runner} --evidence-root ${evidenceRoot}`;
}

function safeFileName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '_');
}

function unavailableStatus(sourcePath: string, warning: string): BenchStatus {
  return {
    sourcePath,
    status: 'UNAVAILABLE',
    noSecret: true,
    nextAction: 'Run node scripts/liora-agent-bench.mjs, then open /bench again.',
    warnings: [warning],
  };
}

function safeStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
