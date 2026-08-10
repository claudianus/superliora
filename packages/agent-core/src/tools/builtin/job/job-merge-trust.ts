/**
 * MergeJob trust rules (Conductor locked policy).
 * Meta may auto-approve only when small ∧ no conflict ∧ checks green ∧ non-dangerous paths.
 * Green tests alone never suffice. UI-path Jobs also require visual=passed (hard reject).
 */

import {
  verificationIsGreen,
  verificationVisualBlocksMerge,
} from '../../../session/subagent/subagent-result-contract';
import { evaluateVerifyChainForMerge } from './job-verify-chain';
import type { JobRecord } from './job-store-key';

export interface MergeTrustInput {
  readonly approve: boolean;
  /** Diff line count or approximate size; small threshold default 200. */
  readonly diffLines?: number;
  readonly hasConflict?: boolean;
  readonly checksGreen?: boolean;
  /** Paths touched by the job (ownership + result). */
  readonly paths?: readonly string[];
  /** User/meta already reviewed summary (required for auto path). */
  readonly hasSummary?: boolean;
  /** Force user confirmation regardless of heuristics. */
  readonly forceUserConfirm?: boolean;
  readonly smallDiffMaxLines?: number;
  /**
   * UI-path Jobs without VerifySurface pass — hard reject (not hold).
   * `force_user_confirm` cannot bypass this gate.
   */
  readonly visualProofMissing?: boolean;
  readonly visualVerdict?: string;
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

const DEFAULT_SMALL_DIFF = 200;
/** A change spanning more files than this is not small, whatever the line claim says. */
const DEFAULT_SMALL_FILES = 20;

/** Paths that always require user confirmation for land-to-main. */
export const MERGE_DANGEROUS_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)secrets?\//i,
  /(^|\/)\.ssh\//i,
  /(^|\/)id_rsa/i,
  /(^|\/)credentials?\./i,
  /(^|\/)auth\.json$/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)flake\.nix$/i,
  /(^|\/)\.github\/workflows\//i,
];

export function pathIsDangerousForMerge(path: string): boolean {
  const p = path.trim();
  if (p.length === 0) return false;
  return MERGE_DANGEROUS_PATH_PATTERNS.some((re) => re.test(p));
}

export function evaluateMergeTrust(input: MergeTrustInput): MergeTrustVerdict {
  if (!input.approve) {
    return { ok: false, mode: 'hold', reason: 'approve=false' };
  }
  // Visual proof is a hard reject — force_user_confirm cannot bypass it.
  if (input.visualProofMissing === true) {
    const verdict = input.visualVerdict ?? 'not_run';
    return {
      ok: false,
      mode: 'reject',
      reason:
        `UI paths changed without VerifySurface pass (visual=${verdict}). ` +
        'Re-run the worker and call VerifySurface on the real surface (load+interaction+craft axes); BrowserScreenshot alone does not satisfy visual proof. ' +
        'force_user_confirm cannot bypass this gate. If browser-use is missing, run `liora browser-use doctor`.',
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
  const dangerous = paths.filter(pathIsDangerousForMerge);
  if (dangerous.length > 0 && !waiveConfirm) {
    return {
      ok: false,
      mode: 'hold',
      reason: `Dangerous paths require user confirm: ${dangerous.slice(0, 5).join(', ')}`,
    };
  }
  const max = input.smallDiffMaxLines ?? DEFAULT_SMALL_DIFF;
  const lines = input.diffLines ?? Number.POSITIVE_INFINITY;
  if (lines > max && !waiveConfirm) {
    return {
      ok: false,
      mode: 'hold',
      reason: `Diff too large (${lines} lines > ${max}) — user confirm required.`,
    };
  }
  // The line count is self-reported; the file list is not. A wide change can
  // never read as small, however few lines the caller claims it touched.
  if (paths.length > DEFAULT_SMALL_FILES && !waiveConfirm) {
    return {
      ok: false,
      mode: 'hold',
      reason: `Change spans ${paths.length} files (> ${DEFAULT_SMALL_FILES}) — user confirm required.`,
    };
  }
  if (input.hasSummary !== true) {
    return {
      ok: false,
      mode: 'hold',
      reason: 'Diff summary required before meta auto-approve.',
    };
  }
  if (waiveConfirm && (dangerous.length > 0 || lines > max || paths.length > DEFAULT_SMALL_FILES)) {
    return {
      ok: true,
      mode: 'auto',
      reason:
        'Auto permission waived user-confirm holds (size/danger/span); conflict/checks/summary/visual still enforced.',
    };
  }
  return {
    ok: true,
    mode: 'auto',
    reason: `Trust rules passed: small (≤${max}), no conflict, checks green, non-dangerous paths, summary present.`,
  };
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
 * `has_conflict` can be raised but never cleared, and claimed paths union with
 * the files the worker really touched. Diff size has no ledger witness, so the
 * claim stands there; an absent claim still reads as too large, and the file
 * count from the contract caps "small" independently.
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
  const filesChanged = contract?.files_changed ?? [];
  // Visual proof keys off files actually changed — ownership/claim path unions
  // must not invent a UI surface the diff never touched.
  const visualBlocks = verificationVisualBlocksMerge(contract?.verification, filesChanged);
  const verifyGate =
    input.jobs === undefined
      ? { ok: true as const }
      : evaluateVerifyChainForMerge({ job, jobs: input.jobs });
  return {
    approve: claim.approve,
    checksGreen: verificationIsGreen(contract?.verification) && claim.checksGreen !== false,
    hasConflict: claim.hasConflict === true,
    paths,
    ...(claim.diffLines === undefined ? {} : { diffLines: claim.diffLines }),
    hasSummary: Boolean(claim.summary?.trim() ?? '') || Boolean(job.resultSummary?.trim() ?? ''),
    forceUserConfirm: claim.forceUserConfirm === true,
    visualProofMissing: visualBlocks,
    visualVerdict: contract?.verification?.visual ?? 'not_run',
    reviewChainBlocked: verifyGate.ok === false,
    ...(verifyGate.ok === false ? { reviewChainReason: verifyGate.reason } : {}),
  };
}
