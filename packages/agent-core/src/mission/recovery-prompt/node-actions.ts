import type { UltraworkRun, WorkGraphNode } from '@superliora/protocol';

import { analyzeFailedNodes } from '../stage-progress';

/** Shared UpdateGoal(complete) ban for status=failed WorkGraph nodes. */
export function formatFailedNodeCompleteBan(): string {
  return 'Failed nodes block UpdateGoal(complete) — repair, re-verify, or cancel only after deliberate scope drop.';
}

/** Shared UpdateGoal(complete) ban for needs_integration WorkGraph nodes. */
export function formatNeedsIntegrationCompleteBan(): string {
  return 'needs_integration blocks UpdateGoal(complete) — merge specialist handoffs and mark nodes done only after integration evidence.';
}

/** Shared stall ban for status=blocked WorkGraph nodes. */
export function formatBlockedNodeStallBan(): string {
  return 'Blocked nodes stall progress — resolve dependsOn, re-queue, or cancel only after deliberate scope drop.';
}

/** Shared UpdateGoal(complete) ban while WorkGraph nodes remain incomplete. */
export function formatIncompleteNodeCompleteBan(): string {
  return 'Do not call UpdateGoal(complete) until every AC node is done with verification.';
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
  // Per-node category hints so every failed node (up to the cap) carries its
  // own repair guidance, not just the first two — the old `slice(0, 2)` cap
  // silently dropped hints for nodes 3..N even though their id was listed.
  const failedAnalysis = analyzeFailedNodes(workGraph);
  const hintById = new Map(
    failedAnalysis.map(({ node, category, guidance }) => [node.id, { category, guidance }]),
  );
  const head = nodes.slice(0, 3).map((node) => {
    const id = node.id;
    const hint = hintById.get(id);
    if (hint === undefined) return id;
    return `${id}[${hint.category}]: ${hint.guidance}`;
  });
  const overflow = nodes.length > 3 ? `, … +${String(nodes.length - 3)} more` : '';
  const hasAnyHint = head.some((entry) => entry.includes('['));
  return [
    `Repair failed WorkGraph node(s) first: ${head.join(' | ')}${overflow} — ${
      hasAnyHint
        ? 'match the per-node category to its repair step.'
        : 'failed status blocks goal complete.'
    }`,
    formatFailedNodeCompleteBan(),
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
      .join(', ')}${nodes.length > 3 ? `, … +${String(nodes.length - 3)} more` : ''} — needs_integration blocks goal complete.`,
    formatNeedsIntegrationCompleteBan(),
  ];
}

/** Match recovery-triangle blocked-node next_actions (id + title + dependsOn). */
export function formatBlockedNodeNextActions(nodes: readonly WorkGraphNode[]): readonly string[] {
  if (nodes.length === 0) return [];
  const depHints = nodes
    .slice(0, 3)
    .map((node) => {
      const deps = node.dependsOn?.filter((id) => id.length > 0) ?? [];
      if (deps.length === 0) return `${node.id} (${node.title})`;
      const head = deps.slice(0, 3).join(', ');
      const overflow = deps.length > 3 ? `, … +${String(deps.length - 3)} more` : '';
      return `${node.id} (${node.title}; dependsOn: ${head}${overflow})`;
    })
    .join(', ');
  return [
    `Unblock WorkGraph node(s) first: ${depHints}${nodes.length > 3 ? `, … +${String(nodes.length - 3)} more` : ''} — resolve dependencies or re-queue before more product edits.`,
    formatBlockedNodeStallBan(),
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
      .join(', ')}${nodes.length > 3 ? `, … +${String(nodes.length - 3)} more` : ''} — running without owner stalls progress.`,
    'Running without owner stalls progress — assign ownerExpertId/ownerAgentId or re-queue.',
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
      return `${node.id} (${node.title}; dependsOn: ${deps.slice(0, 3).join(', ')}${deps.length > 3 ? `, … +${String(deps.length - 3)} more` : ''})`;
    })
    .join(', ');
  return [
    `Queued node(s) waiting on dependsOn: ${waitHints}${nodes.length > 3 ? `, … +${String(nodes.length - 3)} more` : ''} — finish or cancel deps before forcing progress.`,
    'Queued dependsOn waits stall progress — finish or cancel deps before forcing progress.',
  ];
}

/** Match recovery-triangle owned stuck-node next_actions (id + status). */
export function formatStuckNodeNextActions(nodes: readonly WorkGraphNode[]): readonly string[] {
  if (nodes.length === 0) return [];
  return [
    `Circuit-break stuck WorkGraph node(s): ${nodes
      .slice(0, 3)
      .map((node) => `${node.id}[${node.status}]`)
      .join(', ')}${nodes.length > 3 ? `, … +${String(nodes.length - 3)} more` : ''} — re-queue, verify active owner progress, or mark failed if unrecoverable.`,
    'Consider: re-queue blocked nodes, verify running nodes have active owners, or mark failed if unrecoverable.',
  ];
}

/**
 * Generic incomplete-node next_actions shared by completion-audit (and any
 * recovery surface that needs the same finish guidance after stall-specific hints).
 */
export function formatIncompleteNodeNextActions(): readonly string[] {
  return [
    'Finish or re-open incomplete nodes with real evidence.',
    formatIncompleteNodeCompleteBan(),
    'If blocked on evidence, run tests/checks and attach paths in evidenceIds.',
  ];
}
