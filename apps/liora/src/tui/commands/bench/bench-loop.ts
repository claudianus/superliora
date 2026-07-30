import { dirname, join } from 'node:path';

import type { CandidateStatus } from './bench-types';
import {
  formatBoolean,
  formatDelta,
  formatDurationMs,
  formatMetric,
  formatPassRate,
  formatScore,
} from './bench-format';
import { displaySourcePath, quoteBenchShellArg } from './bench-path';
import { asNumber, asRecord, asString, timestampOf } from './bench-parse';

export function normalizeLoopSummary(workDir: string, path: string, record: Record<string, unknown>): CandidateStatus {
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

export function loopReplayCommand(
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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
