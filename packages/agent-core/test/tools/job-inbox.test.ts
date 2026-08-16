import { describe, expect, it } from 'vitest';

import {
  pushJobInboxEvent,
  readJobInbox,
} from '../../src/tools/builtin/job/job-inbox';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get(key) {
      return data[key] as never;
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

describe('pushJobInboxEvent', () => {
  it('pins implement_handoff, success criteria, SHA, and failure stderr when summary overflows', () => {
    const store = memoryStore();
    const noise = `noise: ${'x'.repeat(2_400)}`;
    const event = pushJobInboxEvent(store, {
      kind: 'job.failed',
      jobId: 'job_overflow',
      status: 'failed',
      title: 'publish pages',
      summary: [
        noise,
        '## Implement handoff',
        'success_criteria:',
        '- tests pass and Inspect still shows the SHA',
        'sha=abcdef0123456789deadbeefcafebabe01234567',
        'stderr: fatal: could not read Username for https://github.com/acme/repo.git',
      ].join('\n'),
    });

    expect(event.summary ?? '').toContain('Implement handoff');
    expect(event.summary ?? '').toContain('success_criteria');
    expect(event.summary ?? '').toContain('sha=abcdef0123456789deadbeefcafebabe01234567');
    expect(event.summary ?? '').toMatch(/stderr:.*could not read Username/);
    expect((event.summary ?? '').length).toBeLessThanOrEqual(2_000);
    expect(readJobInbox(store).events).toHaveLength(1);
  });
});
