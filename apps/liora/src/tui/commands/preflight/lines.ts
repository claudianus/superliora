import type { MemoryStats } from '@superliora/sdk';

import { formatEvidenceSignal, type MemoryReadinessSnapshot } from '../memory/evidence-readiness';
import {
  loopAgeSummary,
  loopBudgetSummary,
  loopCommandSummary,
  loopCueSummary,
  loopDeltaSummary,
  loopEvidenceSummary,
  loopGuardFilesSummary,
  loopGuardSummary,
  loopInspectSummary,
  loopNextSummary,
  loopProposalSummary,
  loopRerunSummary,
  loopRunSummary,
  loopScopeSummary,
} from './loop';
import {
  freshnessSummary,
  humanWritingSummary,
  isBenchReady,
  isMemoryReady,
  isRecallReady,
  readinessGateSummary,
} from './readiness';
import {
  refreshAgeSummary,
  refreshBenchSummary,
  refreshCandidateActionSummary,
  refreshCandidatesSummary,
  refreshGatesSummary,
  refreshRunSummary,
} from './refresh';
import type { PreflightStatus } from './types';
import {
  formatDuration,
  formatPassRate,
  formatScore,
  readyWord,
} from './utils';

export function buildPreflightLines(status: PreflightStatus, redact: (text: string) => string): string[] {
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
  return lines.map(redact);
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
