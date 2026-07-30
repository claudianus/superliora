import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PREFLIGHT_FRESHNESS_WINDOW_MS,
  preflightRefreshEvidenceRoot,
  type PreflightRefreshBench,
  type PreflightRefreshGates,
  type PreflightRefreshRun,
  type PreflightRuntimeCandidate,
  type RefreshAgeDetails,
} from './types';
import {
  asRecord,
  displayPath,
  formatDuration,
  formatElapsed,
  formatPassRate,
  formatMetric,
  formatPreflightError,
  formatScore,
  numberField,
  readJsonRecord,
} from './utils';

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

export function refreshRunSummary(run: PreflightRefreshRun): string {
  const elapsed = run.durationMs === undefined ? 'elapsed unknown' : `elapsed ${formatElapsed(run.durationMs)}`;
  const missing = run.missingChannels.length === 0 ? 'runtime ok' : `missing ${run.missingChannels.join(',')}`;
  return `${run.status}; ${elapsed}; ${missing}`;
}

export function refreshAgeDetails(run: PreflightRefreshRun, nowMs = Date.now()): RefreshAgeDetails | undefined {
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

export function refreshAgeSummary(run: PreflightRefreshRun, nowMs = Date.now()): string {
  const details = refreshAgeDetails(run, nowMs);
  if (details === undefined) return 'unknown';
  const horizonLabel = details.state === 'fresh' ? 'due' : 'expired';
  return `${details.state}; ${formatDuration(details.ageMs)}; ${horizonLabel} ${formatDuration(details.horizonMs)}`;
}

export function refreshBenchSummary(bench: PreflightRefreshBench | undefined): string | undefined {
  if (bench === undefined) return undefined;
  const quality = `score ${formatScore(bench.score)}; passRate ${formatPassRate(bench.passRate)}`;
  const counts = bench.scored === undefined
    ? 'tasks unavailable'
    : `tasks ${bench.passed ?? 0}/${bench.scored} passed; q ${bench.quarantined ?? 0}`;
  const cost = `cost ${formatMetric(bench.wallClockMs, 'ms')}; tok ${formatMetric(bench.estimatedTokens)}; cmd ${formatMetric(bench.commandCount)}`;
  return `${quality}; ${counts}; ${cost}`;
}

export function refreshGatesSummary(gates: PreflightRefreshGates | undefined): string | undefined {
  if (gates === undefined) return undefined;
  const count = gates.total === undefined || gates.passed === undefined
    ? 'count unknown'
    : `${Math.round(gates.passed)}/${Math.round(gates.total)}`;
  const blocked = gates.blocked.length === 0 ? 'none' : gates.blocked.join(',');
  const next = gates.nextAction === undefined ? '' : `; next ${gates.nextAction}`;
  return `${count}; blocked ${blocked}${next}`;
}

export function refreshCandidatesSummary(candidates: readonly PreflightRuntimeCandidate[]): string | undefined {
  if (candidates.length === 0) return undefined;
  const noun = candidates.length === 1 ? 'candidate' : 'candidates';
  const staleCount = candidates.filter((candidate) => candidate.state !== 'fresh').length;
  if (staleCount === 0) return `${candidates.length} ${noun}; all fresh`;
  return `${candidates.length} ${noun}; ${staleCount} stale`;
}

export function refreshCandidateActionSummary(
  candidates: readonly PreflightRuntimeCandidate[],
): string {
  const count = candidates.length;
  const noun = count === 1 ? 'candidate' : 'candidates';
  return `recapture ${count} ${noun}`;
}
