/**
 * Ultrawork / UltraGoal completion audit.
 *
 * Prevents false-complete: model or runtime must not close a goal/run while
 * the WorkGraph is empty, incomplete, evidence-gated, or unverified.
 *
 * Pure functions — callers wire rejections into markComplete / finish-run.
 */

import type { UltraworkRun, WorkGraphNode } from '@superliora/protocol';

import {
  applyEvidenceHardGate,
  findEvidenceHardGateViolation,
} from '../session/swarm-evidence-gate';

export type CompletionAuditCode =
  | 'empty_work_graph'
  | 'incomplete_nodes'
  | 'evidence_gate'
  | 'verification_failed'
  | 'verification_pending'
  | 'run_not_running'
  /** Structured GoalPredicate evaluation failed (paths/tests/evidence). */
  | 'predicate_failed'
  /** Complete re-attempted before the post-reject cooldown elapsed. */
  | 'reject_cooldown';

export interface CompletionAuditRejection {
  readonly ok: false;
  readonly code: CompletionAuditCode;
  readonly reasons: readonly string[];
  readonly nextActions: readonly string[];
  /** Node ids that still need work (when applicable). */
  readonly openNodeIds?: readonly string[];
}

export interface CompletionAuditPass {
  readonly ok: true;
}

export type CompletionAuditResult = CompletionAuditPass | CompletionAuditRejection;

export interface AuditUltraworkCompletionInput {
  readonly run: UltraworkRun | null | undefined;
  /**
   * When true (default), an empty/missing WorkGraph cannot complete.
   * Plan-only scaffolding still requires a seeded graph before done.
   */
  readonly requireWorkGraph?: boolean;
}

function reject(
  code: CompletionAuditCode,
  reasons: readonly string[],
  nextActions: readonly string[],
  openNodeIds?: readonly string[],
): CompletionAuditRejection {
  return { ok: false, code, reasons, nextActions, openNodeIds };
}

/**
 * Audit whether an Ultrawork run is allowed to finish (and close its goal).
 * Terminal runs (done/failed) pass so callers can still close leftover goals.
 */
export function auditUltraworkCompletion(
  input: AuditUltraworkCompletionInput,
): CompletionAuditResult {
  const run = input.run;
  if (run === null || run === undefined) {
    // No ultrawork binding — plain goals are not gated here.
    return { ok: true };
  }
  if (run.status === 'done' || run.status === 'failed') {
    return { ok: true };
  }
  if (run.status !== 'running' && run.status !== 'blocked') {
    return reject(
      'run_not_running',
      [`Ultrawork run status is ${run.status}; only running/blocked runs can complete via audit.`],
      ['Resume the run or clear it before completing the goal.'],
    );
  }

  const requireWorkGraph = input.requireWorkGraph !== false;
  const graph = run.workGraph;
  if (requireWorkGraph && (graph === undefined || graph.nodes.length === 0)) {
    return reject(
      'empty_work_graph',
      [
        'WorkGraph is missing or empty — completing now would be a false complete.',
        'Long-running Ultrawork must seed AC nodes, implement, and verify before done.',
      ],
      [
        'Seed UltraworkGraph from the approved AC Tree.',
        'Implement open nodes with real code/tests.',
        'Attach requiredEvidence and set verificationStatus=passed only after checks.',
      ],
    );
  }
  if (graph === undefined || graph.nodes.length === 0) {
    return { ok: true };
  }

  // Evidence hard gate: done without evidence becomes blocked in the gated view.
  const { nodes: gatedNodes, violations } = applyEvidenceHardGate(graph.nodes);
  // cancelled is a deliberate terminal status (dropped scope) — treat like done.
  // status=failed is NOT success: it still blocks goal complete (see failedNodes below).
  const open = gatedNodes.filter(
    (n) => n.status !== 'done' && n.status !== 'failed' && n.status !== 'cancelled',
  );
  if (open.length > 0) {
    const openNodeIds = open.map((n) => n.id);
    const evidenceHits =
      violations.length > 0
        ? violations.map((v) => `${v.nodeId}: ${v.reason}`)
        : (() => {
            const hit = findEvidenceHardGateViolation(open);
            return hit === undefined ? [] : [`${hit.nodeId}: ${hit.reason}`];
          })();
    const reasons = [
      `WorkGraph still has ${open.length} non-done node(s): ${openNodeIds.join(', ')}.`,
      ...evidenceHits.slice(0, 5),
    ];
    return reject(
      evidenceHits.length > 0 ? 'evidence_gate' : 'incomplete_nodes',
      reasons,
      [
        'Finish or re-open incomplete nodes with real evidence.',
        'Do not call UpdateGoal(complete) until every AC node is done with verification.',
        'If blocked on evidence, run tests/checks and attach paths in evidenceIds.',
      ],
      openNodeIds,
    );
  }

  // Node status=failed means the work itself failed — not a dropped cancelled scope.
  // Completing the goal while any node is failed would paper over broken ACs.
  const failedNodes = gatedNodes.filter((n) => n.status === 'failed');
  if (failedNodes.length > 0) {
    const openNodeIds = failedNodes.map((n) => n.id);
    return reject(
      'verification_failed',
      [
        `WorkGraph nodes still status=failed: ${openNodeIds.join(', ')}.`,
        'Failed nodes block goal complete — fix, re-run, or cancel only after deliberate scope drop.',
      ],
      [
        'Repair the failed work, re-run checks, then set status=done with verificationStatus=passed.',
        'If the node is out of scope, set status=cancelled (not failed) after an explicit decision.',
      ],
      openNodeIds,
    );
  }

  const verificationFailed = gatedNodes.filter((n) => n.verificationStatus === 'failed');
  if (verificationFailed.length > 0) {
    const openNodeIds = verificationFailed.map((n) => n.id);
    return reject(
      'verification_failed',
      [
        `Nodes with verificationStatus=failed: ${openNodeIds.join(', ')}.`,
        'Failed verification cannot be papered over with status=done.',
      ],
      [
        'Fix failures, re-run checks, then set verificationStatus=passed with fresh evidence.',
      ],
      openNodeIds,
    );
  }

  // Blocked verification is not a pass — same class of false-complete as failed.
  const verificationBlocked = gatedNodes.filter((n) => n.verificationStatus === 'blocked');
  if (verificationBlocked.length > 0) {
    const openNodeIds = verificationBlocked.map((n) => n.id);
    return reject(
      'verification_blocked',
      [
        `Nodes with verificationStatus=blocked: ${openNodeIds.join(', ')}.`,
        'Blocked verification means checks could not complete; status=done is not enough.',
      ],
      [
        'Unblock the verification path (deps, env, surface), re-run checks, then set verificationStatus=passed with evidence.',
      ],
      openNodeIds,
    );
  }

  // Nodes that declare requiredEvidence must explicitly pass verification —
  // soft string evidenceIds alone is not enough to close a long-running goal.
  const pendingVerify = gatedNodes.filter(
    (n) =>
      n.status === 'done' &&
      Array.isArray(n.requiredEvidence) &&
      n.requiredEvidence.length > 0 &&
      n.verificationStatus !== 'passed',
  );
  if (pendingVerify.length > 0) {
    const openNodeIds = pendingVerify.map((n) => n.id);
    return reject(
      'verification_pending',
      [
        `Nodes with requiredEvidence but verificationStatus is not passed: ${openNodeIds.join(', ')}.`,
        'Marking nodes done without an explicit verification pass is a false complete.',
      ],
      [
        'Run mechanical verification (vitest/smoke/real surface).',
        'Set verificationStatus=passed and record evidenceIds for each required token.',
      ],
      openNodeIds,
    );
  }

  return { ok: true };
}

/** Apply evidence hard gate to a node list (copy). */
export function gateWorkGraphNodes(
  nodes: readonly WorkGraphNode[],
): readonly WorkGraphNode[] {
  return applyEvidenceHardGate(nodes).nodes;
}

export function formatCompletionAuditRejection(rejection: CompletionAuditRejection): string {
  const lines = [
    '<ultrawork_completion_rejected>',
    `code: ${rejection.code}`,
    'Completion was rejected to prevent a false complete. The goal/run stay open.',
    '',
    'Reasons:',
    ...rejection.reasons.map((r) => `- ${r}`),
    '',
    'Next actions:',
    ...rejection.nextActions.map((a) => `- ${a}`),
  ];
  if (rejection.openNodeIds !== undefined && rejection.openNodeIds.length > 0) {
    lines.push('', `Open nodes: ${rejection.openNodeIds.join(', ')}`);
  }
  lines.push(
    '',
    'Continue the autonomous loop: implement → verify → attach evidence → only then UpdateGoal(complete).',
    'Do not claim done from audit-only or “already in tree” without proof for this run.',
    '</ultrawork_completion_rejected>',
  );
  return lines.join('\n');
}
