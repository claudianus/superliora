/**
 * Mission-as-Job spine — bind Ultrawork/Mission runs to Conductor Job ledger.
 */

import type { ToolStore } from '../../store';
import {
  createJob,
  getJob,
  listJobs,
  patchJob,
  type JobRecord,
  type JobStatus,
} from './job-ledger';
import { pushJobInboxEvent, inboxKindForStatus } from './job-inbox';

export function findJobByMissionRunId(
  store: ToolStore,
  missionRunId: string,
): JobRecord | undefined {
  return listJobs(store).find((j) => j.missionRunId === missionRunId);
}

/**
 * Create (or reuse) a mission-kind Job for a Mission/Ultrawork run.
 * Does not monopolize the interactive lane — other Jobs remain schedulable.
 */
export function bindMissionToJob(
  store: ToolStore,
  input: {
    readonly missionRunId: string;
    readonly objective: string;
    readonly status?: JobStatus;
  },
): JobRecord {
  const existing = findJobByMissionRunId(store, input.missionRunId);
  if (existing !== undefined) {
    return (
      patchJob(store, existing.id, {
        title: titleFromObjective(input.objective),
        status: input.status ?? existing.status,
        prompt: input.objective,
      }) ?? existing
    );
  }
  const created = createJob(store, {
    title: titleFromObjective(input.objective),
    kind: 'mission',
    priority: 10,
    prompt: input.objective,
    missionRunId: input.missionRunId,
  });
  if (input.status !== undefined) {
    return patchJob(store, created.id, { status: input.status }) ?? created;
  }
  return created;
}

export function syncMissionJobStatus(
  store: ToolStore,
  missionRunId: string,
  status: JobStatus,
  summary?: string,
): JobRecord | undefined {
  const job = findJobByMissionRunId(store, missionRunId);
  if (job === undefined) return undefined;
  const next = patchJob(store, job.id, {
    status,
    resultSummary: summary ?? job.resultSummary,
    notes: [job.notes, summary ? `mission: ${summary}` : undefined].filter(Boolean).join('\n'),
  });
  if (next === undefined) return undefined;
  const kind = inboxKindForStatus(status);
  if (kind !== undefined) {
    pushJobInboxEvent(store, {
      kind,
      jobId: next.id,
      status: next.status,
      title: next.title,
      summary: summary ?? `Mission ${missionRunId} → ${status}`,
    });
  }
  return next;
}

/**
 * Async Mission interview card: surface a `needs_user` Job inbox event
 * without monopolizing the interactive lane. Other Jobs stay schedulable;
 * the card is consumed via JobInbox (list/ack) and re-raised on resume.
 */
export function raiseMissionInterviewCard(
  store: ToolStore,
  missionRunId: string,
  input: {
    readonly question: string;
    readonly context?: string;
  },
): JobRecord | undefined {
  const job = findJobByMissionRunId(store, missionRunId);
  if (job === undefined) {
    return bindMissionToJob(store, {
      missionRunId,
      objective: input.question,
      status: 'needs_user',
    });
  }
  const next = patchJob(store, job.id, {
    status: 'needs_user',
    resultSummary: `needs_user: ${input.question}`,
    notes: [
      job.notes,
      `interview: ${input.question}`,
      input.context ? `interview-context: ${input.context}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  if (next === undefined) return undefined;
  pushJobInboxEvent(store, {
    kind: 'job.needs_user',
    jobId: next.id,
    status: next.status,
    title: next.title,
    summary: `Mission ${missionRunId} needs input: ${input.question}`,
  });
  return next;
}

export function listJobsParallelToMission(
  store: ToolStore,
  missionRunId: string,
): readonly JobRecord[] {
  return listJobs(store).filter(
    (j) => j.missionRunId !== missionRunId && j.status !== 'done' && j.status !== 'cancelled',
  );
}

function titleFromObjective(objective: string): string {
  const one = objective.replace(/\s+/g, ' ').trim();
  if (one.length === 0) return 'Mission';
  if (one.length <= 72) return `Mission: ${one}`;
  return `Mission: ${one.slice(0, 64)}...`;
}

// silence unused
void getJob;
