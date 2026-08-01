import { describe, expect, it } from 'vitest';

import { ensureStructuredHandoffScaffold } from '../../../src/agent/compaction/plan/handoff-scaffold';
import { hasExactV2Attempt } from '../../../src/agent/compaction/plan/quality-helpers';

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
});
