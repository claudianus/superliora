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
});
