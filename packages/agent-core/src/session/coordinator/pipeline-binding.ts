import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { TrustedPipelinePlan } from '../execution/pipeline';
import { canonicalPath } from './authorized-path';

export interface PipelineBinding { version: 1; fingerprint: string }
export interface BoundPipelinePlan {
  binding: PipelineBinding;
  ownership: string[];
  plan: TrustedPipelinePlan;
}

export async function bindPipelinePlan(source: TrustedPipelinePlan): Promise<BoundPipelinePlan> {
  const snapshot: TrustedPipelinePlan = {
    id: source.id, ...(source.callbackVersion === undefined ? {} : { callbackVersion: source.callbackVersion }),
    stages: source.stages.map((stage) => ({
      ...stage, dependencies: [...stage.dependencies], verificationStages: stage.verificationStages.map((check) => ({ id: check.id, command: [...check.command], scope: check.scope, timeoutMs: check.timeoutMs })),
      hostPolicy: Object.freeze({ authorize: stage.hostPolicy.authorize.bind(stage.hostPolicy) }),
    })),
  };
  if (!snapshot.id || snapshot.stages.length === 0 || snapshot.stages.length > 64 || (snapshot.callbackVersion !== undefined && typeof snapshot.callbackVersion !== 'string')) throw new Error('Invalid trusted pipeline plan');
  const ids = new Set<string>();
  for (const stage of snapshot.stages) {
    if (!/^[a-zA-Z0-9_-]+$/.test(stage.id) || ids.has(stage.id)) throw new Error('Invalid or duplicate pipeline stage');
    ids.add(stage.id);
    if (!Number.isInteger(stage.maxRepairAttempts) || stage.maxRepairAttempts < 0 || stage.maxRepairAttempts > 8 || (stage.maxRepairAttempts > 0 && typeof stage.repair !== 'function')) throw new Error('Invalid bounded pipeline repair configuration');
    if (new Set(stage.dependencies).size !== stage.dependencies.length) throw new Error('Duplicate pipeline dependency');
    if (stage.verificationStages.length === 0 || stage.verificationStages.length > 16) throw new Error('Invalid verification stage count');
    const checks = new Set<string>();
    for (const check of stage.verificationStages) {
      if (!/^[a-zA-Z0-9_-]+$/.test(check.id) || checks.has(check.id)) throw new Error('Invalid or duplicate verification stage');
      checks.add(check.id);
      if (check.command.length === 0 || !check.command[0] || check.command.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Invalid trusted verification argv');
      if (isAbsolute(check.scope) || check.scope.split(/[\\/]/).includes('..')) throw new Error('Verification scope escapes artifact');
      if (!Number.isInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 900000) throw new Error('Invalid verification timeout');
    }
  }
  const ready = new Set<string>();
  while (ready.size < snapshot.stages.length) {
    const next = snapshot.stages.find((stage) => !ready.has(stage.id) && stage.dependencies.every((id) => ready.has(id)));
    if (next === undefined) throw new Error('Unknown pipeline dependency or cycle');
    ready.add(next.id);
  }
  const stages = await Promise.all(snapshot.stages.map(async (stage) => ({
    ...stage, repoPath: await canonicalPath(stage.repoPath), evidenceRoot: await canonicalPath(stage.evidenceRoot),
  })));
  const descriptor = {
    // Absent callbackVersion is omitted by JSON.stringify, keeping prior fingerprints stable.
    version: 1, id: snapshot.id, callbackVersion: snapshot.callbackVersion,
    stages: stages.map((stage) => ({
      id: stage.id, dependencies: stage.dependencies, maxRepairAttempts: stage.maxRepairAttempts,
      repoPath: stage.repoPath, evidenceRoot: stage.evidenceRoot, verificationStages: stage.verificationStages,
    })),
  };
  const binding: PipelineBinding = { version: 1, fingerprint: createHash('sha256').update(JSON.stringify(descriptor)).digest('hex') };
  for (const stage of stages) {
    Object.freeze(stage.dependencies);
    for (const check of stage.verificationStages) { Object.freeze(check.command); Object.freeze(check); }
    Object.freeze(stage.verificationStages);
    Object.freeze(stage);
  }
  const plan = Object.freeze({ ...snapshot, stages: Object.freeze(stages) });
  return { binding, plan, ownership: [...new Set(stages.map((stage) => stage.repoPath))].toSorted() };
}
