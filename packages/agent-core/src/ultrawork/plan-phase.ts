import type { UltraPlanPhase } from '../agent/plan/ultra-plan-mode';

export function inferUltraPlanPhaseFromPlanContent(content: string): UltraPlanPhase | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) return undefined;

  const hasExecutionPlan = /##\s*Execution Plan[\s\S]*\S/.test(trimmed);
  const hasWorkGraph = /##\s*WorkGraph[\s\S]*\S/.test(trimmed);
  const hasSwarmDecision = /Swarm decision:\s*(ENGAGE|ADAPTIVE|DEFER)/i.test(trimmed);
  const hasSeedSpecBody =
    /Verifiable UltraGoal:\s*\S/.test(trimmed) &&
    /Acceptance Criteria:\s*\S/.test(trimmed) &&
    /Verification Plan:\s*\S/.test(trimmed);

  if (hasExecutionPlan && hasWorkGraph && hasSwarmDecision && hasSeedSpecBody) {
    return 'exit';
  }
  if (hasExecutionPlan || hasWorkGraph) return 'write';
  if (hasSeedSpecBody && hasSwarmDecision) return 'review';
  if (hasSeedSpecBody) return 'design';
  return undefined;
}
