import { describe, expect, it } from 'vitest';

import {
  isScopeEscapeQuestion,
  questionsIncludeScopeEscape,
  shouldBlockScopeEscapeQuestion,
} from '../../../src/tools/support/scope-escape-question';

describe('scope-escape-question', () => {
  it('flags magnitude renegotiation questions', () => {
    expect(
      isScopeEscapeQuestion({
        question: 'Given the magnitude of the work, do you really want to continue?',
      }),
    ).toBe(true);
    expect(
      isScopeEscapeQuestion({
        question: 'Realistically, what scope should we aim for here?',
        options: [
          { label: 'Full goal' },
          { label: 'Reduce scope' },
        ],
      }),
    ).toBe(true);
    expect(
      questionsIncludeScopeEscape([
        { question: 'Which database?' },
        { question: 'Should we defer the remaining items?' },
      ]),
    ).toBe(true);
  });

  it('allows ordinary preference questions', () => {
    expect(
      isScopeEscapeQuestion({
        question: 'Which database?',
        options: [
          { label: 'Postgres (Recommended)', description: 'Relational' },
          { label: 'SQLite', description: 'Embedded' },
        ],
      }),
    ).toBe(false);
    expect(
      isScopeEscapeQuestion({
        question: 'Baseline or Upgrade for auth?',
        options: [{ label: 'Baseline' }, { label: 'Upgrade' }],
      }),
    ).toBe(false);
  });

  it('blocks only on goal/auto autonomous paths', () => {
    expect(
      shouldBlockScopeEscapeQuestion({
        askModeActive: true,
        permissionMode: 'auto',
        goalStatus: 'active',
      }),
    ).toBe(false);
    expect(
      shouldBlockScopeEscapeQuestion({
        ultraPlanInterview: true,
        goalStatus: 'active',
      }),
    ).toBe(false);
    expect(
      shouldBlockScopeEscapeQuestion({
        goalStatus: 'active',
        permissionMode: 'manual',
      }),
    ).toBe(true);
    expect(
      shouldBlockScopeEscapeQuestion({
        permissionMode: 'auto',
        goalStatus: null,
      }),
    ).toBe(true);
    expect(
      shouldBlockScopeEscapeQuestion({
        permissionMode: 'manual',
        goalStatus: 'paused',
      }),
    ).toBe(false);
  });
});
