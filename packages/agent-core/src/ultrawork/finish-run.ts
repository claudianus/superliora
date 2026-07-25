import type { Agent } from '../agent';

import {
  auditUltraworkCompletion,
  formatCompletionAuditRejection,
} from './completion-audit';

/**
 * Close a finished Ultrawork run (and its UltraGoal) without pulling resume/plan graph deps.
 * Lives in a leaf module so UltraworkGraph can call it without import cycles.
 * Returns a Promise when goal completion is triggered; callers in async contexts
 * should await to avoid a race where the goal driver issues another continuation
 * turn before the goal is marked complete.
 *
 * False-complete guard: running runs only finish when {@link auditUltraworkCompletion}
 * passes (seeded WorkGraph, evidence hard gate, verificationStatus for requiredEvidence).
 */
export function maybeFinishUltraworkRun(agent: Agent): Promise<void> | undefined {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return undefined;
  const run = ultrawork.getRun();
  if (run === null) return undefined;

  // Terminal runs (done/failed — e.g. cancelled before a WorkGraph was
  // seeded) must still finish even with an empty WorkGraph: release any Ultra
  // Plan the run forced and close an active goal. Returning early here would
  // strand the session with modes stuck on.
  if (run.status === 'done' || run.status === 'failed') {
    if (agent.planMode.isActive && agent.planMode.isUltraMode) {
      agent.planMode.exit();
    }
    return completeUltraGoalForFinishedRun(agent);
  }
  if (run.status !== 'running') return undefined;

  const audit = auditUltraworkCompletion({ run, requireWorkGraph: true });
  if (!audit.ok) {
    agent.log.warn('ultrawork finish rejected by completion audit', {
      runId: run.id,
      code: audit.code,
      reasons: audit.reasons,
    });
    agent.telemetry.track('ultrawork_finish_audit_rejected', {
      run_id: run.id,
      code: audit.code,
      open_nodes: audit.openNodeIds?.length ?? 0,
    });
    // Soft verify path (AC-C2): surface the audit as a system reminder so the
    // model keeps implementing without a silent no-op finish.
    injectCompletionAuditRejectionReminder(agent, audit);
    return undefined;
  }

  const graph = run.workGraph;
  // Audit already requires a non-empty graph; keep defensive early returns.
  if (graph === undefined || graph.nodes.length === 0) return undefined;

  // Circuit breaker: all terminal with some failed — finish so harness does not
  // loop forever, but only when audit passed (verification_failed would block).
  if (!graph.nodes.every((node) => node.status === 'done')) {
    const allTerminal = graph.nodes.every(
      (node) => node.status === 'done' || node.status === 'failed',
    );
    if (allTerminal) {
      const failedIds = graph.nodes
        .filter((node) => node.status === 'failed')
        .map((node) => node.id);
      agent.log.warn('ultrawork run finishing with failed nodes', {
        runId: run.id,
        failedNodeIds: failedIds,
      });
      agent.telemetry.track('ultrawork_finish_with_failures', {
        run_id: run.id,
        failed_nodes: failedIds.length,
        total_nodes: graph.nodes.length,
      });
      ultrawork.completeLearnStage();
      return completeUltraGoalForFinishedRun(agent);
    }
    return undefined;
  }
  ultrawork.completeLearnStage();
  return completeUltraGoalForFinishedRun(agent);
}

/**
 * Inject a system reminder so the model keeps the autonomous loop after a
 * rejected complete attempt (does not stop the turn by itself).
 */
export function injectCompletionAuditRejectionReminder(
  agent: Agent,
  rejection: ReturnType<typeof auditUltraworkCompletion> & { ok: false },
): void {
  agent.context.appendSystemReminder(formatCompletionAuditRejection(rejection), {
    kind: 'injection',
    variant: 'ultrawork_completion_rejected',
  });
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
