/**
 * Async / ledger MergeJob trust APIs.
 */
import type { LlmClassifierDeps } from '../../../../utils/llm-classifier-utils';
import type { JobRecord } from '../job-store-key';
import {
  resolveMergeRiskAssessment,
  assessmentFromJudgment,
  type MergeRiskAssessment,
} from './risk-infer';
import {
  evaluateMergeTrust,
  type MergeTrustInput,
  type MergeTrustVerdict,
} from './trust-sync';
import {
  verificationHasFailure,
  verificationIsGreen,
} from '../../../../session/subagent/subagent-result-contract';
import {
  verificationVisualBlocksMergeForSurface,
} from '../job-surface';
import { evaluateVerifyChainForMerge } from '../job-verify-chain';

export type { MergeTrustInput, MergeTrustVerdict } from './trust-sync';
export { evaluateMergeTrust, declaredSensitivePaths } from './trust-sync';

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
