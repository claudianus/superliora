import { describe, expect, it } from 'vitest';

import { tryMergeStructuredBlockSummaries } from '../../../src/agent/compaction/pipeline/merge-structured';
import { hasExactV2Attempt } from '../../../src/agent/compaction/plan/quality-helpers';

function block(goal: string, next: string, file?: string): string {
  return [
    'current_goal:',
    `- ${goal}`,
    'last_known_state:',
    '- mid-session',
    'decisions:',
    '- keep append-only',
    'files_touched:',
    file !== undefined ? `- ${file}` : '- none',
    'failed_attempts:',
    '- none',
    'open_questions:',
    '- none',
    'next_actions:',
    `- ${next}`,
    'verified_claims:',
    '- none | evidence=n/a | needs_revalidation=true',
    'raw_refs:',
    '- none',
  ].join('\n');
}

describe('tryMergeStructuredBlockSummaries', () => {
  it('returns undefined when any block is free-form', () => {
    expect(
      tryMergeStructuredBlockSummaries([block('a', 'do a'), 'just free form prose']),
    ).toBeUndefined();
  });

  it('merges structured blocks without an LLM', () => {
    const merged = tryMergeStructuredBlockSummaries([
      block('older goal', 'step one', 'a.ts'),
      block('latest goal', 'step two', 'b.ts'),
    ]);
    expect(merged).toBeDefined();
    expect(hasExactV2Attempt(merged!)).toBe(true);
    // Prefer the later block's goal (more recent slice).
    expect(merged).toContain('latest goal');
    expect(merged).toContain('step one');
    expect(merged).toContain('step two');
    expect(merged).toContain('a.ts');
    expect(merged).toContain('b.ts');
  });

  it('dedupes identical list items across blocks', () => {
    const merged = tryMergeStructuredBlockSummaries([
      block('g', 'same next', 'shared.ts'),
      block('g', 'same next', 'shared.ts'),
    ]);
    expect(merged).toBeDefined();
    const nextLines = merged!
      .split('\n')
      .filter((line) => line.includes('same next'));
    expect(nextLines).toHaveLength(1);
  });
});
