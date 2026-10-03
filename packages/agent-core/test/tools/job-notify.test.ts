import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../src/agent';
import { listUnreadJobInbox } from '../../src/tools/builtin/job/job-inbox';
import { createJob } from '../../src/tools/builtin/job/job-ledger';
import { patchJobAndNotify } from '../../src/tools/builtin/job/job-notify';
import type { ToolStore } from '../../src/tools/store';

describe('Job operator notifications', () => {
  it('emits a blocked outcome and persists an inbox card without starting a cognitive routing turn', () => {
    const data = new Map<string, unknown>();
    const store = { get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value) } as ToolStore;
    const job = createJob(store, { title: 'Blocked operation' });
    const emitAgentEvent = vi.fn();
    const prompt = vi.fn();
    const agent = { emitAgentEvent, prompt } as unknown as Agent;
    patchJobAndNotify(store, job.id, { status: 'blocked', resultSummary: 'merge conflict' }, { agent });
    expect(listUnreadJobInbox(store)).toHaveLength(1);
    expect(emitAgentEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'job.updated', job: expect.objectContaining({ status: 'blocked' }) }));
    expect(prompt).not.toHaveBeenCalled();
    patchJobAndNotify(store, job.id, { status: 'blocked', notes: 'operator inspected' }, { agent });
    expect(listUnreadJobInbox(store)).toHaveLength(1);
  });
});
