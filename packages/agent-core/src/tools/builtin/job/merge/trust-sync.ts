/**
 * MergeJob trust rules (Conductor locked policy).
 * Meta may auto-approve only when small ∧ no conflict ∧ checks green ∧ non-dangerous paths.
 * Green tests alone never suffice. SurfaceKind contracts require matching visual proof.
 *
 * H6 phase 2: "is this risky / too wide" is an LLM judgment (or a project
 * declaration); the harness keeps merge execution, conflict detection, file
 * writes, checksums, exit codes and path normalization. When neither a
 * declaration nor a judgment exists the verdict is recorded as
 * `판정 불가` and holds — never a silent pass.
 */

import type { LlmClassifierDeps } from '../../../../utils/llm-classifier-utils';

import { visualProofRejectReason } from '../job-surface';
import {
  declaredSensitivePaths,
  type MergeRiskAssessment,
  type MergeRiskJudgment,
} from './risk-infer';
import type { JobSurfaceKind } from '../job-store-key';

export interface MergeTrustInput {
  readonly approve: boolean;
  /** Diff line count or approximate size. Judged, not thresholded. */
  readonly diffLines?: number;
  readonly hasConflict?: boolean;
  readonly checksGreen?: boolean;
  /** Paths touched by the job (ownership + result). */
  readonly paths?: readonly string[];
  /** User/meta already reviewed summary (required for auto path). */
  readonly hasSummary?: boolean;
  /** Force user confirmation regardless of heuristics. */
  readonly forceUserConfirm?: boolean;
  /**
   * Project/operator declared sensitive paths. Declaration wins — matching is
   * exact against this list, never inferred from the path string.
   */
  readonly declaredDangerousPaths?: readonly string[];
  /** Project/operator declared size ceiling (lines). Declaration wins. */
  readonly declaredSmallDiffMaxLines?: number;
  /** Project/operator declared file-span ceiling. Declaration wins. */
  readonly declaredMaxFiles?: number;
  /** Resolved LLM risk judgment, or `undecidable`. Caller may pre-resolve. */
  readonly riskAssessment?: MergeRiskAssessment;
  /** LLM deps used to resolve the risk judgment when none was pre-resolved. */
  readonly riskDeps?: LlmClassifierDeps;
  readonly riskSummary?: string;
  readonly riskTitle?: string;
  readonly riskJobKind?: string;
  /**
   * SurfaceKind needs visual proof that is missing/failed — hard reject.
   * `force_user_confirm` cannot bypass this gate.
   */
  readonly visualProofMissing?: boolean;
  readonly visualVerdict?: string;
  readonly surfaceKind?: JobSurfaceKind;
  /**
   * Coding Jobs must declare surfaceKind before land — hold (Conductor patches via JobSteer).
   */
  readonly surfaceKindMissing?: boolean;
  /**
   * Implement/task jobs without a passed independent verify child — hard reject.
   * `force_user_confirm` cannot bypass (Maker≠Checker / verify chain).
   */
  readonly reviewChainBlocked?: boolean;
  readonly reviewChainReason?: string;
  /**
   * Auto permission mode: waive holds that exist only to force a human click
   * (dangerous paths / large diff / wide file span). Conflict, missing checks,
   * missing summary, and visual proof still block — autopilot is not a blind merge.
   */
  readonly waiveUserConfirmHolds?: boolean;
}

export type MergeTrustVerdict =
  | { readonly ok: true; readonly mode: 'auto' | 'user_approved'; readonly reason: string }
  | { readonly ok: false; readonly mode: 'hold' | 'reject'; readonly reason: string };

export { declaredSensitivePaths };

/**
 * Resolve the sensitive-path set: a declaration is authoritative, otherwise
 * the LLM judgment supplies the paths it actually saw.
 */
function sensitivePathsFor(input: MergeTrustInput): {
  readonly declared: readonly string[];
  readonly judged: readonly string[];
} {
  const paths = input.paths ?? [];
  const declared = declaredSensitivePaths(paths, input.declaredDangerousPaths);
  if (declared.length > 0) return { declared, judged: [] };
  const assessment = input.riskAssessment;
  if (assessment === undefined || assessment === 'undecidable') return { declared, judged: [] };
  const known = new Set(paths);
  return {
    declared,
    // The judge may only name paths it was shown — no invented paths.
    judged: assessment.sensitivePaths.filter((path) => known.has(path)),
  };
}

function formatDangerousReason(paths: readonly string[]): string {
  return `Dangerous paths require user confirm: ${paths.slice(0, 5).join(', ')}`;
}

/**
 * Synchronous, mechanical verdict over an already-resolved risk assessment.
 * Callers resolve the LLM judgment first (`resolveMergeRiskAssessment`) and
 * pass it in; a missing assessment holds as `판정 불가` rather than passing.
 */
export function evaluateMergeTrust(input: MergeTrustInput): MergeTrustVerdict {
  if (!input.approve) {
    return { ok: false, mode: 'hold', reason: 'approve=false' };
  }
  // Surface contract missing — Conductor must declare none|web|tui|mixed (hold, not reject).
  if (input.surfaceKindMissing === true) {
    return {
      ok: false,
      mode: 'hold',
      reason:
        'surface_kind missing — JobSteer(surface_kind=none|web|tui|mixed) before MergeJob; ' +
        'path/keyword heuristics must not invent a visual gate',
    };
  }
  // Visual proof is a hard reject — force_user_confirm cannot bypass it.
  if (input.visualProofMissing === true) {
    const verdict = input.visualVerdict ?? 'not_run';
    return {
      ok: false,
      mode: 'reject',
      reason: visualProofRejectReason(input.surfaceKind, verdict),
    };
  }
  // Review chain / Maker≠Checker — hard reject; force_user_confirm cannot bypass.
  if (input.reviewChainBlocked === true) {
    return {
      ok: false,
      mode: 'reject',
      reason:
        input.reviewChainReason ??
        'Review chain incomplete — wait for an independent review Job with verdict=pass before MergeJob.',
    };
  }
  // Real human override (manual / yolo click). Auto permission must not launder
  // AskUserQuestion auto-picks into this short-circuit — callers clear
  // forceUserConfirm when waiveUserConfirmHolds is set.
  if (input.forceUserConfirm === true && input.waiveUserConfirmHolds !== true) {
    return {
      ok: true,
      mode: 'user_approved',
      reason: 'User confirmed land-to-main (forced confirm).',
    };
  }
  if (input.hasConflict === true) {
    return { ok: false, mode: 'hold', reason: 'Conflict present — user must resolve and re-approve.' };
  }
  if (input.checksGreen !== true) {
    return {
      ok: false,
      mode: 'hold',
      reason: 'Checks not green — never merge on green alone; green is required but not sufficient.',
    };
  }
  const paths = input.paths ?? [];
  const waiveConfirm = input.waiveUserConfirmHolds === true;
  // H6-2: risk is judged, not thresholded. Declaration wins; then the LLM
  // judgment handed in by the caller. Nothing resolved → 판정 불가 (hold).
  const declared = declaredSensitivePaths(paths, input.declaredDangerousPaths);
  const hasDeclaration =
    (input.declaredDangerousPaths?.length ?? 0) > 0 || input.declaredSmallDiffMaxLines !== undefined || input.declaredMaxFiles !== undefined;
  const assessment: MergeRiskAssessment | undefined =
    input.riskAssessment ??
    (hasDeclaration
      ? {
          risky: declared.length > 0,
          sensitivePaths: declared,
          wideChange: false,
          confidence: 1,
          rationale: 'declared by project/operator',
        }
      : undefined);
  const undecidable = assessment === undefined || assessment === 'undecidable';
  const judgment = undecidable ? undefined : (assessment as MergeRiskJudgment);
  const sensitive = sensitivePathsFor({ ...input, riskAssessment: assessment });
  const dangerous = [...sensitive.declared, ...sensitive.judged];
  const riskNotes: string[] = [];
  if (judgment === undefined) {
    riskNotes.push('risk judgment unavailable (판정 불가)');
  } else {
    if (judgment.risky) riskNotes.push(`judged risky — ${judgment.rationale}`);
    if (judgment.wideChange) riskNotes.push(`judged too wide — ${judgment.rationale}`);
  }
  if (dangerous.length > 0 && !waiveConfirm) {
    return { ok: false, mode: 'hold', reason: formatDangerousReason(dangerous) };
  }
  // Declared ceilings only — the harness never invents a number.
  const declaredMax = input.declaredSmallDiffMaxLines;
  const declaredFiles = input.declaredMaxFiles;
  const lines = input.diffLines;
  if (
    declaredMax !== undefined &&
    lines !== undefined &&
    lines > declaredMax &&
    !waiveConfirm
  ) {
    return {
      ok: false,
      mode: 'hold',
      reason: `Diff too large (${lines} lines > declared ${declaredMax}) — user confirm required.`,
    };
  }
  if (declaredFiles !== undefined && paths.length > declaredFiles && !waiveConfirm) {
    return {
      ok: false,
      mode: 'hold',
      reason: `Change spans ${paths.length} files (> declared ${declaredFiles}) — user confirm required.`,
    };
  }
  if (judgment !== undefined && judgment.risky && !waiveConfirm) {
    return {
      ok: false,
      mode: 'hold',
      reason: `Risk judgment: change is risky — ${judgment.rationale}`,
    };
  }
  if (judgment !== undefined && judgment.wideChange && !waiveConfirm) {
    return {
      ok: false,
      mode: 'hold',
      reason: `Risk judgment: change is too wide to land unattended — ${judgment.rationale}`,
    };
  }
  if (input.hasSummary !== true) {
    return {
      ok: false,
      mode: 'hold',
      reason: 'Diff summary required before meta auto-approve.',
    };
  }
  if (waiveConfirm && (undecidable || riskNotes.length > 0 || dangerous.length > 0)) {
    return {
      ok: true,
      mode: 'auto',
      reason:
        'Auto permission waived user-confirm holds (size/danger/span/risk); ' +
        `conflict/checks/summary/visual still enforced. Recorded: ${riskNotes.join('; ') || 'none'}`,
    };
  }
  if (undecidable) {
    return {
      ok: false,
      mode: 'hold',
      reason:
        'Risk judgment unavailable (판정 불가) — user confirm required before land. ' +
        'Declare the change risk (merge risk judgment) or confirm explicitly.',
    };
  }
  return {
    ok: true,
    mode: 'auto',
    reason: `Trust rules passed: ${assessment.rationale}; no conflict, checks green, no sensitive paths, summary present.`,
  };
}
