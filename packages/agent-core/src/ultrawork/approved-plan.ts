import { basename, dirname, join } from 'pathe';

import type { Agent } from '../agent';
import { parseWorkGraphNodesFromPlan } from '../agent/plan/work-graph-from-plan';
import { inferUltraPlanPhaseFromPlanContent } from './plan-phase';

function isApprovedUltraworkPlan(content: string): boolean {
  if (inferUltraPlanPhaseFromPlanContent(content) === 'exit') return true;
  return (parseWorkGraphNodesFromPlan(content)?.length ?? 0) > 0;
}

export async function readApprovedUltraworkPlanPath(
  agent: Agent,
  planPath: string,
): Promise<string | undefined> {
  try {
    const content = await agent.kaos.readText(planPath);
    return isApprovedUltraworkPlan(content) ? planPath : undefined;
  } catch {
    return undefined;
  }
}

function resolvePlansDirectory(agent: Agent): string {
  const current = agent.planMode.planFilePath;
  if (current !== null) return dirname(current);
  if (agent.homedir !== undefined) return join(agent.homedir, 'plans');
  return join(agent.config.cwd, 'plan');
}

export async function resolveApprovedUltraworkPlanPath(
  agent: Agent,
  candidates: readonly (string | undefined)[],
): Promise<string | undefined> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.length === 0 || seen.has(candidate)) continue;
    seen.add(candidate);
    const approved = await readApprovedUltraworkPlanPath(agent, candidate);
    if (approved !== undefined) return approved;
  }

  const plansDir = resolvePlansDirectory(agent);
  const planPaths: string[] = [];
  try {
    for await (const fullPath of agent.kaos.iterdir(plansDir)) {
      if (fullPath.endsWith('.md')) planPaths.push(fullPath);
    }
  } catch {
    return undefined;
  }
  planPaths.sort((left, right) => basename(right).localeCompare(basename(left)));

  const MAX_PLAN_SCAN = 20;
  for (const planPath of planPaths.slice(0, MAX_PLAN_SCAN)) {
    if (seen.has(planPath)) continue;
    const approved = await readApprovedUltraworkPlanPath(agent, planPath);
    if (approved !== undefined) return approved;
  }
  return undefined;
}
