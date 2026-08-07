import { statSync } from 'node:fs';

import type { BenchStatus } from '../bench/bench';
import type { MemoryReadinessSnapshot } from '../memory/evidence-readiness';
import {
  CANONICAL_PREFLIGHT_REFRESH_EVIDENCE_ROOT,
  CANONICAL_PREFLIGHT_RUNTIME_EVIDENCE_ROOT,
  CANONICAL_SOTA_CRITERIA_PATH,
  DEFAULT_PREFLIGHT_RECALL_QUERY,
  PREFLIGHT_FRESHNESS_WINDOW_MS,
  PREFLIGHT_RECALL_MEMORY_SUBJECT,
  PREFLIGHT_REFRESH_COMMAND,
  PREFLIGHT_HUMAN_WRITING_CONTRACT_PATH,
  type PreflightFreshness,
  type PreflightFreshnessSignal,
  type PreflightHumanWriting,
  type PreflightRefreshPlan,
  type PreflightStatus,
} from './types';
import { formatDuration } from './utils';

export function isBenchReady(bench: BenchStatus): boolean {
  if (!bench.noSecret || bench.status === 'UNAVAILABLE') return false;
  const status = bench.status.toUpperCase();
  return status.includes('PASS') || status.includes('APPROVE') || bench.score === 1 || bench.passRate === 1;
}

export function isMemoryReady(memory: MemoryReadinessSnapshot): boolean {
  return memory.stats !== undefined && memory.stats.active > 0;
}

export function isRecallReady(memory: MemoryReadinessSnapshot): boolean {
  return memory.query.length > 0
    && memory.searchError === undefined
    && (memory.searchResults?.length ?? 0) > 0;
}

export function nextPreflightAction(
  bench: BenchStatus,
  memory: MemoryReadinessSnapshot,
  freshness: PreflightFreshness,
): string {
  if (!isBenchReady(bench)) return bench.nextAction;
  if (!isMemoryReady(memory)) return `Run ${preflightRecallMemoryCommand(memory.query)}.`;
  if (memory.query.length === 0) return 'Run /preflight --query=<recall query> to verify Liora Memory retrieval.';
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
  return 'Ready: run the next bounded Mission loop from this preflight.';
}

function preflightRecallMemoryCommand(query: string): string {
  const content = query.trim().length === 0 ? DEFAULT_PREFLIGHT_RECALL_QUERY : query.trim();
  return `/memory remember ${PREFLIGHT_RECALL_MEMORY_SUBJECT} :: ${content}`;
}

function preflightRuntimeEvidenceAction(label: string): string {
  return `Capture ${label} evidence under ${CANONICAL_PREFLIGHT_RUNTIME_EVIDENCE_ROOT}, then run Refresh command below.`;
}

export function buildPreflightRefreshPlan(
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

export function evidenceFreshnessSignal(
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

export function defaultPreflightHumanWriting(): PreflightHumanWriting {
  return {
    ready: true,
    contractReady: true,
    rubricReady: true,
    advisoryOnly: true,
    contractPath: PREFLIGHT_HUMAN_WRITING_CONTRACT_PATH,
    rubricPath: CANONICAL_SOTA_CRITERIA_PATH,
    nextAction: 'Human-writing anti-slop contract ready; keep detector signals advisory-only.',
  };
}

export function readinessGateSummary(status: PreflightStatus): string {
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

export function humanWritingSummary(humanWriting: PreflightHumanWriting): string {
  if (humanWriting.ready) return 'anti-slop advisory-only';
  const blocked = [
    ...(humanWriting.contractReady ? [] : ['contract']),
    ...(humanWriting.rubricReady ? [] : ['rubric']),
    ...(humanWriting.advisoryOnly ? [] : ['advisory-only']),
  ];
  return `blocked ${blocked.join(',')}; advisory-only required`;
}

export function freshnessSummary(signal: PreflightFreshnessSignal): string {
  if (signal.ageMs === undefined) return signal.state;
  return `${signal.state}; ${formatDuration(signal.ageMs)}`;
}
