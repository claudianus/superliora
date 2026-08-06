import { describe, expect, it } from 'vitest';

import { ensureStructuredHandoffScaffold } from '../../../src/agent/compaction/plan/handoff-scaffold';
import {
  hasExactV2Attempt,
  latestUserText,
} from '../../../src/agent/compaction/plan/quality-helpers';
import type { ContextMessage } from '../../../src/agent/context';

describe('ensureStructuredHandoffScaffold', () => {
  it('leaves structured summaries unchanged', () => {
    const structured = [
      'current_goal:',
      '- fix cache',
      'last_known_state:',
      '- micro gone',
      'next_actions:',
      '- run tests',
    ].join('\n');
    expect(ensureStructuredHandoffScaffold(structured)).toBe(structured);
    expect(hasExactV2Attempt(structured)).toBe(true);
  });

  it('wraps free-form prose into v2 labels using the latest user ask', () => {
    const out = ensureStructuredHandoffScaffold('Did some work on the footer badge.', {
      latestUserRequest: 'Please improve long-session handoff quality for all models.',
      nextActionHint: 'Run quality tests',
    });
    expect(hasExactV2Attempt(out)).toBe(true);
    expect(out).toContain('current_goal:');
    expect(out).toContain('Please improve long-session handoff quality for all models.');
    expect(out).toContain('next_actions:');
    expect(out).toContain('Run quality tests');
    expect(out).toContain('## Compacted Narrative (original free-form)');
    expect(out).toContain('Did some work on the footer badge.');
  });

  it('ignores user-role injections when selecting the latest user request', () => {
    const messages: ContextMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Fix the Conductor handoff.' }],
        toolCalls: [],
        origin: { kind: 'user' },
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '<conductor_job_desk>running</conductor_job_desk>' }],
        toolCalls: [],
        origin: { kind: 'injection', variant: 'conductor_job_desk' },
      },
    ];

    expect(latestUserText(messages)).toBe('Fix the Conductor handoff.');
  });
});
