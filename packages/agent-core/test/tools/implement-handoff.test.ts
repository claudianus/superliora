import { describe, expect, it } from 'vitest';

import { renderJobDeskInjection } from '../../src/agent/injection/job-desk';
import { createJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { summarizeJobStrip } from '../../src/tools/builtin/job/job-runtime';
import {
  parseImplementHandoff,
  renderImplementHandoffDraft,
} from '../../src/tools/builtin/planning/implement-handoff';
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

const SAMPLE = `
Plan path: /tmp/plan.md

## Implement handoff
success_criteria:
- landing loads in under 2s
- smoke exits 0
must_not_touch:
- packages/server
- apps/liora
verification_commands:
- pnpm test
ownership_paths:
- apps/site
context_paths:
- apps/site/src/main.ts
delivery_mode: greenfield

## Notes
ignore this section
`;

describe('parseImplementHandoff', () => {
  it('parses list fields and delivery_mode', () => {
    const handoff = parseImplementHandoff(SAMPLE);
    expect(handoff).toEqual({
      successCriteria: ['landing loads in under 2s', 'smoke exits 0'],
      mustNotTouch: ['packages/server', 'apps/liora'],
      verificationCommands: ['pnpm test'],
      ownershipPaths: ['apps/site'],
      contextPaths: ['apps/site/src/main.ts'],
      deliveryMode: 'greenfield',
    });
  });

  it('returns undefined when the header is missing', () => {
    expect(parseImplementHandoff('just a plan summary')).toBeUndefined();
  });

  it('returns undefined for greenfield without must_not_touch', () => {
    expect(
      parseImplementHandoff(`## Implement handoff
success_criteria:
- ok
delivery_mode: greenfield`),
    ).toBeUndefined();
  });

  it('renders a JobCreate draft', () => {
    const draft = renderImplementHandoffDraft(parseImplementHandoff(SAMPLE)!);
    expect(draft).toContain('greenfield_chain: true');
    expect(draft).toContain('"landing loads in under 2s"');
  });
});

describe('desk Next move for Plan Desk handoff', () => {
  it('points Conductor at JobCreate from handoff when a mission completes', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Plan: new app',
      kind: 'mission',
      planStructured: true,
    });
    patchJob(store, job.id, {
      status: 'done',
      resultSummary: SAMPLE,
    });
    const text = renderJobDeskInjection(
      [
        {
          id: 'evt1',
          kind: 'job.completed',
          jobId: job.id,
          status: 'done',
          title: job.title,
          summary: SAMPLE.slice(0, 80),
          createdAt: new Date().toISOString(),
          read: false,
        },
      ],
      summarizeJobStrip(store),
      { store },
    );
    expect(text).toMatch(/Implement handoff/);
    expect(text).toMatch(/greenfield_chain=true/);
  });

  it('asks for a handoff rewrite when the block is missing', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Plan: new app',
      kind: 'mission',
      planStructured: true,
    });
    patchJob(store, job.id, {
      status: 'done',
      resultSummary: 'Seed Spec ready. AC Tree done. No handoff block.',
    });
    const text = renderJobDeskInjection(
      [
        {
          id: 'evt1',
          kind: 'job.completed',
          jobId: job.id,
          status: 'done',
          title: job.title,
          summary: 'Seed Spec ready',
          createdAt: new Date().toISOString(),
          read: false,
        },
      ],
      summarizeJobStrip(store),
      { store },
    );
    expect(text).toMatch(/Implement handoff block is missing/);
  });
});
