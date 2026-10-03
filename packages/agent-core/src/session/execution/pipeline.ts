/** Predetermined host plans only. Never construct these callbacks or argv from model output. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  runArtifactVerification, sealVerificationArtifact,
  type VerificationArtifact, type VerificationHostPolicy, type VerificationReceipt, type VerificationStage,
} from './verification';

export interface PipelineContext {
  readonly stageId: string;
  /** Zero for production, then the bounded repair number. */
  readonly attempt: number;
  readonly requirementsHash: string;
  /** Owned by execution, not the conductor's inference turn. */
  readonly executionSignal?: AbortSignal;
}
export interface TrustedPipelineStage {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly maxRepairAttempts: number;
  readonly repoPath: string;
  readonly evidenceRoot: string;
  readonly verificationStages: readonly VerificationStage[];
  readonly hostPolicy: VerificationHostPolicy;
  readonly currentRequirementsHash: () => string | Promise<string>;
  readonly currentRevision: () => string | Promise<string>;
  /** Must settle owned work before returning/throwing, including on cancellation. */
  readonly produce: (context: PipelineContext) => Promise<string>;
  readonly repair?: (context: PipelineContext & { readonly receipt: VerificationReceipt }) => Promise<string>;
}
export interface TrustedPipelinePlan {
  readonly id: string;
  readonly stages: readonly TrustedPipelineStage[];
}
export type PipelineStatus = 'success' | 'failed' | 'blocked' | 'cancelled';
export interface PipelineStageResult {
  readonly stageId: string;
  readonly status: PipelineStatus;
  /** Number of verification cycles, including the initial cycle. */
  readonly attempts: number;
  readonly receipts: readonly VerificationReceipt[];
  readonly failure?: string;
}
export interface PipelineResult {
  readonly planId: string;
  readonly status: PipelineStatus;
  readonly stages: readonly PipelineStageResult[];
}

/** Snapshot host configuration and validate the entire graph before any host callback. */
function orderedStages(plan: TrustedPipelinePlan): TrustedPipelineStage[] {
  if (!plan.id || plan.stages.length === 0 || plan.stages.length > 64) throw new Error('Pipeline requires an id and 1–64 stages');
  const stages = plan.stages.map(stage => ({ ...stage, dependencies: [...stage.dependencies],
    verificationStages: structuredClone(stage.verificationStages) }));
  const ids = new Set<string>();
  for (const stage of stages) {
    if (!/^[a-zA-Z0-9_-]+$/.test(stage.id) || ids.has(stage.id)) throw new Error('Invalid or duplicate pipeline stage');
    ids.add(stage.id);
    if (!Number.isInteger(stage.maxRepairAttempts) || stage.maxRepairAttempts < 0 || stage.maxRepairAttempts > 8) {
      throw new Error('Repair attempts must be 0–8');
    }
    if (stage.maxRepairAttempts > 0 && !stage.repair) throw new Error('Repair callback required');
    if (new Set(stage.dependencies).size !== stage.dependencies.length) throw new Error('Duplicate dependency');
  }
  for (const stage of stages) {
    if (stage.dependencies.some(id => !ids.has(id))) throw new Error('Unknown dependency');
  }
  const ordered: TrustedPipelineStage[] = [];
  const ready = new Set<string>();
  while (ordered.length < stages.length) {
    const next = stages.find(stage => !ready.has(stage.id) && stage.dependencies.every(id => ready.has(id)));
    if (!next) throw new Error('Pipeline dependency cycle');
    ordered.push(next);
    ready.add(next.id);
  }
  return ordered;
}

/** Verify the actual persisted receipt and log bytes, not a callback's success assertion. */
async function authenticReceipt(receipt: VerificationReceipt, artifact: VerificationArtifact): Promise<boolean> {
  if (receipt.version !== 1 || receipt.artifactHash !== artifact.artifactHash ||
      receipt.sourceRevision !== artifact.sourceRevision || receipt.sourceTree !== artifact.sourceTree ||
      receipt.requirementsHash !== artifact.requirementsHash) return false;
  const persisted: unknown = JSON.parse(await readFile(receipt.evidencePath, 'utf8'));
  if (JSON.stringify(persisted) !== JSON.stringify(receipt)) return false;
  for (const stage of receipt.stages) {
    for (const [path, digest] of [[stage.stdoutPath, stage.stdoutHash], [stage.stderrPath, stage.stderrHash]]) {
      if (createHash('sha256').update(await readFile(path!)).digest('hex') !== digest) return false;
    }
  }
  if (receipt.status !== 'passed') return true;
  return receipt.stages.length === artifact.stages.length && receipt.stages.every((stage, index) => {
    const expected = artifact.stages[index]!;
    return stage.stageId === expected.id && stage.scope === expected.scope &&
      JSON.stringify(stage.command) === JSON.stringify(expected.command) && stage.exitCode === 0 &&
      !stage.signal && !stage.timedOut && !stage.cancelled && !stage.failure;
  });
}

async function runStage(stage: TrustedPipelineStage, executionSignal?: AbortSignal): Promise<PipelineStageResult> {
  const receipts: VerificationReceipt[] = [];
  let attempts = 0;
  const result = (status: PipelineStatus, failure?: string): PipelineStageResult =>
    ({ stageId: stage.id, status, attempts, receipts, ...(failure ? { failure } : {}) });
  const cancelled = (): boolean => executionSignal?.aborted === true;
  try {
    if (cancelled()) return result('cancelled');
    const requirementsHash = await stage.currentRequirementsHash();
    const fresh = async (revision?: string): Promise<boolean> =>
      await stage.currentRequirementsHash() === requirementsHash &&
      (revision === undefined || await stage.currentRevision() === revision);
    let revision: string | undefined;
    for (let attempt = 0; attempt <= stage.maxRepairAttempts; attempt++) {
      if (cancelled()) return result('cancelled');
      if (!await fresh(revision)) return result('blocked', 'Requirements or revision changed');
      const context: PipelineContext = { stageId: stage.id, attempt, requirementsHash, executionSignal };
      revision = attempt === 0 ? await stage.produce(context) :
        await stage.repair!({ ...context, receipt: structuredClone(receipts.at(-1)!) });
      if (cancelled()) return result('cancelled');
      if (!await fresh(revision)) return result('blocked', 'Requirements or revision changed');
      const artifact = await sealVerificationArtifact({ hostPolicy: stage.hostPolicy, repoPath: stage.repoPath,
        sourceRevision: revision, requirementsHash, stages: stage.verificationStages });
      if (cancelled()) return result('cancelled');
      if (!await fresh(revision)) return result('blocked', 'Requirements or revision changed');
      attempts++;
      const receipt = await runArtifactVerification({ hostPolicy: stage.hostPolicy, repoPath: stage.repoPath,
        artifact, evidenceRoot: stage.evidenceRoot, signal: executionSignal,
        currentRequirementsHash: stage.currentRequirementsHash });
      receipts.push(receipt);
      if (cancelled() || receipt.status === 'cancelled') return result('cancelled');
      if (!await fresh(revision) || receipt.status === 'stale' || receipt.status === 'source_changed') {
        return result('blocked', 'Requirements or revision changed');
      }
      if (!await authenticReceipt(receipt, artifact)) return result('failed', 'Verification evidence mismatch');
      // Publication freshness must follow the asynchronous evidence reads as well.
      if (cancelled()) return result('cancelled');
      if (!await fresh(revision)) return result('blocked', 'Requirements or revision changed');
      if (receipt.status === 'passed') return result('success');
    }
    return result('failed', 'Verification failed; repair budget exhausted');
  } catch (error) {
    return result(cancelled() ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Execute a plan selected from the trusted host registry. Stable topological order,
 * no model supervisor, polling, inferred dependencies, or implicit repair retries.
 * Independent branches may complete after another branch fails; dependents cannot.
 */
export async function runTrustedPipeline(plan: TrustedPipelinePlan, options: {
  readonly executionSignal?: AbortSignal;
} = {}): Promise<PipelineResult> {
  const planId = plan.id;
  const stages = orderedStages(plan);
  const executionSignal = options.executionSignal;
  const results: PipelineStageResult[] = [];
  const refresh = async (index: number): Promise<void> => {
    const result = results[index]!;
    if (result.status !== 'success') return;
    const stage = stages[index]!;
    const receipt = result.receipts.at(-1)!;
    try {
      if (await stage.currentRequirementsHash() !== receipt.requirementsHash ||
          await stage.currentRevision() !== receipt.sourceRevision) {
        results[index] = { ...result, status: 'blocked', failure: 'Requirements or revision changed' };
      }
    } catch (error) {
      results[index] = { ...result, status: 'failed', failure: error instanceof Error ? error.message : String(error) };
    }
  };
  for (const stage of stages) {
    // Readiness requires currently valid dependency receipts, not historical success.
    for (const dependency of stage.dependencies) {
      await refresh(results.findIndex(result => result.stageId === dependency));
    }
    if (executionSignal?.aborted) {
      results.push({ stageId: stage.id, status: 'cancelled', attempts: 0, receipts: [] });
    } else if (stage.dependencies.some(id => results.find(result => result.stageId === id)?.status !== 'success')) {
      results.push({ stageId: stage.id, status: 'blocked', attempts: 0, receipts: [], failure: 'Dependency did not succeed' });
    } else {
      results.push(await runStage(stage, executionSignal));
    }
  }
  // A later branch must not leave an earlier stale receipt published as success.
  for (let index = 0; index < results.length; index++) {
    await refresh(index);
    if (results[index]!.status === 'success' && stages[index]!.dependencies.some(id =>
      results.find(result => result.stageId === id)?.status !== 'success')) {
      results[index] = { ...results[index]!, status: 'blocked', failure: 'Dependency did not succeed' };
    }
  }
  if (executionSignal?.aborted) {
    for (let index = 0; index < results.length; index++) {
      if (results[index]!.status === 'success') results[index] = { ...results[index]!, status: 'cancelled' };
    }
  }
  const status = (['cancelled', 'failed', 'blocked'] as const).find(value => results.some(result => result.status === value)) ?? 'success';
  return { planId, status, stages: results };
}
