import { formatSeededWorkGraphNotice, seedUltraworkGraphFromApprovedPlan } from '#/agent/plan/work-graph-from-plan';
import { planSwarmEngageNextAction } from '#/agent/plan/swarm-decision';
import {
  combinedDrift,
  isDriftAcceptable,
  ULTRA_PLAN_DRIFT_THRESHOLD,
  type DriftMetrics,
} from '#/agent/plan/ultra-plan-mode';
import type { ExecutableToolResult } from '../../../../loop/types';

export type UltraPlanDriftResult =
  | { readonly ok: true; readonly metrics: DriftMetrics; readonly warning?: string }
  | { readonly ok: false; readonly error: ExecutableToolResult };

export function formatPlanForOutput(
  plan: string,
  path: string | undefined,
  ultraDrift: UltraPlanDriftResult | undefined,
  seededWorkGraph: ReturnType<typeof seedUltraworkGraphFromApprovedPlan>,
): string {
  const savedTo = path !== undefined ? `Plan saved to: ${path}\n\n` : '';
  let output = `Plan mode deactivated. All tools are now available.\n${savedTo}## Approved Plan:\n${plan}`;

  if (ultraDrift !== undefined &&  ultraDrift.ok) {
    if (ultraDrift.warning !== undefined) {
      output += `\n\n---\n## Warning\n${ultraDrift.warning}`;
    }
    const seededNotice = formatSeededWorkGraphNotice(seededWorkGraph);
    if (seededNotice !== undefined) {
      output += `\n\n---\n## UltraworkGraph Seed\n${seededNotice}`;
    }
    const nextAction = planSwarmEngageNextAction(plan, seededWorkGraph);
    if (nextAction !== undefined) {
      output += `\n\n---\n## Recommended Next Action\n${nextAction}`;
    }
    output += `\n\n---\n${formatUltraPlanMetrics(ultraDrift.metrics)}`;
  }

  return output;
}

export function formatUltraPlanMetrics(metrics: DriftMetrics): string {
  const combined = combinedDrift(metrics);
  let output = '## Ultra Plan Metrics\n';
  output += `- Goal Drift: ${metrics.goalDrift.toFixed(3)}\n`;
  output += `- Constraint Drift: ${metrics.constraintDrift.toFixed(3)}\n`;
  output += `- Ontology Drift: ${metrics.ontologyDrift.toFixed(3)}\n`;
  output += `- Combined Drift: ${combined.toFixed(3)} (threshold: ${ULTRA_PLAN_DRIFT_THRESHOLD})\n`;
  output += `- Status: ${isDriftAcceptable(metrics) ? 'ACCEPTABLE' : 'BLOCKED — plan may deviate from seed spec'}\n`;
  return output;
}
