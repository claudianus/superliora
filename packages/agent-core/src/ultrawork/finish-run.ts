import type { Agent } from '../agent';

/**
 * Close a finished Ultrawork run (and its UltraGoal) without pulling resume/plan graph deps.
 * Lives in a leaf module so UltraworkGraph can call it without import cycles.
 * Returns a Promise when goal completion is triggered; callers in async contexts
 * should await to avoid a race where the goal driver issues another continuation
 * turn before the goal is marked complete.
 */
export function maybeFinishUltraworkRun(agent: Agent): Promise<void> | undefined {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return undefined;
  const run = ultrawork.getRun();
  if (run === null || run.status !== 'running') return undefined;
  const graph = run.workGraph;
  // Only auto-finish when a WorkGraph exists with at least one node and every
  // node is done. Without a graph (or with an empty one) the run has not yet
  // been seeded with work — finishing here would prematurely close runs still
  // in plan/research stages.
  if (graph === undefined || graph.nodes.length === 0) return undefined;
  if (!graph.nodes.every((node) => node.status === 'done')) return undefined;
  ultrawork.completeLearnStage();
  return completeUltraGoalForFinishedRun(agent);
}

/**
 * A finished Ultrawork run must also close its UltraGoal: the goal driver keeps
 * issuing continuation turns while a goal is `active`, so leaving the goal open
 * after the run reaches `done` strands the session in an endless goal loop
 * waiting for a model-issued UpdateGoal that may never come.
 */
function completeUltraGoalForFinishedRun(agent: Agent): Promise<void> | undefined {
  const run = agent.ultrawork?.getRun();
  if (run === undefined || run === null || run.status !== 'done') return undefined;
  const goal = agent.goal.getGoal().goal;
  if (goal === null || goal.status !== 'active') return undefined;
  return agent.goal
    .markComplete({ reason: 'Ultrawork run completed' }, 'runtime')
    .then(() => undefined)
    .catch((error: unknown) => {
      agent.log.warn('ultrawork run-complete goal close failed', { error });
    });
}
