/**
 * Evidence hard gate for WorkGraph done transitions.
 *
 * Rules:
 * - requiredEvidence empty/missing → allow `done` (no gate).
 * - requiredEvidence present + empty/missing evidenceIds → block.
 * - When a requiredEvidence token looks like a check/tool signal
 *   (`RunProjectChecks`, `VerifySurface`, `screenshot`, `test`, …),
 *   require best-effort string match against evidenceIds **or**
 *   verificationSummary (tool-run metadata). Non-check tokens only need
 *   non-empty evidenceIds (phase-1 soft presence rule).
 *
 * Matching is intentional best-effort (normalize + substring), not a
 * formal evidence registry — keeps the gate useful without forcing
 * callers to mint canonical evidence ids.
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
      /** Check-like required tokens that lacked matching evidence. */
      readonly unmatchedCheckTokens?: readonly string[];
    };

/**
 * Check-like requiredEvidence tokens that must match evidence ids/titles
 * or verification metadata when marking a node done.
 *
 * Extend carefully: short tokens like `test` are matched after normalize
 * (alnum lower) against evidence strings, so over-broad tokens will block
 * more aggressively.
 */
export const CHECK_LIKE_EVIDENCE_TOKENS = [
  'RunProjectChecks',
  'VerifySurface',
  'screenshot',
  'test',
  /** Vitest / package test file paths as requiredEvidence tokens. */
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  'vitest',
  'smoke',
] as const;

/**
 * Validate a single node that claims status `done`.
 * Returns ok when no requiredEvidence, or when evidence requirements pass.
 */
export function evaluateEvidenceHardGate(node: EvidenceGateNode): EvidenceGateResult {
  if (node.status !== 'done') return { ok: true };

  const required = (node.requiredEvidence ?? [])
    .map((value) => value.trim())
    .filter((v) => v.length > 0);
  if (required.length === 0) return { ok: true };

  const evidence = (node.evidenceIds ?? [])
    .map((value) => value.trim())
    .filter((v) => v.length > 0);
  const verificationSummary = node.verificationSummary?.trim() ?? '';

  if (evidence.length === 0 && verificationSummary.length === 0) {
    return {
      ok: false,
      nodeId: node.id,
      reason:
        `WorkGraph node ${node.id} cannot be done: requiredEvidence ` +
        `[${required.join(', ')}] is set but evidenceIds is empty or missing.`,
      suggestedStatus: 'blocked',
    };
  }

  // Check-like tokens need a best-effort match in evidenceIds or summary.
  const haystacks = [...evidence, verificationSummary].filter((h) => h.length > 0);
  const unmatchedCheckTokens = required.filter(
    (token) => isCheckLikeEvidenceToken(token) && !evidenceMatchesToken(token, haystacks),
  );

  if (unmatchedCheckTokens.length > 0) {
    return {
      ok: false,
      nodeId: node.id,
      reason:
        `WorkGraph node ${node.id} cannot be done: required check evidence ` +
        `[${unmatchedCheckTokens.join(', ')}] has no matching evidenceIds/title ` +
        `or verificationSummary (best-effort match). Present evidence: ` +
        `[${evidence.join(', ') || 'none'}].`,
      suggestedStatus: 'blocked',
      unmatchedCheckTokens,
    };
  }

  // Non-check requiredEvidence: phase-1 presence rule (any evidence or summary).
  if (evidence.length === 0 && verificationSummary.length === 0) {
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
 * True when a requiredEvidence token is a check/tool signal that must be
 * matched, not only accompanied by arbitrary evidenceIds.
 *
 * Path-like tokens (`packages/.../foo.test.ts`, `src/x.ts`, absolute paths) are
 * treated as check-like so done nodes cannot claim file evidence without a
 * matching evidenceId / verificationSummary (AC-A4).
 */
export function isCheckLikeEvidenceToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length === 0) return false;
  if (isPathLikeEvidenceToken(trimmed)) return true;
  const normalized = normalizeEvidenceToken(trimmed);
  if (normalized.length === 0) return false;
  return CHECK_LIKE_EVIDENCE_TOKENS.some((known) => {
    const nKnown = normalizeEvidenceToken(known);
    // Bidirectional substring so "unit-test" / "RunProjectChecksTool" still hit.
    return normalized.includes(nKnown) || nKnown.includes(normalized);
  });
}

/**
 * Workspace-relative / absolute path tokens that should require a match, not
 * mere non-empty evidenceIds. Conservative heuristics — avoids treating free
 * prose as a path.
 */
export function isPathLikeEvidenceToken(token: string): boolean {
  const t = token.trim();
  if (t.length < 3) return false;
  if (t.includes('://')) return false;
  // Absolute or home-relative path
  if (t.startsWith('/') || t.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(t)) return true;
  // Explicit relative path
  if (t.startsWith('./') || t.startsWith('../')) return true;
  // Contains a path separator and a file-ish suffix or known package root
  if ((t.includes('/') || t.includes('\\')) && (
    /\.(ts|tsx|js|mjs|cjs|json|md|png|jpg|webp|log|txt)$/i.test(t) ||
    /(?:^|\/)(?:packages|apps|src|test|tests|scripts|docs)\//i.test(t) ||
    /\.(test|spec)\./i.test(t)
  )) {
    return true;
  }
  return false;
}

/**
 * Best-effort: does any evidence id/title or verification summary mention
 * the required check token?
 */
export function evidenceMatchesToken(
  token: string,
  haystacks: readonly string[],
): boolean {
  const nToken = normalizeEvidenceToken(token);
  if (nToken.length === 0) return false;
  return haystacks.some((hay) => {
    const nHay = normalizeEvidenceToken(hay);
    if (nHay.length === 0) return false;
    return nHay.includes(nToken) || nToken.includes(nHay);
  });
}

/** Lowercase + strip non-alphanumeric for loose matching. */
export function normalizeEvidenceToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Scan a full node list; returns the first failing gate reason, or undefined.
 */
export function findEvidenceHardGateViolation(
  nodes: readonly EvidenceGateNode[],
): (EvidenceGateResult & { ok: false }) | undefined {
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
export function applyEvidenceHardGate(nodes: readonly WorkGraphNode[]): {
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
