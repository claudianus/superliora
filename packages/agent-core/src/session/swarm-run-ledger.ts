/**
 * UltraSwarm run ledger — pure observation artifact for harness metrics.
 *
 * Records who ran, which phases fired, evidence ids, conflicts, and wasted
 * worker flags so success is measurable instead of "felt".
 */

import { dirname, join } from 'pathe';

import type { Kaos } from '@superliora/kaos';

export const SWARM_RUN_LEDGER_DIR = '.superliora/swarm-ledgers' as const;

export interface SwarmRunLedgerExpert {
  readonly expertId: string;
  readonly expertName?: string;
  readonly phase?: string;
  readonly status?: string;
  readonly verdict?: string;
  readonly agentId?: string;
  readonly evidenceIds?: readonly string[];
  /** True when the worker produced no usable evidence or failed/aborted. */
  readonly wasted?: boolean;
}

export interface SwarmRunLedgerTokens {
  readonly input?: number;
  readonly output?: number;
  readonly total?: number;
}

export interface SwarmRunLedgerConflict {
  readonly kind: string;
  readonly path?: string;
  readonly holderId?: string;
  readonly claimantId?: string;
  readonly message?: string;
}

export interface SwarmRunLedger {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly experts: readonly SwarmRunLedgerExpert[];
  readonly phases: readonly string[];
  readonly tokens?: SwarmRunLedgerTokens;
  readonly evidenceIds: readonly string[];
  readonly conflicts: readonly SwarmRunLedgerConflict[];
  /** Expert ids flagged as wasted workers. */
  readonly wastedWorkerFlags: readonly string[];
}

export interface CreateSwarmRunLedgerInput {
  readonly runId: string;
  readonly startedAt?: string;
  readonly experts?: readonly SwarmRunLedgerExpert[];
  readonly phases?: readonly string[];
  readonly tokens?: SwarmRunLedgerTokens;
  readonly evidenceIds?: readonly string[];
  readonly conflicts?: readonly SwarmRunLedgerConflict[];
  readonly wastedWorkerFlags?: readonly string[];
}

export interface FinalizeSwarmRunLedgerPatch {
  readonly finishedAt?: string;
  readonly experts?: readonly SwarmRunLedgerExpert[];
  readonly phases?: readonly string[];
  readonly tokens?: SwarmRunLedgerTokens;
  readonly evidenceIds?: readonly string[];
  readonly conflicts?: readonly SwarmRunLedgerConflict[];
  readonly wastedWorkerFlags?: readonly string[];
}

export interface SwarmRunLedgerResultLike {
  readonly status: string;
  readonly verdict?: string;
  readonly agentId?: string;
  readonly evidenceIds?: readonly string[];
  readonly spec: {
    readonly expertId: string;
    readonly expertName?: string;
    readonly phase?: string;
  };
}

export function createSwarmRunLedger(input: CreateSwarmRunLedgerInput): SwarmRunLedger {
  const experts = input.experts === undefined ? [] : [...input.experts];
  const phases = uniqueStrings(input.phases ?? derivePhases(experts));
  const evidenceIds = uniqueStrings(input.evidenceIds ?? collectEvidenceIds(experts));
  const wastedWorkerFlags = uniqueStrings(
    input.wastedWorkerFlags ?? experts.filter((expert) => expert.wasted === true).map((e) => e.expertId),
  );
  return {
    runId: input.runId,
    startedAt: input.startedAt ?? new Date().toISOString(),
    experts,
    phases,
    tokens: input.tokens,
    evidenceIds,
    conflicts: input.conflicts === undefined ? [] : [...input.conflicts],
    wastedWorkerFlags,
  };
}

export function finalizeSwarmRunLedger(
  ledger: SwarmRunLedger,
  patch: FinalizeSwarmRunLedgerPatch = {},
): SwarmRunLedger {
  const experts = patch.experts === undefined ? [...ledger.experts] : [...patch.experts];
  const phases = uniqueStrings(patch.phases ?? ledger.phases);
  const evidenceIds = uniqueStrings(patch.evidenceIds ?? collectEvidenceIds(experts));
  const wastedWorkerFlags = uniqueStrings(
    patch.wastedWorkerFlags ??
      experts.filter((expert) => expert.wasted === true).map((expert) => expert.expertId),
  );
  return {
    runId: ledger.runId,
    startedAt: ledger.startedAt,
    finishedAt: patch.finishedAt ?? new Date().toISOString(),
    experts,
    phases,
    tokens: patch.tokens ?? ledger.tokens,
    evidenceIds,
    conflicts: patch.conflicts === undefined ? [...ledger.conflicts] : [...patch.conflicts],
    wastedWorkerFlags,
  };
}

/**
 * Build expert ledger rows from rendered UltraSwarm results.
 * Marks workers wasted when failed/aborted or completed without evidence.
 */
export function expertsFromSwarmResults(
  results: readonly SwarmRunLedgerResultLike[],
): SwarmRunLedgerExpert[] {
  return results.map((result) => {
    const evidenceIds = uniqueStrings(result.evidenceIds ?? []);
    const wasted = isWastedWorker(result.status, result.verdict, evidenceIds);
    return {
      expertId: result.spec.expertId,
      expertName: result.spec.expertName,
      phase: result.spec.phase,
      status: result.status,
      verdict: result.verdict,
      agentId: result.agentId,
      evidenceIds,
      wasted,
    };
  });
}

export function buildSwarmRunLedgerFromResults(input: {
  readonly runId: string;
  readonly startedAt: string;
  readonly results: readonly SwarmRunLedgerResultLike[];
  readonly tokens?: SwarmRunLedgerTokens;
  readonly conflicts?: readonly SwarmRunLedgerConflict[];
  readonly finishedAt?: string;
}): SwarmRunLedger {
  const experts = expertsFromSwarmResults(input.results);
  return finalizeSwarmRunLedger(
    createSwarmRunLedger({
      runId: input.runId,
      startedAt: input.startedAt,
      experts,
      tokens: input.tokens,
      conflicts: input.conflicts,
    }),
    {
      finishedAt: input.finishedAt,
      experts,
      tokens: input.tokens,
      conflicts: input.conflicts,
    },
  );
}

export function swarmRunLedgerRelativePath(runId: string): string {
  const safeId = runId.replaceAll(/[^a-zA-Z0-9._-]+/g, '_');
  return join(SWARM_RUN_LEDGER_DIR, `${safeId}.json`);
}

export function swarmRunLedgerAbsolutePath(workDir: string, runId: string): string {
  return join(workDir, swarmRunLedgerRelativePath(runId));
}

export function serializeSwarmRunLedger(ledger: SwarmRunLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

/**
 * Write ledger JSON under workdir (default: kaos cwd) at
 * `.superliora/swarm-ledgers/<runId>.json`.
 * Returns the absolute path written.
 */
export async function writeSwarmRunLedgerArtifact(
  kaos: Kaos,
  ledger: SwarmRunLedger,
  options?: { readonly workDir?: string },
): Promise<string> {
  const workDir = options?.workDir ?? kaos.getcwd();
  const path = swarmRunLedgerAbsolutePath(workDir, ledger.runId);
  await kaos.mkdir(dirname(path), { parents: true, existOk: true });
  await kaos.writeText(path, serializeSwarmRunLedger(ledger));
  return path;
}

export function isWastedWorker(
  status: string,
  verdict: string | undefined,
  evidenceIds: readonly string[],
): boolean {
  if (status === 'failed' || status === 'aborted') return true;
  if (verdict === 'FAIL' || verdict === 'ABORTED') return true;
  if (status === 'completed' && evidenceIds.length === 0 && (verdict === 'SKIPPED' || verdict === undefined)) {
    return true;
  }
  return false;
}

function derivePhases(experts: readonly SwarmRunLedgerExpert[]): string[] {
  return uniqueStrings(experts.map((expert) => expert.phase).filter((phase): phase is string => phase !== undefined));
}

function collectEvidenceIds(experts: readonly SwarmRunLedgerExpert[]): string[] {
  return uniqueStrings(experts.flatMap((expert) => expert.evidenceIds ?? []));
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
