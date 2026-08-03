import { describe, expect, it } from 'vitest';

import {
  JOB_EVENT_SCHEMA_VERSION,
  jobInboxEventSchema,
  jobUpdatedEventSchema,
} from '../events/job';
import { agentEventSchema } from '../events/wire';

describe('job.* protocol events', () => {
  it('parses job.updated with schemaVersion', () => {
    const event = {
      type: 'job.updated' as const,
      schemaVersion: JOB_EVENT_SCHEMA_VERSION,
      job: {
        id: 'job_abc',
        title: 'Ship strip',
        status: 'running' as const,
        kind: 'implement' as const,
        priority: 1,
      },
      change: { reason: 'scheduled', previousStatus: 'queued' as const },
    };
    expect(jobUpdatedEventSchema.parse(event)).toEqual(event);
    expect(agentEventSchema.parse(event).type).toBe('job.updated');
  });

  it('parses job.inbox and ignores unknown fields on wire union', () => {
    const event = {
      type: 'job.inbox' as const,
      schemaVersion: JOB_EVENT_SCHEMA_VERSION,
      eventId: 'jinbox_1',
      kind: 'job.completed' as const,
      jobId: 'job_abc',
      status: 'done' as const,
      title: 'Ship strip',
      summary: 'ok',
    };
    expect(jobInboxEventSchema.parse(event)).toEqual(event);
    expect(agentEventSchema.parse(event).type).toBe('job.inbox');
  });

  it('v2: parses job.updated with worker progress fields (phase/recent tools/heartbeat)', () => {
    const event = {
      type: 'job.updated' as const,
      schemaVersion: 2 as const,
      job: {
        id: 'job_abc',
        title: 'Fix auth tests',
        status: 'running' as const,
        kind: 'implement' as const,
        priority: 2,
        progress: {
          phase: 'running tests',
          recentTools: ['Read', 'Edit', 'Bash'],
          lastHeartbeatAt: '2026-08-03T12:00:00.000Z',
          stepsCompleted: 3,
          stepsTotal: 5,
        },
      },
    };
    const parsed = jobUpdatedEventSchema.parse(event);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.job.progress?.phase).toBe('running tests');
    expect(parsed.job.progress?.recentTools).toEqual(['Read', 'Edit', 'Bash']);
    expect(agentEventSchema.parse(event).type).toBe('job.updated');
  });

  it('v2: parses desk kind and digest escalation marker', () => {
    const updated = {
      type: 'job.updated' as const,
      schemaVersion: 2 as const,
      job: {
        id: 'job_desk1',
        title: 'Desk: inbox digest',
        status: 'running' as const,
        kind: 'desk' as const,
        priority: 1,
      },
    };
    expect(jobUpdatedEventSchema.parse(updated).job.kind).toBe('desk');

    const inbox = {
      type: 'job.inbox' as const,
      schemaVersion: 2 as const,
      eventId: 'jinbox_2',
      kind: 'job.completed' as const,
      jobId: 'job_abc',
      status: 'done' as const,
      title: 'Inbox digest (10 notices)',
      summary: 'Desk digest: 10 notices.',
      digest: true,
    };
    expect(jobInboxEventSchema.parse(inbox).digest).toBe(true);
    expect(agentEventSchema.parse(inbox).type).toBe('job.inbox');
  });

  it('dual-read: v1 journal events (schemaVersion 1, no v2 fields) still parse', () => {
    const v1Updated = {
      type: 'job.updated' as const,
      schemaVersion: 1 as const,
      job: {
        id: 'job_old',
        title: 'Legacy job',
        status: 'done' as const,
        kind: 'task' as const,
        priority: 0,
        resultSummary: 'done',
      },
      change: { reason: 'job.completed', previousStatus: 'running' as const },
    };
    expect(jobUpdatedEventSchema.parse(v1Updated).schemaVersion).toBe(1);

    const v1Inbox = {
      type: 'job.inbox' as const,
      schemaVersion: 1 as const,
      eventId: 'jinbox_old',
      kind: 'job.failed' as const,
      jobId: 'job_old2',
      status: 'failed' as const,
      title: 'Legacy fail',
    };
    expect(jobInboxEventSchema.parse(v1Inbox).schemaVersion).toBe(1);
    expect(agentEventSchema.parse(v1Updated).type).toBe('job.updated');
    expect(agentEventSchema.parse(v1Inbox).type).toBe('job.inbox');
  });

  it('backward compat: unknown v2+ fields are ignored by current readers', () => {
    const event = {
      type: 'job.updated' as const,
      schemaVersion: 2 as const,
      job: {
        id: 'job_abc',
        title: 'Ship strip',
        status: 'running' as const,
        kind: 'desk' as const,
        priority: 1,
        progress: {
          phase: 'digesting',
          futureFieldFromV3: { anything: true },
        },
      },
      unknownTopLevel: 42,
    };
    const parsed = jobUpdatedEventSchema.parse(event);
    expect(parsed.job.progress?.phase).toBe('digesting');
    expect('unknownTopLevel' in parsed).toBe(false);
    expect(agentEventSchema.parse(event).type).toBe('job.updated');
  });
});
