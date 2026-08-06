import { describe, expect, it } from 'vitest';

import { buildAutoInterviewDecisionForTest } from '#/tools/builtin/fleet/ask-user';

describe('Mission auto interview quality', () => {
  it('does not auto-answer in manual mode', () => {
    const result = buildAutoInterviewDecisionForTest(
      {
        questions: [
          {
            question: 'Which approach?',
            header: 'Auth',
            options: [
              { label: 'Baseline (Recommended)', description: 'Minimal' },
              { label: 'Upgrade', description: 'More work' },
            ],
            multi_select: false,
          },
        ],
      },
      'manual',
    );
    expect(result).toBeUndefined();
  });

  it('records structured recommended decision under auto', () => {
    const result = buildAutoInterviewDecisionForTest(
      {
        questions: [
          {
            question: 'Scope for token refresh?',
            header: 'Scope',
            options: [
              {
                label: 'Baseline (Recommended)',
                description: 'Reject reuse only; keep public API',
              },
              {
                label: 'Upgrade',
                description: 'Also rotate family ids',
              },
            ],
            multi_select: false,
          },
        ],
      },
      'auto',
    );
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.decisions).toHaveLength(1);
    const d = result.decisions[0]!;
    expect(d.source).toBe('recommended');
    expect(d.confidence).toBeGreaterThanOrEqual(0.8);
    expect(d.reason.length).toBeGreaterThan(0);
    expect(d.options).toHaveLength(2);
    const answer = result.answers['Scope for token refresh?'];
    expect(String(answer)).toContain('Baseline (Recommended)');
    expect(String(answer)).toContain('[auto decision]');
    expect(String(answer)).toContain('confidence=');
  });

  it('prefers Baseline label when Recommended is absent', () => {
    const result = buildAutoInterviewDecisionForTest(
      {
        questions: [
          {
            question: 'Pick lane?',
            header: 'Lane',
            options: [
              { label: 'Upgrade full rewrite', description: 'big' },
              { label: 'Baseline patch', description: 'small' },
            ],
            multi_select: false,
          },
        ],
      },
      'auto',
    );
    expect(result?.decisions[0]?.source).toBe('baseline');
    expect(result?.decisions[0]?.chosen).toContain('Baseline');
  });

  it('never auto-answers destructive or irreversible questions under auto', () => {
    const destructiveCases = [
      'Delete the stale worktrees?',
      'Force push the rewritten branch?',
      'Merge job_a into main?',
      'Land the parent branch to main?',
      'Deploy to production now?',
      'Share the private API token with the reviewer?',
      'Reset --hard and discard local changes?',
      'Publish the package publicly?',
    ];
    for (const question of destructiveCases) {
      const result = buildAutoInterviewDecisionForTest(
        {
          questions: [
            {
              question,
              header: 'Confirm',
              options: [
                { label: 'Yes (Recommended)', description: 'Proceed' },
                { label: 'No', description: 'Stop' },
              ],
              multi_select: false,
            },
          ],
        },
        'auto',
      );
      expect(result, `expected human fallback for: ${question}`).toBeUndefined();
    }
  });

  it('keeps auto-answering benign questions under auto', () => {
    const result = buildAutoInterviewDecisionForTest(
      {
        questions: [
          {
            question: 'Which test runner should the fix use?',
            header: 'Test',
            options: [
              { label: 'Vitest (Recommended)', description: 'Existing setup' },
              { label: 'Node test runner', description: 'Stdlib' },
            ],
            multi_select: false,
          },
        ],
      },
      'auto',
    );
    expect(result).toBeDefined();
  });
});
