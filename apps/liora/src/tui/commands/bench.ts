import { existsSync, readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { workspaceRelativePath } from '#/constant/workspace-data';

import type { SlashCommandHost } from './dispatch';
import { requestTUILayoutRender } from '../utils/frame-render';
import { quoteShellArg } from '../../utils/shell-quote';

const DEFAULT_BENCH_SUFFIX = ['evidence', 'superliora-provider-bench', 'final-quality-gate'] as const;
const CANDIDATE_JSON_NAMES = new Set([
  'summary.json',
  'loop-summary.json',
  'replay-summary.json',
  'gate-summary.json',
  'quality-gate.json',
]);

export interface BenchStatus {
  readonly sourcePath: string;
  readonly sourceDisplayPath?: string;
  readonly status: string;
  readonly score?: number;
  readonly passRate?: number;
  readonly budget?: string;
  readonly budgetExceeded?: number;
  readonly budgetTasks?: readonly BudgetTaskStatus[];
  readonly budgetInspect?: string;
  readonly budgetRerun?: string;
  readonly loopTrend?: string;
  readonly loopLatest?: string;
  readonly loopFocus?: string;
  readonly loopReason?: string;
  readonly loopAction?: string;
  readonly loopInspect?: string;
  readonly loopCost?: string;
  readonly loopGuard?: string;
  readonly loopStop?: string;
  readonly loopRerun?: string;
  readonly loopReplay?: string;
  readonly replaySummary?: string;
  readonly replayVerdict?: string;
  readonly replaySource?: string;
  readonly replayEvidence?: string;
  readonly replayInspect?: string;
  readonly replayLog?: string;
  readonly replayDiff?: string;
  readonly holdout?: string;
  readonly providerBlock?: string;
  readonly redaction?: string;
  readonly noSecret: boolean;
  readonly nextAction: string;
  readonly warnings: readonly string[];
}

interface BudgetTaskStatus {
  readonly id: string;
  readonly violations: readonly string[];
}

interface CandidateStatus extends BenchStatus {
  readonly timestamp: number;
}

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
    'SuperLiora Agent Bench',
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

function resolveInputPath(workDir: string, input: string): string {
  return isAbsolute(input) ? input : resolve(workDir, input);
}

function displaySourcePath(workDir: string, path: string): string {
  const localPath = relative(workDir, path);
  if (localPath.length > 0 && !localPath.startsWith('..') && !isAbsolute(localPath)) return localPath;
  return path;
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

function normalizeReplaySummary(workDir: string, path: string, record: Record<string, unknown>): CandidateStatus {
  const replayed = asRecord(record['replayedLoopSummary']) ?? asRecord(record['loopSummary']);
  const iterationValues = Array.isArray(replayed?.['iterations']) ? replayed['iterations'] : [];
  const iterations = iterationValues.flatMap((item) => {
    const iteration = asRecord(item);
    return iteration === null ? [] : [iteration];
  });
  const lastIteration = iterations.at(-1);
  const childExit = asNumber(record['childExitCode']);
  const childSignal = asString(record['childSignal']);
  const childTimedOut = asBoolean(record['childTimedOut']);
  const onlyEvidenceRootChanged = asBoolean(record['onlyEvidenceRootChanged']);
  const shellParsing = asBoolean(record['shellParsing']);
  const exit = childExit === undefined ? childSignal ?? 'unknown' : String(childExit);
  const childStatus = asString(replayed?.['status']) ?? 'UNKNOWN';
  const replayStatus = asString(record['status']) ?? 'UNKNOWN';
  const sourceSummaryPath = asString(record['sourceSummaryPath']);
  const evidenceRoot = asString(record['evidenceRoot']);
  const replaySource = sourceSummaryPath === undefined ? undefined : displaySourcePath(workDir, sourceSummaryPath);
  const replayEvidence = evidenceRoot === undefined ? undefined : displaySourcePath(workDir, evidenceRoot);
  const replayVerdict = replayVerdictLine({
    wrapperStatus: replayStatus,
    childStatus,
    childExit,
    childSignal,
    childTimedOut,
    onlyEvidenceRootChanged,
    shellParsing,
  });

  return {
    sourcePath: path,
    status: replayStatus,
    score: asNumber(replayed?.['bestScore']) ?? asNumber(lastIteration?.['score']),
    passRate: asNumber(lastIteration?.['passRate']),
    replaySummary: [
      `child ${childStatus}`,
      `exit ${exit}`,
      `rootOnly ${formatBoolean(onlyEvidenceRootChanged)}`,
      `shellParsing ${formatBoolean(shellParsing)}`,
      `timeout ${formatBoolean(childTimedOut)}`,
    ].join('; '),
    replayVerdict,
    replaySource,
    replayEvidence,
    replayInspect: replayEvidence === undefined ? undefined : `cat ${quoteBenchShellArg(join(replayEvidence, 'loop-summary.json'))}`,
    replayLog: replayEvidence === undefined ? undefined : `cat ${quoteBenchShellArg(join(replayEvidence, 'commands.jsonl'))}`,
    replayDiff: replayDiffCommand(replaySource, replayEvidence),
    holdout: 'loop replay wrapper',
    providerBlock: 'not applicable',
    redaction: 'not recorded',
    noSecret: true,
    nextAction: replayNextAction(replayVerdict, childStatus),
    warnings: [],
    timestamp: timestampOf(record, path),
  };
}

function budgetLine(status: BenchStatus): string {
  if (status.budget === undefined) return 'not recorded';
  const exceeded = status.budgetExceeded === undefined ? 'unknown' : String(status.budgetExceeded);
  return `${status.budget}; exceeded ${exceeded}`;
}

function budgetActionLines(status: BenchStatus): string[] {
  if (status.budget !== 'FAIL' || status.budgetTasks === undefined || status.budgetTasks.length === 0) return [];
  const topTask = status.budgetTasks[0];
  if (topTask === undefined) return [];
  const lines = [`top  ${topTask.id}`];
  if (topTask.violations.length > 0) lines.push(`detail  ${topTask.violations.slice(0, 3).join('; ')}`);
  if (status.budgetInspect !== undefined) lines.push(`inspect  ${status.budgetInspect}`);
  if (status.budgetRerun !== undefined) lines.push(`rerun  ${status.budgetRerun}`);
  return lines;
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

function normalizeLoopSummary(workDir: string, path: string, record: Record<string, unknown>): CandidateStatus {
  const iterationValues = Array.isArray(record['iterations']) ? record['iterations'] : [];
  const iterations = iterationValues.flatMap((item) => {
    const iteration = asRecord(item);
    return iteration === null ? [] : [iteration];
  });
  const lastIteration = iterations.at(-1);
  const proposal = asString(lastIteration?.['proposal']);
  const bestScore = asNumber(record['bestScore']);
  const stopReason = asString(record['stopReason']);
  const rerun = asRecord(record['rerun']);
  const guardrails = asRecord(record['guardrails']);
  const focus = asRecord(lastIteration?.['focus']);

  return {
    sourcePath: path,
    status: asString(record['status']) ?? 'UNKNOWN',
    score: bestScore ?? asNumber(lastIteration?.['score']),
    passRate: asNumber(lastIteration?.['passRate']),
    loopTrend: loopTrendLine(iterations, bestScore),
    loopLatest: loopLatestLine(lastIteration),
    loopFocus: loopFocusLine(focus),
    loopReason: loopReasonLine(focus),
    loopAction: loopActionLine(focus),
    loopInspect: loopInspectLine(focus),
    loopCost: loopCostLine(record, lastIteration),
    loopGuard: loopGuardLine(record, guardrails),
    loopStop: stopReason,
    loopRerun: asString(rerun?.['command']),
    loopReplay: loopReplayCommand(workDir, path, rerun),
    holdout: `bounded loop: ${stopReason ?? 'not recorded'}`,
    providerBlock: 'not applicable',
    redaction: 'not recorded',
    noSecret: true,
    nextAction: proposal ?? 'Review the loop proposal, then run the next bounded benchmark iteration.',
    warnings: [],
    timestamp: timestampOf(record, path),
  };
}

function loopReplayCommand(
  workDir: string,
  sourcePath: string,
  rerun: Record<string, unknown> | null,
): string | undefined {
  if (!hasReplayableRerunArgv(rerun?.['argv'])) return undefined;
  const sourceDisplayPath = displaySourcePath(workDir, sourcePath);
  if (sourceDisplayPath === sourcePath) return undefined;
  const replayRoot = join(dirname(sourceDisplayPath), 'replay');
  return `node scripts/liora-agent-bench.mjs --replay-summary ${quoteBenchShellArg(sourceDisplayPath)} --evidence-root ${quoteBenchShellArg(replayRoot)}`;
}

function hasReplayableRerunArgv(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return false;
  if (value[0] !== 'node' || value[1] !== 'scripts/liora-agent-bench.mjs') return false;
  return !value.some((entry) => entry === '--replay-summary' || entry.startsWith('--replay-summary='));
}

function quoteBenchShellArg(value: string): string {
  return /^[A-Za-z0-9_./:=@%^,+-]+$/.test(value) ? value : quoteShellArg(value);
}

function replayDiffCommand(replaySource: string | undefined, replayEvidence: string | undefined): string | undefined {
  if (replaySource === undefined || replayEvidence === undefined) return undefined;
  return `diff -u ${quoteBenchShellArg(replaySource)} ${quoteBenchShellArg(join(replayEvidence, 'loop-summary.json'))}`;
}

function loopTrendLine(iterations: readonly Record<string, unknown>[], bestScore: number | undefined): string | undefined {
  const firstIteration = iterations[0];
  const lastIteration = iterations.at(-1);
  if (firstIteration === undefined || lastIteration === undefined) return undefined;
  const firstScore = asNumber(firstIteration['score']);
  const lastScore = asNumber(lastIteration['score']);
  const delta = firstScore === undefined || lastScore === undefined ? undefined : lastScore - firstScore;
  return `iter ${iterations.length}; score ${formatScore(firstScore)} -> ${formatScore(lastScore)} (${formatDelta(delta)}); best ${formatScore(bestScore ?? lastScore)}`;
}

function loopLatestLine(iteration: Record<string, unknown> | undefined): string | undefined {
  if (iteration === undefined) return undefined;
  const status = asString(iteration['status']) ?? 'UNKNOWN';
  return `status ${status}; passRate ${formatPassRate(asNumber(iteration['passRate']))}; delta ${formatDelta(asNumber(iteration['delta']))}`;
}

function loopFocusLine(focus: Record<string, unknown> | null): string | undefined {
  if (focus === null) return undefined;
  const tasks = focusTasks(focus);
  const taxonomy = loopTaxonomyLine(focus);
  const status = asString(focus['status']) ?? 'attention';
  if (status === 'clean' && tasks.length === 0) return undefined;

  const task = tasks[0];
  const taskText = task === undefined ? `${status} task unknown` : loopFocusTaskText(task);
  return taxonomy === undefined ? taskText : `${taskText}; top ${taxonomy}`;
}

function loopInspectLine(focus: Record<string, unknown> | null): string | undefined {
  if (focus === null) return undefined;
  const task = focusTasks(focus)[0];
  return asString(task?.['displayPath']) ?? asString(task?.['resultPath']);
}

function loopReasonLine(focus: Record<string, unknown> | null): string | undefined {
  if (focus === null) return undefined;
  const status = asString(focus['status']) ?? 'attention';
  if (status === 'clean') return undefined;
  return asString(focusTasks(focus)[0]?.['reason']);
}

function loopActionLine(focus: Record<string, unknown> | null): string | undefined {
  if (focus === null) return undefined;
  const status = asString(focus['status']) ?? 'attention';
  if (status === 'clean') return undefined;
  return asString(focusTasks(focus)[0]?.['action']);
}

function loopFocusTaskText(task: Record<string, unknown>): string {
  const status = asString(task['status']) ?? 'UNKNOWN';
  const id = asString(task['id']) ?? 'unknown';
  const taxonomy = stringList(task['taxonomy']).slice(0, 3).join(',');
  return taxonomy.length === 0 ? `${status} ${id}` : `${status} ${id} (${taxonomy})`;
}

function focusTasks(focus: Record<string, unknown>): Record<string, unknown>[] {
  const tasks = focus['tasks'];
  return Array.isArray(tasks)
    ? tasks.flatMap((item) => {
      const record = asRecord(item);
      return record === null ? [] : [record];
    })
    : [];
}

function loopTaxonomyLine(focus: Record<string, unknown>): string | undefined {
  const taxonomy = focus['taxonomy'];
  if (Array.isArray(taxonomy)) {
    const entries = taxonomy.flatMap((item) => {
      const record = asRecord(item);
      const name = asString(record?.['name']);
      if (name === undefined) return [];
      return [`${name} x${formatMetric(asNumber(record?.['count']))}`];
    });
    return entries.length === 0 ? undefined : entries.slice(0, 3).join(', ');
  }
  const record = asRecord(taxonomy);
  if (record === null) return undefined;
  const entries = Object.entries(record).flatMap(([name, value]) => {
    const count = asNumber(value);
    return count === undefined ? [] : [`${name} x${formatMetric(count)}`];
  });
  return entries.length === 0 ? undefined : entries.slice(0, 3).join(', ');
}

function loopCostLine(record: Record<string, unknown>, iteration: Record<string, unknown> | undefined): string {
  const counts = asRecord(iteration?.['counts']);
  const selected = asNumber(counts?.['selected']);
  const scored = asNumber(counts?.['scored']);
  const failed = asNumber(counts?.['failed']);
  const blocked = asNumber(counts?.['blocked']);
  return `wall ${formatDurationMs(asNumber(record['wallClockMs']))}/${formatDurationMs(asNumber(record['maxTotalMs']))}; tasks ${formatMetric(scored)}/${formatMetric(selected)}; failed ${formatMetric(failed)}; blocked ${formatMetric(blocked)}`;
}

function loopGuardLine(record: Record<string, unknown>, guardrails: Record<string, unknown> | null): string {
  const bounded = asBoolean(guardrails?.['bounded']);
  const executeCodeChanges = asBoolean(guardrails?.['executeCodeChanges']);
  return `bounded ${formatBoolean(bounded)}; maxIter ${formatMetric(asNumber(record['maxIterations']))}; codeChanges ${executeCodeChanges === undefined ? 'unknown' : String(executeCodeChanges)}`;
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

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function safeStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatHoldout(holdout: Record<string, unknown> | null): string | undefined {
  if (holdout === null) return undefined;
  const status = asString(holdout['status']) ?? 'not recorded';
  const selected = asNumber(holdout['selected']);
  const available = asNumber(holdout['available']);
  if (selected !== undefined && available !== undefined) return `${status} (${selected}/${available})`;
  return status;
}

function providerBlockLine(
  preflight: string | undefined,
  missingEnv: readonly string[],
  providerCallStarted: boolean | undefined,
): string {
  if (preflight === undefined || preflight === 'not_applicable') return 'not blocked';
  const missing = missingEnv.length > 0 ? `: ${missingEnv.join(', ')}` : '';
  const callState = providerCallStarted === undefined ? '' : `; providerCallStarted=${providerCallStarted}`;
  return `${preflight}${missing}${callState}`;
}

function nextActionFor(preflight: string | undefined, missingEnv: readonly string[]): string {
  if (preflight === 'blocked_missing_env' || missingEnv.length > 0) {
    return `Set ${missingEnv.join('/')} and rerun node scripts/liora-agent-bench.mjs --suite holdout --runner provider.`;
  }
  return 'Run the next bounded Ultrawork loop only after recording fresh benchmark evidence.';
}

function replayNextAction(replayVerdict: string, childStatus: string): string {
  if (replayVerdict.startsWith('trusted;')) {
    return `Replay verified; inspect child loop result ${childStatus} before the next improvement.`;
  }
  return 'Inspect replay-summary.json and commands.jsonl before trusting this replay result.';
}

interface ReplayVerdictInput {
  readonly wrapperStatus: string;
  readonly childStatus: string;
  readonly childExit?: number;
  readonly childSignal?: string;
  readonly childTimedOut?: boolean;
  readonly onlyEvidenceRootChanged?: boolean;
  readonly shellParsing?: boolean;
}

function replayVerdictLine(input: ReplayVerdictInput): string {
  const trusted = input.wrapperStatus === 'PASS'
    && input.childStatus === 'PASS'
    && input.childExit === 0
    && input.childSignal === undefined
    && input.childTimedOut === false
    && input.onlyEvidenceRootChanged === true
    && input.shellParsing === false;
  if (trusted) {
    return 'trusted; child PASS; exit 0; rootOnly true; shellParsing false; timeout false';
  }

  const blockers: string[] = [];
  const concerns: string[] = [];
  if (input.wrapperStatus === 'BLOCKED' || input.wrapperStatus === 'FAIL') blockers.push(`wrapper ${input.wrapperStatus}`);
  else if (input.wrapperStatus !== 'PASS') concerns.push(`wrapper ${input.wrapperStatus}`);
  if (input.childStatus === 'BLOCKED' || input.childStatus === 'FAIL') blockers.push(`child ${input.childStatus}`);
  else if (input.childStatus !== 'PASS') concerns.push(`child ${input.childStatus}`);
  if (input.childSignal !== undefined) blockers.push(`signal ${input.childSignal}`);
  if (input.childExit === undefined) concerns.push('exit unknown');
  else if (input.childExit !== 0) blockers.push(`exit ${input.childExit}`);
  if (input.childTimedOut === true) blockers.push('timeout true');
  else if (input.childTimedOut === undefined) concerns.push('timeout unknown');
  if (input.onlyEvidenceRootChanged !== true) concerns.push(`rootOnly ${formatBoolean(input.onlyEvidenceRootChanged)}`);
  if (input.shellParsing !== false) concerns.push(`shellParsing ${formatBoolean(input.shellParsing)}`);

  const verdict = blockers.length > 0 ? 'blocked' : 'suspect';
  return `${verdict}; ${[...blockers, ...concerns].join('; ')}`;
}

function formatScore(score: number | undefined): string {
  return score === undefined ? 'unavailable' : score.toFixed(2);
}

function formatPassRate(passRate: number | undefined): string {
  if (passRate === undefined) return 'unavailable';
  return `${Math.round(passRate * 100)}%`;
}

function formatDelta(delta: number | undefined): string {
  if (delta === undefined) return 'unavailable';
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
}

function formatDurationMs(durationMs: number | undefined): string {
  if (durationMs === undefined) return 'unavailable';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? 'unknown' : String(value);
}

function formatBoolean(value: boolean | undefined): string {
  return value === undefined ? 'unknown' : String(value);
}

function timestampOf(record: Record<string, unknown>, path: string): number {
  const value = asString(record['completedAt']) ?? asString(record['createdAt']) ?? asString(record['startedAt']);
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  return safeStat(path)?.mtimeMs ?? 0;
}
