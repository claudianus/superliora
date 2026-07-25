/**
 * Structured GoalPredicate — machine-checkable completion specs embedded in
 * completionCriterion text (JSON fence or predicate:v1: prefix).
 *
 * Legacy free-text criteria return null from parse (no runner required).
 */

export const GOAL_PREDICATE_VERSION = 1 as const;

export interface GoalPredicateSpec {
  readonly version: typeof GOAL_PREDICATE_VERSION;
  /** Workspace-relative or absolute paths that must exist. */
  readonly requiredPaths?: readonly string[];
  /**
   * Vitest test file paths (workspace-relative) to run via whitelist runner.
   * Example: `packages/agent-core/test/ultrawork/completion-audit.test.ts`
   */
  readonly requiredTestFiles?: readonly string[];
  /** Minimum number of evidenceIds across WorkGraph done nodes (optional). */
  readonly minEvidenceIds?: number;
  /** When true (default if Ultrawork live), require UW completion audit. */
  readonly requireUltraworkGraph?: boolean;
}

export type GoalPredicateParseResult =
  | { readonly kind: 'structured'; readonly spec: GoalPredicateSpec }
  | { readonly kind: 'legacy'; readonly text: string }
  | { readonly kind: 'empty' };

const FENCE_RE = /```(?:goal-predicate|json)\s*([\s\S]*?)```/i;
const PREFIX_RE = /^\s*predicate:v1:\s*(\{[\s\S]*\})\s*$/i;

export function parseGoalPredicateCriterion(
  completionCriterion: string | undefined,
): GoalPredicateParseResult {
  if (completionCriterion === undefined) return { kind: 'empty' };
  const trimmed = completionCriterion.trim();
  if (trimmed.length === 0) return { kind: 'empty' };

  const fence = FENCE_RE.exec(trimmed);
  if (fence?.[1] !== undefined) {
    const spec = tryParseSpec(fence[1]);
    if (spec !== null) return { kind: 'structured', spec };
  }

  const prefix = PREFIX_RE.exec(trimmed);
  if (prefix?.[1] !== undefined) {
    const spec = tryParseSpec(prefix[1]);
    if (spec !== null) return { kind: 'structured', spec };
  }

  // Whole string is JSON object
  if (trimmed.startsWith('{')) {
    const spec = tryParseSpec(trimmed);
    if (spec !== null) return { kind: 'structured', spec };
  }

  return { kind: 'legacy', text: trimmed };
}

function tryParseSpec(raw: string): GoalPredicateSpec | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const obj = value as Record<string, unknown>;
    const version = obj['version'];
    if (version !== 1 && version !== '1') return null;

    const requiredPaths = asStringArray(obj['requiredPaths']);
    const requiredTestFiles = asStringArray(obj['requiredTestFiles']);
    const minEvidenceIdsRaw = obj['minEvidenceIds'];
    const minEvidenceIds =
      typeof minEvidenceIdsRaw === 'number' && Number.isFinite(minEvidenceIdsRaw)
        ? Math.max(0, Math.floor(minEvidenceIdsRaw))
        : undefined;
    const requireUltraworkGraphRaw = obj['requireUltraworkGraph'];
    const requireUltraworkGraph =
      typeof requireUltraworkGraphRaw === 'boolean' ? requireUltraworkGraphRaw : undefined;

    return {
      version: 1,
      requiredPaths,
      requiredTestFiles,
      minEvidenceIds,
      requireUltraworkGraph,
    };
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return out.length > 0 ? out : undefined;
}

export type GoalPredicateFailureCode =
  | 'missing_path'
  | 'test_failed'
  | 'min_evidence'
  | 'ultrawork_audit'
  | 'runner_error';

export interface GoalPredicateFailure {
  readonly code: GoalPredicateFailureCode;
  readonly message: string;
}

export interface GoalPredicateEvalResult {
  readonly ok: boolean;
  readonly failures: readonly GoalPredicateFailure[];
}
