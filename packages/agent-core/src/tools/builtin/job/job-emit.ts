/**
 * Optional wire emit for job.* events when agent bus is available.
 * Store/inbox remain source of truth; emit is best-effort for TUI/live clients.
 */

import {
  JOB_EVENT_SCHEMA_VERSION,
  type JobInboxEvent as WireJobInboxEvent,
  type JobUpdatedEvent,
} from '@superliora/protocol';

import type { Agent } from '../../../agent';
import type { JobInboxEvent } from './job-inbox';
import type { JobRecord } from './job-ledger';

export function jobRecordToUpdatedEvent(
  job: JobRecord,
  change?: JobUpdatedEvent['change'],
): JobUpdatedEvent {
  return {
    type: 'job.updated',
    schemaVersion: JOB_EVENT_SCHEMA_VERSION,
    job: {
      id: job.id,
      title: job.title,
      status: job.status,
      kind: job.kind,
      priority: job.priority,
      worktreePath: job.worktreePath,
      workerAgentId: job.workerAgentId,
      missionRunId: job.missionRunId,
      resultSummary: job.resultSummary,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    change,
  };
}

export function inboxToWireEvent(event: JobInboxEvent): WireJobInboxEvent {
  return {
    type: 'job.inbox',
    schemaVersion: JOB_EVENT_SCHEMA_VERSION,
    eventId: event.id,
    kind: event.kind,
    jobId: event.jobId,
    status: event.status,
    title: event.title,
    summary: event.summary,
    digest: event.digest,
  };
}

/**
 * Emit via agent event bus when present. Never throws into Job ledger paths.
 */
export function emitJobEvents(
  agent: Agent | undefined,
  events: readonly (JobUpdatedEvent | WireJobInboxEvent)[],
): void {
  if (agent === undefined || events.length === 0) return;
  const bus = agent as Agent & {
    emitAgentEvent?: (event: JobUpdatedEvent | WireJobInboxEvent) => void;
    events?: { emit?: (event: unknown) => void };
  };
  for (const event of events) {
    try {
      if (typeof bus.emitAgentEvent === 'function') {
        bus.emitAgentEvent(event);
      } else if (typeof bus.events?.emit === 'function') {
        bus.events.emit(event);
      }
    } catch {
      // ignore — wire emit is optional
    }
  }
}
