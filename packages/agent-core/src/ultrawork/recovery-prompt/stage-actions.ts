import { detectLongRunningStage, OSCILLATION_WARN_THRESHOLD } from '../stage-progress';

/** Match recovery-triangle high-resume oscillation next_actions. */
export function formatHighResumeOscillationNextActions(resumeCycles: number): readonly string[] {
  if (resumeCycles < OSCILLATION_WARN_THRESHOLD) return [];
  return [
    `Break oscillation: high resume count (${String(resumeCycles)} ≥ ${String(OSCILLATION_WARN_THRESHOLD)}) — simplify objective, cancel stuck nodes, or split into smaller runs before more product edits.`,
  ];
}

/** Match recovery-triangle long-running stage next_actions. */
export function formatLongRunningStageNextActions(
  longStage: ReturnType<typeof detectLongRunningStage>,
): readonly string[] {
  if (longStage === undefined) return [];
  const elapsedMin = Math.round(longStage.elapsedMs / 60_000);
  const thresholdMin = Math.round(longStage.thresholdMs / 60_000);
  return [
    `Advance or split long-running stage "${longStage.stage}" (~${String(elapsedMin)}min, expected <${String(thresholdMin)}min) — avoid unbounded loops.`,
  ];
}

/**
 * Match recovery-triangle empty WorkGraph seed next_actions.
 * Used by recovery-prompt, completion-audit, injectors, and envelope.
 */
export function formatEmptyWorkGraphSeedNextActions(): readonly string[] {
  return [
    'Seed WorkGraph via UltraworkGraph (acceptance criteria + verification nodes with requiredEvidence) before UpdateGoal(complete) — empty graph is rejected as false complete.',
  ];
}
