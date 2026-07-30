import type { WorkGraphNode } from '@superliora/protocol';

import { applyEvidenceHardGate } from '../session/swarm-evidence-gate';

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
/** Shared UpdateGoal(complete) ban when evidence hard-gate remaps done → blocked. */
export function formatEvidenceHardGateCompleteBan(): string {
  return 'Do not call UpdateGoal(complete) while evidence hard gate remaps done nodes to blocked.';
}

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
    `Close evidence hard-gate on node(s): ${gateNodes.join(', ')}${violations.length > 3 ? `, … +${String(violations.length - 3)} more` : ''} — attach matching evidenceIds (and verificationSummary when useful), then set status=done only after checks.`,
    formatEvidenceHardGateCompleteBan(),
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
      .join(', ')}${nodes.length > 3 ? `, … +${String(nodes.length - 3)} more` : ''} — attach required evidence before UpdateGoal(complete).`,
    'Verification gaps block UpdateGoal(complete) — attach requiredEvidence and re-verify before finishing.',
  ];
}
