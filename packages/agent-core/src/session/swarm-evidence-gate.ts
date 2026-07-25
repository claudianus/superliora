/**
 * Evidence hard gate for WorkGraph done transitions.
 *
 * A node with requiredEvidence cannot move to `done` without evidenceIds.
 * Soft rule (phase 1): requiredEvidence present + empty/missing evidenceIds → blocked.
 */

import type { WorkGraphNode } from '@superliora/protocol';

export type EvidenceGateNode = Pick<
  WorkGraphNode,
  'id' | 'status' | 'requiredEvidence' | 'evidenceIds' | 'verificationSummary'
>;

export type EvidenceGateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly nodeId: string;
      readonly reason: string;
      /** Suggested status when auto-correcting instead of rejecting. */
      readonly suggestedStatus: 'blocked';
    };

/**
 * Validate a single node that claims status `done`.
 * Returns ok when no requiredEvidence, or when evidenceIds is non-empty.
 */
export function evaluateEvidenceHardGate(node: EvidenceGateNode): EvidenceGateResult {
  if (node.status !== 'done') return { ok: true };

  const required = (node.requiredEvidence ?? []).map((value) => value.trim()).filter((v) => v.length > 0);
  if (required.length === 0) return { ok: true };

  const evidence = (node.evidenceIds ?? []).map((value) => value.trim()).filter((v) => v.length > 0);
  if (evidence.length === 0) {
    return {
      ok: false,
      nodeId: node.id,
      reason:
        `WorkGraph node ${node.id} cannot be done: requiredEvidence ` +
        `[${required.join(', ')}] is set but evidenceIds is empty or missing.`,
      suggestedStatus: 'blocked',
    };
  }

  return { ok: true };
}

/**
 * Scan a full node list; returns the first failing gate reason, or undefined.
 */
export function findEvidenceHardGateViolation(
  nodes: readonly EvidenceGateNode[],
): EvidenceGateResult & { ok: false } | undefined {
  for (const node of nodes) {
    const result = evaluateEvidenceHardGate(node);
    if (!result.ok) return result;
  }
  return undefined;
}

/**
 * Apply hard gate: done nodes that fail become blocked with a clear summary.
 * Returns { graphNodes, violations } — pure, does not mutate input.
 */
export function applyEvidenceHardGate(
  nodes: readonly WorkGraphNode[],
): {
  readonly nodes: readonly WorkGraphNode[];
  readonly violations: readonly (EvidenceGateResult & { ok: false })[];
} {
  const violations: (EvidenceGateResult & { ok: false })[] = [];
  const next = nodes.map((node) => {
    const result = evaluateEvidenceHardGate(node);
    if (result.ok) return node;
    violations.push(result);
    return {
      ...node,
      status: result.suggestedStatus,
      verificationStatus: 'blocked' as const,
      verificationSummary: result.reason,
    };
  });
  return { nodes: next, violations };
}
