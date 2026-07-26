/**
 * Pure Ultrawork recovery report/prompt builders (no Agent mutation).
 */

import type { UltraworkRun, WorkGraphNode } from '@superliora/protocol';

import { applyEvidenceHardGate } from '../session/swarm-evidence-gate';
import {
  analyzeFailedNodes,
  countResumeCyclesFromHistory,
  detectLongRunningStage,
  detectStuckWorkGraphNodes,
  inferEffectiveUltraworkStage,
  OSCILLATION_WARN_THRESHOLD,
  summarizeWorkGraphProgress,
  ultraworkStageIndex,
} from './stage-progress';
import type {
  UltraworkActivation,
  UltraworkPlanRecoveryContext,
  UltraworkRecoveryReport,
  UltraworkResumeCursor,
} from './types';

/** Nodes that still need verification evidence or have failed/blocked verification. */
export function collectVerificationGapNodes(
  nodes: readonly WorkGraphNode[] | undefined,
): readonly WorkGraphNode[] {
  if (nodes === undefined || nodes.length === 0) return [];
  return nodes.filter((node) => {
    if (node.status === 'cancelled' || node.status === 'failed') return false;
    if (node.verificationStatus === 'failed' || node.verificationStatus === 'blocked') {
      return true;
    }
    if (node.verificationStatus === 'pending' || node.verificationStatus === undefined) {
      const required = node.requiredEvidence?.filter((id) => id.length > 0) ?? [];
      if (required.length === 0) return false;
      const evidence = new Set(node.evidenceIds ?? []);
      return required.some((id) => !evidence.has(id));
    }
    return false;
  });
}

/**
 * Match completion-audit evidence hard-gate next_actions formatting.
 * Surfaces done-without-evidence (or policy missing requiredEvidence) nodes so
 * recovery injectors / envelopes / next_actions share one repair cue.
 */
export function formatEvidenceHardGateNextActions(
  nodes: readonly WorkGraphNode[] | undefined,
): readonly string[] {
  if (nodes === undefined || nodes.length === 0) return [];
  const { violations } = applyEvidenceHardGate(nodes);
  if (violations.length === 0) return [];
  const gateNodes = violations.slice(0, 3).map((v) => {
    const node = nodes.find((n) => n.id === v.nodeId);
    const required =
      node?.requiredEvidence?.filter((id) => id.length > 0).slice(0, 3).join(', ') ?? '';
    const missing = required.length > 0 ? `; requiredEvidence: ${required}` : '';
    return `${v.nodeId}${missing}`;
  });
  return [
    `Close evidence hard-gate on node(s): ${gateNodes.join(', ')}${violations.length > 3 ? ', …' : ''} — attach matching evidenceIds (and verificationSummary when useful), then set status=done only after checks.`,
  ];
}

/** Compact body/envelope summary of evidence hard-gate violations. */
export function formatEvidenceHardGateSummary(
  nodes: readonly WorkGraphNode[] | undefined,
): string | undefined {
  if (nodes === undefined || nodes.length === 0) return undefined;
  const { violations } = applyEvidenceHardGate(nodes);
  if (violations.length === 0) return undefined;
  const ids = violations
    .slice(0, 4)
    .map((v) => {
      const node = nodes.find((n) => n.id === v.nodeId);
      const required =
        node?.requiredEvidence?.filter((id) => id.length > 0).slice(0, 2).join(',') ?? '';
      return required.length > 0 ? `${v.nodeId}[${required}]` : v.nodeId;
    })
    .join(', ');
  return `${ids}${violations.length > 4 ? ', …' : ''}`;
}

export function formatVerificationGapSummary(
  nodes: readonly WorkGraphNode[],
  limit = 4,
): string {
  return nodes
    .slice(0, limit)
    .map((node) => {
      const required = node.requiredEvidence?.filter((id) => id.length > 0) ?? [];
      const missing =
        required.length > 0
          ? ` missing=${required
              .filter((id) => !(node.evidenceIds ?? []).includes(id))
              .slice(0, 3)
              .join(',')}`
          : '';
      const verify =
        node.verificationStatus !== undefined ? ` verify=${node.verificationStatus}` : '';
      return `${node.id}${verify}${missing}`;
    })
    .join(', ');
}

/**
 * Match completion-audit / recovery-triangle verification-gap next_actions.
 * Callers pass the already-filtered node set (failed/blocked/pending/open gaps).
 */
export function formatVerificationGapNextActions(
  nodes: readonly WorkGraphNode[],
): readonly string[] {
  if (nodes.length === 0) return [];
  return [
    `Close verification gaps on node(s): ${nodes
      .slice(0, 3)
      .map((node) => {
        const required = node.requiredEvidence?.filter((id) => id.length > 0) ?? [];
        const missing =
          required.length > 0
            ? `; missing evidence: ${required
                .filter((id) => !(node.evidenceIds ?? []).includes(id))
                .slice(0, 3)
                .join(', ')}`
            : '';
        return `${node.id} (${node.title}${node.verificationStatus !== undefined ? `; verify=${node.verificationStatus}` : ''}${missing})`;
      })
      .join(', ')}${nodes.length > 3 ? ', …' : ''} — attach required evidence before UpdateGoal(complete).`,
  ];
}

/**
 * Match recovery-triangle failed-node next_actions formatting.
 * Prefer analyzeFailedNodes category guidance when available.
 */
export function formatFailedNodeNextActions(
  nodes: readonly WorkGraphNode[],
  workGraph?: UltraworkRun['workGraph'],
): readonly string[] {
  if (nodes.length === 0) return [];
  const failedAnalysis = analyzeFailedNodes(workGraph);
  const categoryHints = failedAnalysis
    .slice(0, 2)
    .map(({ node, category, guidance }) => `${node.id}[${category}]: ${guidance}`)
    .join(' | ');
  if (categoryHints.length > 0) {
    return [
      `Repair failed WorkGraph node(s) first: ${nodes
        .slice(0, 3)
        .map((node) => node.id)
        .join(', ')}${nodes.length > 3 ? ', …' : ''} — ${categoryHints}`,
    ];
  }
  return [
    `Repair failed WorkGraph node(s) first: ${nodes
      .slice(0, 3)
      .map((node) => node.id)
      .join(', ')}${nodes.length > 3 ? ', …' : ''} — failed status blocks goal complete.`,
  ];
}

/** Match recovery-triangle needs_integration next_actions (id + title). */
export function formatNeedsIntegrationNextActions(
  nodes: readonly WorkGraphNode[],
): readonly string[] {
  if (nodes.length === 0) return [];
  return [
    `Integrate specialist handoffs for node(s): ${nodes
      .slice(0, 3)
      .map((node) => `${node.id} (${node.title})`)
      .join(', ')}${nodes.length > 3 ? ', …' : ''} — needs_integration blocks goal complete.`,
  ];
}

/** Match recovery-triangle blocked-node next_actions (id + title + dependsOn). */
export function formatBlockedNodeNextActions(nodes: readonly WorkGraphNode[]): readonly string[] {
  if (nodes.length === 0) return [];
  const depHints = nodes
    .slice(0, 3)
    .map((node) => {
      const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
      return deps.length > 0
        ? `${node.id} (${node.title}; dependsOn: ${deps.slice(0, 3).join(', ')}${deps.length > 3 ? ', …' : ''})`
        : `${node.id} (${node.title})`;
    })
    .join(', ');
  return [
    `Unblock WorkGraph node(s) first: ${depHints}${nodes.length > 3 ? ', …' : ''} — resolve dependencies or re-queue before more product edits.`,
  ];
}

/** Match recovery-triangle ownerless-running next_actions (id + title). */
export function formatOwnerlessRunningNextActions(
  nodes: readonly WorkGraphNode[],
): readonly string[] {
  if (nodes.length === 0) return [];
  return [
    `Assign owner or re-queue orphan running node(s): ${nodes
      .slice(0, 3)
      .map((node) => `${node.id} (${node.title})`)
      .join(', ')}${nodes.length > 3 ? ', …' : ''} — running without owner stalls progress.`,
  ];
}

/** Match recovery-triangle queued dependsOn wait next_actions. */
export function formatQueuedDependsOnWaitNextActions(
  nodes: readonly WorkGraphNode[],
): readonly string[] {
  if (nodes.length === 0) return [];
  const waitHints = nodes
    .slice(0, 3)
    .map((node) => {
      const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
      return `${node.id} (${node.title}; dependsOn: ${deps.slice(0, 3).join(', ')}${deps.length > 3 ? ', …' : ''})`;
    })
    .join(', ');
  return [
    `Queued node(s) waiting on dependsOn: ${waitHints}${nodes.length > 3 ? ', …' : ''} — finish or cancel deps before forcing progress.`,
  ];
}

/** Match recovery-triangle owned stuck-node next_actions (id + status). */
export function formatStuckNodeNextActions(nodes: readonly WorkGraphNode[]): readonly string[] {
  if (nodes.length === 0) return [];
  return [
    `Circuit-break stuck WorkGraph node(s): ${nodes
      .slice(0, 3)
      .map((node) => `${node.id}[${node.status}]`)
      .join(', ')}${nodes.length > 3 ? ', …' : ''} — re-queue, verify active owner progress, or mark failed if unrecoverable.`,
  ];
}

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

/**
 * Generic incomplete-node next_actions shared by completion-audit (and any
 * recovery surface that needs the same finish guidance after stall-specific hints).
 */
export function formatIncompleteNodeNextActions(): readonly string[] {
  return [
    'Finish or re-open incomplete nodes with real evidence.',
    'Do not call UpdateGoal(complete) until every AC node is done with verification.',
    'If blocked on evidence, run tests/checks and attach paths in evidenceIds.',
  ];
}

export function buildUltraworkRecoveryReport(input: {
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
  readonly orphanedWorkNodes: readonly string[];
  readonly orphanedExperts: readonly string[];
  readonly lostBackgroundTasks: readonly string[];
  readonly planContext?: UltraworkPlanRecoveryContext;
  readonly resumeCursor?: UltraworkResumeCursor;
  readonly skippedInterview?: boolean;
}): UltraworkRecoveryReport {
  return {
    run: input.run,
    activation: input.activation,
    interruptReason: input.interruptReason,
    orphanedWorkNodes: input.orphanedWorkNodes,
    orphanedExperts: input.orphanedExperts,
    lostBackgroundTasks: input.lostBackgroundTasks,
    skippedInterview: input.skippedInterview,
    nextActions: suggestNextActions(
      input.run,
      input.interruptReason,
      input.planContext,
      input.resumeCursor,
      input.skippedInterview,
    ),
  };
}

export function buildUltraworkRecoveryPrompt(
  report: UltraworkRecoveryReport,
  planContext?: UltraworkPlanRecoveryContext,
  resumeCursor?: UltraworkResumeCursor,
): string {
  const lines = [
    '<ultrawork_recovery>',
    'Resume from last durable checkpoint. Do not restart from scratch unless unusable.',
    `Run: ${report.run.id} · stage=${report.run.stage} · status=${report.run.status}`,
    `Objective: ${report.run.objective}`,
    `Updated: ${report.run.updatedAt}`,
  ];

  if (report.interruptReason !== undefined) {
    lines.push(`Interrupt reason: ${report.interruptReason}`);
  }
  if (report.activation !== undefined) {
    lines.push(`Evidence root: ${report.activation.evidenceRoot}`);
  }
  if (planContext?.planFilePath !== undefined) {
    lines.push(`Plan file: ${planContext.planFilePath}`);
  }
  if (planContext?.phase !== undefined) {
    lines.push(`UltraPlan phase: ${planContext.phase}; do not create plan file or restart EnterPlanMode.`);
  }
  if (planContext?.interviewRoundCount !== undefined && planContext.interviewRoundCount > 0) {
    lines.push(`Interview rounds completed: ${String(planContext.interviewRoundCount)}; do not restart interview from round 1.`);
  }
  if (report.skippedInterview === true) {
    lines.push(
      'Resume policy: Skip UltraPlan interview. Continue design/implementation/verification from checkpoint.',
    );
    lines.push(
      'Do not ask blocking interview questions unless a critical blocker blocks progress.',
    );
  }

  const progress = summarizeWorkGraphProgress(report.run.workGraph);
  const graphNodeCount = report.run.workGraph?.nodes.length ?? 0;
  // Body-level seed (nextActions already prioritizes empty graphs) — match injectors/envelope.
  if (graphNodeCount === 0) {
    lines.push('WorkGraph empty or missing.');
    lines.push(...formatEmptyWorkGraphSeedNextActions());
  }
  if (progress.doneCount > 0 || progress.pendingCount > 0) {
    lines.push(
      `WorkGraph progress: ${String(progress.doneCount)} done, ${String(progress.pendingCount)} pending.`,
    );
  }

  const effectiveStage = inferEffectiveUltraworkStage(report.run.stage, report.run.workGraph);
  if (effectiveStage !== report.run.stage) {
    lines.push(
      `Effective resume stage: ${effectiveStage} (checkpoint stage ${report.run.stage} is behind WorkGraph progress).`,
    );
    lines.push(
      'Do not restart UltraResearch, UltraPlan interview, or other completed stages unless checkpoint is unusable.',
    );
  }

  if (resumeCursor !== undefined) {
    lines.push('Resume cursor:');
    lines.push(`- stage: ${resumeCursor.stage}`);
    if (resumeCursor.planPhase !== undefined) {
      lines.push(`- plan_phase: ${resumeCursor.planPhase}`);
    }
    if (resumeCursor.interviewRound !== undefined && resumeCursor.interviewRound > 0) {
      lines.push(`- continue_interview_from_round: ${String(resumeCursor.interviewRound + 1)}`);
    }
    if (resumeCursor.workGraphNodeId !== undefined) {
      lines.push(`- work_graph_node: ${resumeCursor.workGraphNodeId}`);
    }
    if (resumeCursor.goalStatus !== undefined) {
      lines.push(`- goal_status: ${resumeCursor.goalStatus}`);
    }
    if (resumeCursor.journalOffset !== undefined) {
      lines.push(`- journal_offset: ${String(resumeCursor.journalOffset)}`);
    }
  }

  // Keep only the most actionable pending nodes / orphans; full graph is on disk.
  // cancelled is success-terminal (deliberate scope drop) — match injectors / resume-intent.
  // Injector/envelope-grade stall classification so crash recovery is not a flat pending dump.
  if (report.run.workGraph !== undefined && report.run.workGraph.nodes.length > 0) {
    const nodes = report.run.workGraph.nodes;
    const pending = nodes.filter(
      (node) => node.status !== 'done' && node.status !== 'cancelled',
    );
    const failedNodes = nodes.filter((node) => node.status === 'failed');
    const needsIntegrationNodes = nodes.filter((node) => node.status === 'needs_integration');
    const blockedNodes = nodes.filter((node) => node.status === 'blocked');
    const ownerlessRunningNodes = nodes.filter(
      (node) =>
        node.status === 'running' &&
        (node.ownerExpertId === undefined || node.ownerExpertId.length === 0) &&
        (node.ownerAgentId === undefined || node.ownerAgentId.length === 0),
    );
    const waitingQueuedNodes = nodes.filter((node) => {
      if (node.status !== 'queued') return false;
      const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
      return deps.length > 0;
    });
    const verificationGapNodes = collectVerificationGapNodes(nodes);

    if (failedNodes.length > 0) {
      lines.push(
        `Failed WorkGraph nodes (${String(failedNodes.length)}): ${failedNodes
          .slice(0, 4)
          .map((node) => `${node.id} ${node.title}`)
          .join(', ')}${failedNodes.length > 4 ? ', …' : ''}`,
      );
      lines.push(
        'Failed nodes block UpdateGoal(complete) — repair, re-verify, or cancel only after deliberate scope drop.',
      );
    }
    if (needsIntegrationNodes.length > 0) {
      lines.push(
        `Needs-integration WorkGraph nodes (${String(needsIntegrationNodes.length)}): ${needsIntegrationNodes
          .slice(0, 4)
          .map((node) => `${node.id} ${node.title}`)
          .join(', ')}${needsIntegrationNodes.length > 4 ? ', …' : ''}`,
      );
      lines.push(
        'needs_integration blocks UpdateGoal(complete) — merge specialist handoffs and mark nodes done only after integration evidence.',
      );
    }
    if (blockedNodes.length > 0) {
      lines.push(
        `Blocked WorkGraph nodes (${String(blockedNodes.length)}): ${blockedNodes
          .slice(0, 4)
          .map((node) => `${node.id} ${node.title}`)
          .join(', ')}${blockedNodes.length > 4 ? ', …' : ''}`,
      );
      lines.push(
        'Blocked nodes stall progress — resolve dependsOn, re-queue, or cancel only after deliberate scope drop.',
      );
    }
    if (ownerlessRunningNodes.length > 0) {
      lines.push(
        `Ownerless running WorkGraph nodes (${String(ownerlessRunningNodes.length)}): ${ownerlessRunningNodes
          .slice(0, 4)
          .map((node) => `${node.id} ${node.title}`)
          .join(', ')}${ownerlessRunningNodes.length > 4 ? ', …' : ''}`,
      );
      lines.push(
        'Running without owner stalls progress — assign ownerExpertId/ownerAgentId or re-queue.',
      );
    }
    if (waitingQueuedNodes.length > 0 && blockedNodes.length === 0) {
      lines.push(
        `Queued waiting on dependsOn (${String(waitingQueuedNodes.length)}): ${waitingQueuedNodes
          .slice(0, 4)
          .map((node) => {
            const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
            return `${node.id} (dependsOn: ${deps.slice(0, 3).join(', ')}${deps.length > 3 ? ', …' : ''})`;
          })
          .join('; ')}${waitingQueuedNodes.length > 4 ? '; …' : ''}`,
      );
      lines.push(
        'Queued dependsOn waits stall progress — finish or cancel deps before forcing progress.',
      );
    }
    if (verificationGapNodes.length > 0) {
      lines.push(
        `Verification-gap WorkGraph nodes (${String(verificationGapNodes.length)}): ${formatVerificationGapSummary(verificationGapNodes)}${verificationGapNodes.length > 4 ? ', …' : ''}`,
      );
      lines.push(
        'Verification gaps block UpdateGoal(complete) — attach requiredEvidence and re-verify before finishing.',
      );
    }

    if (pending.length > 0) {
      lines.push(`Pending WorkGraph nodes (${String(pending.length)}):`);
      for (const node of pending.slice(0, 5)) {
        lines.push(`- [${node.status}] ${node.id}: ${node.title} (stage=${node.stage})`);
      }
      if (pending.length > 5) {
        lines.push(`- … ${String(pending.length - 5)} more`);
      }
    }
    // Highlight stuck nodes (running/blocked) that may need circuit-breaking.
    const stuckNodes = detectStuckWorkGraphNodes(report.run.workGraph);
    if (stuckNodes.length > 0) {
      lines.push(
        `⚠ Stuck nodes (${String(stuckNodes.length)}): ${stuckNodes.slice(0, 3).map((n) => `${n.id} [${n.status}]`).join(', ')}`,
      );
      lines.push(
        'Consider: re-queue blocked nodes, verify running nodes have active owners, or mark failed if unrecoverable.',
      );
    }
  }
  // Warn about stages running longer than expected (un-bounded loop anti-pattern).
  const longStage = detectLongRunningStage(report.run);
  if (longStage !== undefined) {
    const elapsedMin = Math.round(longStage.elapsedMs / 60_000);
    const thresholdMin = Math.round(longStage.thresholdMs / 60_000);
    lines.push(
      `⚠ Stage "${longStage.stage}" running ~${String(elapsedMin)}min (expected <${String(thresholdMin)}min). Consider advancing or splitting work.`,
    );
  }
  // Warn about oscillation (repeated crash-recovery loops).
  const resumeCycles = countResumeCyclesFromHistory(report.run);
  if (resumeCycles >= OSCILLATION_WARN_THRESHOLD) {
    lines.push(
      `⚠ High resume count (${String(resumeCycles)}): repeated crash-recovery cycles detected. Consider simplifying the objective or breaking into smaller runs.`,
    );
  }
  // Analyze failed nodes and provide categorized recovery guidance.
  const failedAnalysis = analyzeFailedNodes(report.run.workGraph);
  if (failedAnalysis.length > 0) {
    lines.push(`Failed nodes (${String(failedAnalysis.length)}):`);
    for (const { node, category, guidance } of failedAnalysis.slice(0, 3)) {
      lines.push(`- ${node.id} [${category}]: ${guidance}`);
    }
    if (failedAnalysis.length > 3) {
      lines.push(`- … ${String(failedAnalysis.length - 3)} more failed nodes`);
    }
  }
  if (report.orphanedWorkNodes.length > 0) {
    lines.push(`Reconcile orphaned work nodes: ${report.orphanedWorkNodes.slice(0, 8).join(', ')}`);
  }
  if (report.orphanedExperts.length > 0) {
    lines.push(`Reconcile orphaned experts: ${report.orphanedExperts.slice(0, 8).join(', ')}`);
  }
  if (report.lostBackgroundTasks.length > 0) {
    lines.push(`Lost/failed background tasks: ${report.lostBackgroundTasks.slice(0, 8).join(', ')}`);
  }

  lines.push('Next actions:');
  for (const action of report.nextActions.slice(0, 4)) {
    lines.push(`- ${action}`);
  }
  lines.push(
    'Source of truth: Repository files, git status, and WorkGraph are more reliable than prior chat memory. Inspect workspace first.',
  );
  lines.push(
    'Continue from stage; refresh evidence; keep WorkGraph current. Prefer tests/typecheck/real-surface proof; mark AC/nodes done only with evidence. Preserve durable ids.',
  );
  lines.push('</ultrawork_recovery>');
  const result = lines.join('\n');
  // Guard: clip excessively large recovery prompts to protect context budget.
  const MAX_RECOVERY_PROMPT_CHARS = 4_000;
  if (result.length > MAX_RECOVERY_PROMPT_CHARS) {
    return `${result.slice(0, MAX_RECOVERY_PROMPT_CHARS)}\n… (truncated)\n</ultrawork_recovery>`;
  }
  return result;
}

export function suggestNextActions(
  run: UltraworkRun,
  interruptReason?: string,
  planContext?: UltraworkPlanRecoveryContext,
  resumeCursor?: UltraworkResumeCursor,
  skippedInterview = false,
): string[] {
  const actions: string[] = [];
  if (interruptReason !== undefined) {
    actions.push(`Acknowledge interruption (${interruptReason}); restate objective.`);
  }
  // Empty/missing WorkGraph is a hard false-complete gate — seed before more product work.
  const graphNodes = run.workGraph?.nodes;
  if (graphNodes === undefined || graphNodes.length === 0) {
    actions.push(...formatEmptyWorkGraphSeedNextActions());
  }

  const progress = summarizeWorkGraphProgress(run.workGraph);
  const effectiveStage = inferEffectiveUltraworkStage(run.stage, run.workGraph);
  const failedNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'failed') ?? [];
  if (failedNodes.length > 0) {
    actions.push(...formatFailedNodeNextActions(failedNodes, run.workGraph));
  }
  const needsIntegration =
    run.workGraph?.nodes.filter((node) => node.status === 'needs_integration') ?? [];
  if (needsIntegration.length > 0) {
    actions.push(...formatNeedsIntegrationNextActions(needsIntegration));
  }
  const blockedNodes =
    run.workGraph?.nodes.filter((node) => node.status === 'blocked') ?? [];
  if (blockedNodes.length > 0) {
    actions.push(...formatBlockedNodeNextActions(blockedNodes));
  }
  const ownerlessRunning =
    run.workGraph?.nodes.filter(
      (node) =>
        node.status === 'running' &&
        (node.ownerExpertId === undefined || node.ownerExpertId.length === 0) &&
        (node.ownerAgentId === undefined || node.ownerAgentId.length === 0),
    ) ?? [];
  if (ownerlessRunning.length > 0) {
    actions.push(...formatOwnerlessRunningNextActions(ownerlessRunning));
  }
  // Queued nodes with explicit dependsOn that are not yet terminal — surface the wait graph.
  const waitingQueued =
    run.workGraph?.nodes.filter((node) => {
      if (node.status !== 'queued') return false;
      const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
      return deps.length > 0;
    }) ?? [];
  if (waitingQueued.length > 0 && blockedNodes.length === 0) {
    // Skip when blocked guidance already covers dependency stalls to avoid duplicate noise.
    actions.push(...formatQueuedDependsOnWaitNextActions(waitingQueued));
  }
  const verificationGaps = collectVerificationGapNodes(run.workGraph?.nodes);
  if (verificationGaps.length > 0) {
    actions.push(...formatVerificationGapNextActions(verificationGaps));
  }
  // Match completion-audit evidence hard-gate next_actions for recovery surfaces.
  actions.push(...formatEvidenceHardGateNextActions(run.workGraph?.nodes));
  // Promote circuit-break signals into next_actions (not body-only) so injectors
  // and envelopes do not keep recommending "Resume node" during oscillation.
  // Skip blocked/ownerless already handled above — only owned running stuck remain.
  const stuckNodes = detectStuckWorkGraphNodes(run.workGraph).filter((node) => {
    if (node.status === 'blocked') return false;
    if (node.status !== 'running') return false;
    const hasOwner =
      (node.ownerExpertId !== undefined && node.ownerExpertId.length > 0) ||
      (node.ownerAgentId !== undefined && node.ownerAgentId.length > 0);
    return hasOwner;
  });
  if (stuckNodes.length > 0) {
    actions.push(...formatStuckNodeNextActions(stuckNodes));
  }
  const resumeCycles = countResumeCyclesFromHistory(run);
  actions.push(...formatHighResumeOscillationNextActions(resumeCycles));
  const longStage = detectLongRunningStage(run);
  actions.push(...formatLongRunningStageNextActions(longStage));
  if (
    progress.doneCount > 0 &&
    ultraworkStageIndex(effectiveStage) > ultraworkStageIndex('research') &&
    run.stage === 'research'
  ) {
    actions.push(
      'WorkGraph ahead of checkpoint — continue in-progress node; do not restart research.',
    );
  }
  const planPhase = planContext?.phase ?? resumeCursor?.planPhase;
  if (progress.nextPendingNode !== undefined) {
    // Single WorkGraph resume action — avoid duplicate "resume node" lines when interview is skipped.
    actions.push(
      skippedInterview
        ? `Continue WorkGraph node ${progress.nextPendingNode.id}: ${progress.nextPendingNode.title}; do not reopen UltraPlan interview.`
        : `Resume WorkGraph node ${progress.nextPendingNode.id}: ${progress.nextPendingNode.title}.`,
    );
  }

  if (skippedInterview) {
    if (progress.nextPendingNode === undefined) {
      if (planPhase === 'design' || planPhase === 'review' || planPhase === 'write' || planPhase === 'exit') {
        actions.push(
          `Resume UltraPlan ${planPhase} from checkpoint; advance toward ExitPlanMode without new interview rounds.`,
        );
      } else if (effectiveStage === 'goal' || effectiveStage === 'staff' || effectiveStage === 'swarm') {
        actions.push('Verify UltraGoal; resume autonomous pursuit without interview questions.');
      } else if (
        effectiveStage === 'integrate' ||
        effectiveStage === 'verify' ||
        effectiveStage === 'learn'
      ) {
        actions.push(`Continue ${effectiveStage} from checkpoint; do not reopen UltraPlan interview.`);
      } else {
        actions.push('Continue from saved checkpoint; do not reopen UltraPlan interview.');
      }
    }
  } else if (effectiveStage === 'plan' || effectiveStage === 'research') {
    switch (planPhase) {
      case 'research':
        actions.push('Refresh the evidence pack before asking blocking questions.');
        break;
      case 'interview': {
        const round = planContext?.interviewRoundCount ?? resumeCursor?.interviewRound ?? 0;
        actions.push(
          round > 0
            ? `Continue UltraPlan interview from round ${String(round + 1)}; do not restart discovery.`
            : 'Continue UltraPlan interview from the current evidence pack.',
        );
        actions.push(
          'Research-first before AskUserQuestion; Baseline + Upgrade choices.',
        );
        break;
      }
      case 'design':
        actions.push('Resume design coverage lanes before Review.');
        break;
      case 'review':
        actions.push('Re-verify plan against code/sources, then advance to Write.');
        break;
      case 'write':
        actions.push('Resume writing approved plan sections; do not reopen interview.');
        break;
      case 'exit':
        actions.push('Call ExitPlanMode only after Seed Spec gate passes.');
        break;
      default:
        actions.push('Re-open Ultra Plan file; continue interview or plan gate.');
        break;
    }
  } else {
    switch (effectiveStage) {
      case 'intake':
        actions.push('Re-open Ultra Plan file; continue interview or plan gate.');
        break;
      case 'goal':
        actions.push('Verify UltraGoal contract and resume autonomous pursuit.');
        break;
      case 'staff':
      case 'swarm':
        actions.push('Reconcile swarm staffing; rerun UltraSwarm only if ENGAGE required.');
        break;
      case 'integrate':
        actions.push('Merge specialist output and resolve conflicts before more product edits.');
        break;
      case 'verify':
        actions.push('Re-run mechanical checks; capture runtime evidence for open ACs.');
        break;
      case 'learn':
        actions.push('Update knowledge ledger; promote only verified findings.');
        break;
      case 'done':
        actions.push('Confirm completion criteria and close the run.');
        break;
      case 'plan':
      case 'research':
        actions.push('Continue plan/research from checkpoint; do not restart discovery.');
        break;
      default:
        actions.push(
          `Continue Ultrawork stage ${effectiveStage}; keep WorkGraph current and attach evidence before UpdateGoal(complete).`,
        );
        break;
    }
  }

  // Defensive: never return an empty action list — empty guidance freezes the autonomous loop.
  if (actions.length === 0) {
    actions.push(
      'Continue from durable checkpoint; re-run checks, attach evidence, and only then UpdateGoal(complete).',
    );
  }

  return actions.slice(0, 4);
}
