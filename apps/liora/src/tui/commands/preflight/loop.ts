import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT,
  PREFLIGHT_BENCH_LOOP_COMMAND,
  PREFLIGHT_BENCH_LOOP_MAX_ITERATIONS,
  PREFLIGHT_BENCH_LOOP_MAX_TOTAL_MS,
  PREFLIGHT_FRESHNESS_WINDOW_MS,
  preflightBenchLoopEvidenceRoot,
  type PreflightLoopRun,
  type PreflightStatus,
  type RefreshAgeDetails,
} from './types';
import {
  asRecord,
  displayPath,
  fileMtimeMs,
  fileTimestamp,
  formatDuration,
  formatMetric,
  formatScore,
  formatSignedDelta,
  numberField,
  readJsonRecord,
  timestampField,
} from './utils';
import { refreshAgeDetails } from './refresh';

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

export function fallbackLoopRerunCommand(evidenceRoot: string | undefined, maxIterations: number | undefined): string {
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

export function loopCueSummary(status: PreflightStatus, nowMs = Date.now()): string {
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

export function loopCommandSummary(status: PreflightStatus, nowMs = Date.now()): string {
  if (shouldRunBenchLoop(status, nowMs)) return PREFLIGHT_BENCH_LOOP_COMMAND;
  return status.refreshPlan.command;
}

export function loopEvidenceSummary(status: PreflightStatus, nowMs = Date.now()): string {
  if (shouldRunBenchLoop(status, nowMs)) return CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT;
  return status.refreshPlan.evidencePath;
}

export function loopBudgetSummary(status: PreflightStatus, nowMs = Date.now()): string {
  if (!shouldRunBenchLoop(status, nowMs)) return 'refresh once; no bench iteration';
  return `${PREFLIGHT_BENCH_LOOP_MAX_ITERATIONS} iters; ${formatDuration(PREFLIGHT_BENCH_LOOP_MAX_TOTAL_MS)}; stop ceiling/no_delta`;
}

export function loopRunSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `${run.status}; inspect ${run.evidencePath}`;
  const score = `score ${formatScore(run.bestScore)}`;
  const stop = run.stopReason === undefined ? 'stop unknown' : `stop ${run.stopReason}`;
  const iterations = run.iterations === undefined
    ? 'iter unknown'
    : `iter ${run.iterations}/${formatMetric(run.maxIterations)}`;
  return `${run.status}; ${score}; ${stop}; ${iterations}`;
}

export function loopProposalSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect ${run.evidencePath}`;
  if (run.proposal === undefined || run.proposal.trim().length === 0) return 'none recorded';
  return compactLoopProposal(run.proposal);
}

export function loopScopeSummary(run: PreflightLoopRun | undefined): string {
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

export function loopRerunSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return `${PREFLIGHT_BENCH_LOOP_COMMAND} --evidence-root ${CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT}/latest`;
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  return run.rerunCommand ?? fallbackLoopRerunCommand(run.evidenceRoot ?? loopEvidenceRootFromPath(run.evidencePath), run.maxIterations);
}

export function loopInspectSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return `${CANONICAL_PREFLIGHT_BENCH_LOOP_EVIDENCE_ROOT}/latest/loop-summary.json`;
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  return run.evidencePath;
}

function loopEvidenceRootFromPath(evidencePath: string): string | undefined {
  if (!evidencePath.endsWith('/loop-summary.json')) return undefined;
  return dirname(evidencePath);
}

export function loopGuardSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  if ((run.quarantined ?? 0) <= 0) return 'none';
  if (run.quarantineTask === undefined) return 'q details unknown';
  return `q ${run.quarantineTask}`;
}

export function loopGuardFilesSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  if ((run.quarantined ?? 0) <= 0) return 'none';
  if (run.quarantineTask === undefined) return 'q details unknown';
  return run.quarantineFindings?.length ? run.quarantineFindings.join(',') : 'no_findings';
}

export function loopDeltaSummary(run: PreflightLoopRun | undefined): string {
  if (run === undefined) return 'missing; run Loop command';
  if (run.warning !== undefined) return `inspect_loop_summary ${run.evidencePath}`;
  if (run.firstScore === undefined || run.lastScore === undefined) return 'unknown';
  if (run.iterations === undefined || run.iterations <= 1) return `single_iter score ${formatScore(run.lastScore)}`;
  const delta = run.lastScore - run.firstScore;
  const verdict = Math.abs(delta) < 0.005 ? 'no_delta' : delta > 0 ? 'improved' : 'regressed';
  return `${verdict} ${formatSignedDelta(delta)} from ${formatScore(run.firstScore)} to ${formatScore(run.lastScore)}`;
}

export function loopAgeSummary(run: PreflightLoopRun | undefined, nowMs = Date.now()): string {
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

export function loopNextSummary(run: PreflightLoopRun | undefined): string {
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
