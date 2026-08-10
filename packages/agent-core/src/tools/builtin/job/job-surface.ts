/**
 * Conductor-declared surface contract for Jobs.
 * Merge/verify gates key off this field — not path/keyword regex.
 */

import type { SubagentResultContract } from '../../../session/subagent/subagent-result-contract';
import type { JobSurfaceKind } from './job-store-key';

export type { JobSurfaceKind };

export const JOB_SURFACE_KINDS = ['none', 'web', 'tui', 'mixed'] as const;

export function isJobSurfaceKind(value: unknown): value is JobSurfaceKind {
  return (
    typeof value === 'string' &&
    (JOB_SURFACE_KINDS as readonly string[]).includes(value)
  );
}

/** Surfaces that need a visual proof slot before MergeJob. */
export function surfaceRequiresVisualProof(
  surfaceKind: JobSurfaceKind | undefined,
): boolean {
  return surfaceKind === 'web' || surfaceKind === 'tui' || surfaceKind === 'mixed';
}

/** Web VerifySurface axes (interaction/craft) apply. */
export function surfaceRequiresWebAxes(
  surfaceKind: JobSurfaceKind | undefined,
): boolean {
  return surfaceKind === 'web' || surfaceKind === 'mixed';
}

/**
 * True when the contract's visual slots fail the surfaceKind proof rules.
 * Missing surfaceKind does not invent a UI gate here — callers hold separately.
 */
export function verificationVisualBlocksMergeForSurface(
  verification: SubagentResultContract['verification'] | undefined,
  surfaceKind: JobSurfaceKind | undefined,
): boolean {
  if (!surfaceRequiresVisualProof(surfaceKind)) return false;
  if (verification?.visual !== 'passed') return true;
  if (surfaceRequiresWebAxes(surfaceKind)) {
    if (verification.interaction !== undefined && verification.interaction !== 'passed') {
      return true;
    }
    if (verification.craft !== undefined && verification.craft !== 'passed') {
      return true;
    }
  }
  return false;
}

/** Human-readable MergeJob reject reason for a failed visual proof. */
export function visualProofRejectReason(
  surfaceKind: JobSurfaceKind | undefined,
  visualVerdict: string,
): string {
  if (surfaceKind === 'tui') {
    return (
      `TUI surface without visual proof (visual=${visualVerdict}). ` +
      'Re-run the worker and land `pnpm -C apps/liora run smoke:visual` (or equivalent TUI visual smoke) before done; ' +
      'VerifySurface is N/A for ANSI/TUI. force_user_confirm cannot bypass this gate.'
    );
  }
  if (surfaceKind === 'mixed') {
    return (
      `Mixed web+TUI surface without visual proof (visual=${visualVerdict}). ` +
      'Need VerifySurface pass (web) and TUI smoke pass; BrowserScreenshot alone is not enough. ' +
      'force_user_confirm cannot bypass this gate.'
    );
  }
  return (
    `Web surface without VerifySurface pass (visual=${visualVerdict}). ` +
    'Re-run the worker and call VerifySurface on the real surface (load+interaction+craft axes); BrowserScreenshot alone does not satisfy visual proof. ' +
    'force_user_confirm cannot bypass this gate. If browser-use is missing, run `liora browser-use doctor`.'
  );
}

/**
 * Remap a completion contract's visual slots to honor the Job surfaceKind.
 * Clears path-heuristic not_run noise for none/tui when ledger already proved smoke.
 */
export function applySurfaceKindToContract(
  contract: SubagentResultContract,
  surfaceKind: JobSurfaceKind | undefined,
  options?: {
    readonly ledgerVisual?: 'passed' | 'failed' | 'not_run' | undefined;
  },
): SubagentResultContract {
  if (surfaceKind === undefined) return contract;
  const v = contract.verification;
  if (surfaceKind === 'none') {
    const verification = {
      ...v,
      visual: 'not_applicable' as const,
      interaction: 'not_applicable' as const,
      craft: 'not_applicable' as const,
    };
    return {
      ...contract,
      verification,
      verification_failed:
        verification.tests === 'failed' ||
        verification.typecheck === 'failed' ||
        verification.lint === 'failed',
    };
  }
  if (surfaceKind === 'tui') {
    const ledgerPass = options?.ledgerVisual === 'passed';
    const visual =
      v.visual === 'passed' || ledgerPass
        ? ('passed' as const)
        : v.visual === 'failed' || options?.ledgerVisual === 'failed'
          ? ('failed' as const)
          : v.visual === 'not_applicable'
            ? ('not_run' as const)
            : (v.visual ?? 'not_run');
    const verification = {
      ...v,
      visual,
      interaction: 'not_applicable' as const,
      craft: 'not_applicable' as const,
    };
    return {
      ...contract,
      verification,
      verification_failed:
        verification.tests === 'failed' ||
        verification.typecheck === 'failed' ||
        verification.lint === 'failed' ||
        verification.visual === 'failed',
    };
  }
  // web / mixed — keep VerifySurface axes from the completion gate.
  return contract;
}
