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

import type { LlmClassifierDeps } from '../../../utils/llm-classifier-utils';

import {
  verificationHasFailure,
  verificationIsGreen,
} from '../../../session/subagent/subagent-result-contract';
import {
  verificationVisualBlocksMergeForSurface,
  visualProofRejectReason,
} from './job-surface';
import { evaluateVerifyChainForMerge } from './job-verify-chain';
import {
  assessmentFromJudgment,
  declaredSensitivePaths,
  resolveMergeRiskAssessment,
  type MergeRiskAssessment,
  type MergeRiskJudgment,
} from './job-merge-risk-infer';
import type { JobRecord, JobSurfaceKind } from './job-store-key';

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
export function evaluateMergeTrust(input: MergeTrustInput): MergeTrustVerdict {  if (!input.approve) {
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

/**
 * Map a conductor-supplied `risk_judgment` (LLM output) onto the harness
 * assessment type. A below-floor confidence is not a judgment — it becomes
 * `undecidable`, which holds instead of passing.
 */
export function mergeRiskAssessmentFromClaim(
  claim:
    | {
        readonly risky: boolean;
        readonly sensitive_paths: readonly string[];
        readonly wide_change: boolean;
        readonly confidence: number;
        readonly rationale: string;
      }
    | undefined,
): MergeRiskAssessment | undefined {
  if (claim === undefined) return undefined;
  return assessmentFromJudgment({
    risky: claim.risky,
    sensitivePaths: [...claim.sensitive_paths],
    wideChange: claim.wide_change,
    confidence: claim.confidence,
    rationale: claim.rationale,
  });
}

/**
 * Resolve the LLM risk judgment first, then apply the mechanical verdict.
 * Use when the caller has a live provider and no ACK deadline (off-turn or
 * background lanes). The interactive MergeJob tool uses the claim instead.
 */
export async function evaluateMergeTrustAsync(
  input: MergeTrustInput,
  options?: { readonly signal?: AbortSignal },
): Promise<MergeTrustVerdict> {
  if (input.riskAssessment !== undefined) return evaluateMergeTrust(input);
  const paths = input.paths ?? [];
  const hasDeclaration =
    (input.declaredDangerousPaths?.length ?? 0) > 0 ||
    input.declaredSmallDiffMaxLines !== undefined ||
    input.declaredMaxFiles !== undefined;
  if (hasDeclaration) return evaluateMergeTrust(input);
  const assessment = await resolveMergeRiskAssessment({
    judge: {
      paths,
      ...(input.diffLines === undefined ? {} : { diffLines: input.diffLines }),
      ...(input.riskSummary === undefined ? {} : { summary: input.riskSummary }),
      ...(input.riskTitle === undefined ? {} : { title: input.riskTitle }),
      ...(input.riskJobKind === undefined ? {} : { jobKind: input.riskJobKind }),
    },
    ...(input.declaredDangerousPaths === undefined
      ? {}
      : { declaredDangerousPaths: input.declaredDangerousPaths }),
    deps: input.riskDeps,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });
  return evaluateMergeTrust({ ...input, riskAssessment: assessment });
}

/** What the conductor claims about a merge, straight off the tool arguments. */
export interface MergeTrustClaim {
  readonly approve: boolean;
  readonly diffLines?: number;
  readonly hasConflict?: boolean;
  readonly checksGreen?: boolean;
  readonly paths?: readonly string[];
  readonly summary?: string;
  readonly forceUserConfirm?: boolean;
}

/**
 * Ground the verdict in what the worker actually produced, and let the
 * conductor's claim make it stricter only. `checks_green` can be withdrawn
 * but never granted — the ledger's verification contract is the sole witness.
 * Visual proof keys off Job.surfaceKind — never path regex inventing UI.
 */
export function mergeTrustInputFromLedger(input: {
  readonly job: JobRecord;
  readonly claim: MergeTrustClaim;
  readonly jobs?: readonly JobRecord[];
}): MergeTrustInput {
  const { job, claim } = input;
  const contract = job.resultContract;
  const paths = [
    ...new Set([
      ...(contract?.files_changed ?? []),
      ...(job.ownershipPaths ?? []),
      ...(claim.paths ?? []),
    ]),
  ];
  // Mission / plan / non-coding deliveries never require visual proof or a verify chain.
  // Only task/implement coding land can hold on surfaceKind / Maker≠Checker.
  const codingKind = job.kind === 'task' || job.kind === 'implement';
  const surfaceKindMissing = codingKind && job.surfaceKind === undefined;
  const visualBlocks =
    codingKind &&
    verificationVisualBlocksMergeForSurface(contract?.verification, job.surfaceKind);
  const verifyGate =
    !codingKind || input.jobs === undefined
      ? { ok: true as const }
      : evaluateVerifyChainForMerge({ job, jobs: input.jobs });
  // Root/greenfield packages often leave tests/lint as not_run when the
  // completion gate skipped; a passed Maker≠Checker verify is the witness.
  // Mission / non-coding plan deliveries never run the product test suite —
  // trust the conductor claim when no verification failure is stamped.
  const checksGreenFromLedger = verificationIsGreen(contract?.verification);
  const hasVerifyChildren =
    input.jobs?.some((child) => child.parentJobId === job.id && child.kind === 'verify') ===
    true;
  const checksGreenFromVerify =
    codingKind &&
    hasVerifyChildren &&
    verifyGate.ok &&
    !verificationHasFailure(contract?.verification) &&
    (input.jobs?.every(
      (child) =>
        child.parentJobId !== job.id ||
        child.kind !== 'verify' ||
        !verificationHasFailure(child.resultContract?.verification),
    ) ??
      false);
  // Mission visual is often not_run/failed after ExitPlanMode (no UI surface).
  // Only tests/typecheck/lint failures can withdraw the conductor claim.
  const missionVerification = contract?.verification;
  const missionProductChecksFailed =
    missionVerification !== undefined &&
    (missionVerification.tests === 'failed' ||
      missionVerification.typecheck === 'failed' ||
      missionVerification.lint === 'failed');
  // Only explicit non-coding kinds may use the mission green path. A missing
  // kind (partial ledger fixtures) must not launder claim.checksGreen=true.
  const checksGreenFromMission =
    job.kind !== undefined &&
    !codingKind &&
    claim.checksGreen !== false &&
    !missionProductChecksFailed;
  return {
    approve: claim.approve,
    checksGreen:
      claim.checksGreen !== false &&
      (checksGreenFromLedger || checksGreenFromVerify || checksGreenFromMission),
    hasConflict: claim.hasConflict === true,
    paths,
    ...(claim.diffLines === undefined ? {} : { diffLines: claim.diffLines }),
    hasSummary: Boolean(claim.summary?.trim() ?? '') || Boolean(job.resultSummary?.trim() ?? ''),
    forceUserConfirm: claim.forceUserConfirm === true,
    surfaceKindMissing,
    surfaceKind: job.surfaceKind,
    // Mission never visual-blocks; coding only when surfaceKind requires proof.
    visualProofMissing: codingKind && !surfaceKindMissing && Boolean(visualBlocks),
    visualVerdict: contract?.verification?.visual ?? 'not_run',
    reviewChainBlocked: codingKind && verifyGate.ok === false,
    ...(codingKind && verifyGate.ok === false
      ? { reviewChainReason: verifyGate.reason }
      : {}),
  };
}
