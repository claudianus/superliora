import type { Agent } from '../../../agent/index';
import { requestJobSchedulePump } from '../../../session/job/job-offload';
import type { ToolStore } from '../../store';
import { getJob, renderJobLine, type JobRecord } from './job-ledger';
import type { ConductorPoolConfig } from './job-runtime';

/** Operator-facing diagnosis; completion means the run ended, not that checks passed. */
export function renderJobInspect(job: JobRecord): string {
  const lines = [renderJobLine(job)];
  if (job.prompt) {
    lines.push(`prompt:\n${job.prompt.slice(0, 800)}${job.prompt.length > 800 ? '\n[truncated]' : ''}`);
  }
  if (job.worktreePath) lines.push(`worktree: ${job.worktreePath}`);
  if (job.worktreeBranch) lines.push(`branch: ${job.worktreeBranch}`);
  if (job.workerAgentId) lines.push(`worker: ${job.workerAgentId}`);
  if (job.resultSummary) lines.push(`result:\n${job.resultSummary}`);
  if (job.filesChanged?.length) lines.push(`files_changed: ${job.filesChanged.join(', ')}`);
  if (job.usage) lines.push(`usage: ${JSON.stringify(job.usage)}`);
  if (job.landReceipt) lines.push(`landed: ${job.landReceipt.mergeSha}`);
  if (job.notes) lines.push(`notes:\n${job.notes}`);
  return lines.join('\n');
}

export async function ackCreatedJobs(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly created: readonly JobRecord[];
  readonly pool: ConductorPoolConfig;
  readonly batchLabel?: string;
  readonly extraLines?: readonly string[];
  readonly skipSchedulePump?: boolean;
}): Promise<{ isError: false; output: string }> {
  if (!input.skipSchedulePump) {
    void requestJobSchedulePump({ store: input.store, agent: input.agent });
  }
  const lines = input.created.map((job) => {
    const latest = getJob(input.store, job.id) ?? job;
    return `ACK ${latest.id} state=${latest.status}\n${renderJobLine(latest)}`;
  });
  lines.push(...(input.extraLines ?? []));
  lines.push(`pool: maxConcurrent=${input.pool.maxConcurrentJobs}`);
  return { isError: false, output: lines.join('\n') };
}
