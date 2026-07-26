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
import {
  collectVerificationGapNodes,
  formatBlockedNodeNextActions,
  formatEvidenceHardGateNextActions,
  formatFailedNodeNextActions,
  formatNeedsIntegrationNextActions,
  formatVerificationGapNextActions,
} from './recovery-prompt';
import {
  analyzeFailedNodes,
  countResumeCyclesFromHistory,
  detectLongRunningStage,
  detectStuckWorkGraphNodes,
  OSCILLATION_WARN_THRESHOLD,
} from './stage-progress';

export type CompletionAuditCode =
  | 'empty_work_graph'
  | 'incomplete_nodes'
  | 'evidence_gate'
  | 'verification_failed'
  /** verificationStatus=blocked on a gated node (checks could not complete). */
  | 'verification_blocked'
  | 'verification_pending'
  /** WorkGraph node status=failed (distinct from verificationStatus=failed). */
  | 'node_failed'
  /** WorkGraph node status=needs_integration — specialist handoffs not merged. */
  | 'needs_integration'
  /** WorkGraph node status=blocked — dependsOn or external stall. */
  | 'node_blocked'
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
        // Match recovery-triangle seed wording so injectors/envelope/audit share one action.
        'Seed WorkGraph via UltraworkGraph (acceptance criteria + verification nodes with requiredEvidence) before UpdateGoal(complete) — empty graph is rejected as false complete.',
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
  // Match recovery triangle priority:
  // failed → needs_integration → blocked → generic open (ownerless hint).
  // status=failed is NOT success: it still blocks goal complete.
  // Completing the goal while any node is failed would paper over broken ACs.
  // Attach analyzeFailedNodes category guidance so UpdateGoal(complete) rejections
  // point to concrete repair steps (even when other open nodes also exist).
  const failedNodes = gatedNodes.filter((n) => n.status === 'failed');
  if (failedNodes.length > 0) {
    const openNodeIds = failedNodes.map((n) => n.id);
    const failedGraph = {
      id: run.workGraph?.id ?? `${run.id}:work_graph`,
      runId: run.id,
      rootGoal: run.workGraph?.rootGoal,
      nodes: failedNodes,
    };
    const failedAnalysis = analyzeFailedNodes(failedGraph);
    const categoryReasons = failedAnalysis
      .slice(0, 2)
      .map(({ node, category, guidance }) => `${node.id}[${category}]: ${guidance}`);
    return reject(
      'node_failed',
      [
        `WorkGraph nodes still status=failed: ${openNodeIds.join(', ')}.`,
        'Failed nodes block goal complete — fix, re-run, or cancel only after deliberate scope drop.',
        ...categoryReasons,
      ],
      [
        // Match recovery-prompt failed-node next_actions wording.
        ...formatFailedNodeNextActions(failedNodes, failedGraph),
        'If the node is out of scope, set status=cancelled (not failed) after an explicit decision.',
      ],
      openNodeIds,
    );
  }

  const needsIntegrationNodes = gatedNodes.filter((n) => n.status === 'needs_integration');
  if (needsIntegrationNodes.length > 0) {
    const openNodeIds = needsIntegrationNodes.map((n) => n.id);
    return reject(
      'needs_integration',
      [
        `WorkGraph nodes still needs_integration: ${openNodeIds.join(', ')}.`,
        'needs_integration blocks goal complete — merge specialist handoffs before finishing.',
      ],
      [
        // Match recovery-prompt needs_integration next_actions wording.
        ...formatNeedsIntegrationNextActions(needsIntegrationNodes),
        'Merge handoffs and mark nodes done only after integration evidence.',
        'Do not call UpdateGoal(complete) while any node is still needs_integration.',
      ],
      openNodeIds,
    );
  }

  // Use original graph status for intentional blocked — evidence hard gate also
  // remaps done-without-evidence to status=blocked in gatedNodes, which must
  // stay on the evidence_gate path below.
  const blockedNodes = graph.nodes.filter((n) => n.status === 'blocked');
  if (blockedNodes.length > 0) {
    const openNodeIds = blockedNodes.map((n) => n.id);
    return reject(
      'node_blocked',
      [
        `WorkGraph nodes still status=blocked: ${openNodeIds.join(', ')}.`,
        'Blocked nodes stall progress — resolve dependsOn, re-queue, or cancel only after deliberate scope drop.',
      ],
      [
        // Match recovery-prompt blocked-node next_actions wording.
        ...formatBlockedNodeNextActions(blockedNodes),
        'Do not call UpdateGoal(complete) while any node is still blocked.',
      ],
      openNodeIds,
    );
  }

  // Remaining non-terminal open work (queued/running/evidence-remapped blocked/…).
  // Do not exclude gated status=blocked here — evidence hard gate uses that path.
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
    const ownerlessRunning = open.filter(
      (n) =>
        n.status === 'running' &&
        (n.ownerExpertId === undefined || n.ownerExpertId.length === 0) &&
        (n.ownerAgentId === undefined || n.ownerAgentId.length === 0),
    );
    // Match recovery-triangle dependsOn wait guidance when nothing is already blocked.
    const waitingQueued = open.filter((n) => {
      if (n.status !== 'queued') return false;
      const deps = n.dependsOn?.filter((id) => id.length > 0) ?? [];
      return deps.length > 0;
    });
    const reasons = [
      `WorkGraph still has ${open.length} non-done node(s): ${openNodeIds.join(', ')}.`,
      ...evidenceHits.slice(0, 5),
    ];
    const nextActions: string[] = [];
    // Promote concrete evidence-gate repair steps first when the hard gate fired
    // (done-without-evidence remapped to blocked). Share recovery-prompt wording.
    if (evidenceHits.length > 0) {
      nextActions.push(
        ...formatEvidenceHardGateNextActions(graph.nodes),
        'Do not call UpdateGoal(complete) while evidence hard gate remaps done nodes to blocked.',
      );
    }
    if (ownerlessRunning.length > 0) {
      nextActions.push(
        `Assign owner or re-queue orphan running node(s): ${ownerlessRunning
          .slice(0, 3)
          .map((n) => `${n.id} (${n.title})`)
          .join(', ')}${ownerlessRunning.length > 3 ? ', …' : ''} — running without owner stalls progress.`,
      );
    }
    if (waitingQueued.length > 0) {
      const waitHints = waitingQueued
        .slice(0, 3)
        .map((n) => {
          const deps = n.dependsOn?.filter((id) => id.length > 0) ?? [];
          return `${n.id} (${n.title}; dependsOn: ${deps.slice(0, 3).join(', ')}${deps.length > 3 ? ', …' : ''})`;
        })
        .join(', ');
      nextActions.push(
        `Queued node(s) waiting on dependsOn: ${waitHints}${waitingQueued.length > 3 ? ', …' : ''} — finish or cancel deps before forcing progress.`,
      );
    }
    // Match recovery-triangle owned stuck promotion (blocked already has node_blocked).
    const stuckOwned = detectStuckWorkGraphNodes(run.workGraph).filter((n) => {
      if (n.status !== 'running') return false;
      if (!openNodeIds.includes(n.id)) return false;
      const hasOwner =
        (n.ownerExpertId !== undefined && n.ownerExpertId.length > 0) ||
        (n.ownerAgentId !== undefined && n.ownerAgentId.length > 0);
      return hasOwner;
    });
    if (stuckOwned.length > 0) {
      nextActions.push(
        `Circuit-break stuck WorkGraph node(s): ${stuckOwned
          .slice(0, 3)
          .map((n) => `${n.id}[${n.status}]`)
          .join(', ')}${stuckOwned.length > 3 ? ', …' : ''} — re-queue, verify active owner progress, or mark failed if unrecoverable.`,
      );
    }
    // Match recovery-triangle verification-gap next_actions for open graphs
    // (done-only graphs already hit verification_failed/pending/blocked codes).
    nextActions.push(...formatVerificationGapNextActions(collectVerificationGapNodes(open)));
    // Match recovery-triangle circuit-break signals on incomplete audits so
    // UpdateGoal(complete) rejections name oscillation / long stages too.
    const resumeCycles = countResumeCyclesFromHistory(run);
    if (resumeCycles >= OSCILLATION_WARN_THRESHOLD) {
      nextActions.push(
        `Break oscillation: high resume count (${String(resumeCycles)} ≥ ${String(OSCILLATION_WARN_THRESHOLD)}) — simplify objective, cancel stuck nodes, or split into smaller runs before more product edits.`,
      );
    }
    const longStage = detectLongRunningStage(run);
    if (longStage !== undefined) {
      const elapsedMin = Math.round(longStage.elapsedMs / 60_000);
      const thresholdMin = Math.round(longStage.thresholdMs / 60_000);
      nextActions.push(
        `Advance or split long-running stage "${longStage.stage}" (~${String(elapsedMin)}min, expected <${String(thresholdMin)}min) — avoid unbounded loops.`,
      );
    }
    nextActions.push(
      'Finish or re-open incomplete nodes with real evidence.',
      'Do not call UpdateGoal(complete) until every AC node is done with verification.',
      'If blocked on evidence, run tests/checks and attach paths in evidenceIds.',
    );
    return reject(
      evidenceHits.length > 0 ? 'evidence_gate' : 'incomplete_nodes',
      reasons,
      nextActions,
      openNodeIds,
    );
  }

  const verificationFailed = gatedNodes.filter((n) => n.verificationStatus === 'failed');
  if (verificationFailed.length > 0) {
    const openNodeIds = verificationFailed.map((n) => n.id);
    const gapActions = formatVerificationGapNextActions(verificationFailed);
    return reject(
      'verification_failed',
      [
        `Nodes with verificationStatus=failed: ${openNodeIds.join(', ')}.`,
        'Failed verification cannot be papered over with status=done.',
      ],
      [
        ...gapActions,
        'Fix failures, re-run checks, then set verificationStatus=passed with fresh evidence.',
      ],
      openNodeIds,
    );
  }

  // Blocked verification is not a pass — same class of false-complete as failed.
  const verificationBlocked = gatedNodes.filter((n) => n.verificationStatus === 'blocked');
  if (verificationBlocked.length > 0) {
    const openNodeIds = verificationBlocked.map((n) => n.id);
    const gapActions = formatVerificationGapNextActions(verificationBlocked);
    return reject(
      'verification_blocked',
      [
        `Nodes with verificationStatus=blocked: ${openNodeIds.join(', ')}.`,
        'Blocked verification means checks could not complete; status=done is not enough.',
      ],
      [
        ...gapActions,
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
    const gapActions = formatVerificationGapNextActions(pendingVerify);
    return reject(
      'verification_pending',
      [
        `Nodes with requiredEvidence but verificationStatus is not passed: ${openNodeIds.join(', ')}.`,
        'Marking nodes done without an explicit verification pass is a false complete.',
      ],
      [
        ...gapActions,
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
