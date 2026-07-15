import type { Agent } from '../agent';

/**
 * Close a finished Ultrawork run (and its UltraGoal) without pulling resume/plan graph deps.
 * Lives in a leaf module so UltraworkGraph can call it without import cycles.
 */
export function maybeFinishUltraworkRun(agent: Agent): void {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return;
  const run = ultrawork.getRun();
  if (run === null || run.status !== 'running') return;
  const graph = run.workGraph;
  if (graph !== undefined && graph.nodes.length > 0 && !graph.nodes.every((node) => node.status === 'done')) {
    return;
  }
  ultrawork.completeLearnStage();
  completeUltraGoalForFinishedRun(agent);
}

/**
 * A finished Ultrawork run must also close its UltraGoal: the goal driver keeps
 * issuing continuation turns while a goal is `active`, so leaving the goal open
 * after the run reaches `done` strands the session in an endless goal loop
 * waiting for a model-issued UpdateGoal that may never come.
 */
function completeUltraGoalForFinishedRun(agent: Agent): void {
  const run = agent.ultrawork?.getRun();
  if (run === undefined || run === null || run.status !== 'done') return;
  const goal = agent.goal.getGoal().goal;
  if (goal === null || goal.status !== 'active') return;
  void agent.goal
    .markComplete({ reason: 'Ultrawork run completed' }, 'runtime')
    .catch((error: unknown) => {
      agent.log.warn('ultrawork run-complete goal close failed', { error });
    });
}
