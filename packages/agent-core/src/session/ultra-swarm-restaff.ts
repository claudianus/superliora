import type { ExpertSwarmPlan } from '../expert-agents/types';

const RESTAFF_MAX_NEW_EXPERTS = 2;

export interface RestaffGapResult {
  readonly expertId: string;
  readonly expertName: string;
  readonly phase: string;
  readonly verdict: string;
  readonly summary: string;
}

export function needsRestaffing(
  gaps: readonly RestaffGapResult[],
  staffedCount: number,
  maxExperts: number,
): boolean {
  if (gaps.length === 0 || staffedCount >= maxExperts) return false;
  return gaps.some((gap) => gap.verdict !== 'PASS');
}

export function collectRestaffGaps(
  results: readonly {
    readonly spec: {
      readonly expertId: string;
      readonly expertName: string;
      readonly phase: string;
      readonly requiredForCompletion: boolean;
    };
    readonly verdict: string;
    readonly status: string;
    readonly result?: string;
    readonly error?: string;
  }[],
): RestaffGapResult[] {
  return results
    .filter(
      (result) =>
        result.spec.requiredForCompletion &&
        result.status === 'completed' &&
        result.verdict !== 'PASS',
    )
    .map((result) => ({
      expertId: result.spec.expertId,
      expertName: result.spec.expertName,
      phase: result.spec.phase,
      verdict: result.verdict,
      summary: collapseRestaffSummary(result.result ?? result.error ?? ''),
    }));
}

export function buildRestaffReflectionPrompt(
  taskDescription: string,
  gaps: readonly RestaffGapResult[],
  busDigest?: string,
): string {
  const gapLines = gaps.map(
    (gap) => `- ${gap.expertName} (${gap.expertId}) ${gap.phase} ${gap.verdict}: ${gap.summary}`,
  );
  const digestLine =
    busDigest === undefined || busDigest.length === 0
      ? ''
      : `\n\nRecent swarm bus digest:\n${busDigest}`;
  return [
    taskDescription,
    '',
    'UltraSwarm revision staffing: the staffed team still has unresolved required gaps.',
    'Select additional specialists to close blockers before final council synthesis.',
    'Prioritize review, security, QA, or implementation depth matching the gaps below.',
    '',
    'Outstanding gaps:',
    ...gapLines,
    digestLine,
  ].join('\n');
}

export function filterRestaffPlan(
  plan: ExpertSwarmPlan,
  excludedExpertIds: readonly string[],
  slots: number,
): ExpertSwarmPlan {
  const excluded = new Set(excludedExpertIds);
  const experts = plan.experts
    .filter((assignment) => !excluded.has(assignment.expertId))
    .slice(0, Math.max(0, Math.min(slots, RESTAFF_MAX_NEW_EXPERTS)));
  return {
    taskDescription: plan.taskDescription,
    strategy: experts.length > 1 ? 'parallel' : 'sequential',
    experts,
  };
}

export function restaffSlotsAvailable(staffedCount: number, maxExperts: number): number {
  return Math.max(0, Math.min(RESTAFF_MAX_NEW_EXPERTS, maxExperts - staffedCount));
}

export function restaffPhaseForGaps(gaps: readonly RestaffGapResult[]): 'implement' | 'review' {
  if (gaps.some((gap) => gap.phase === 'implement' || gap.phase === 'plan')) {
    return 'implement';
  }
  return 'review';
}

function collapseRestaffSummary(text: string): string {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim();
  return collapsed.length > 240 ? `${collapsed.slice(0, 237)}...` : collapsed;
}
