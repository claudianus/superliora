import { describe, expect, it } from 'vitest';

import { setCliLocale } from '#/cli/i18n';
import {
  enrichReviseFeedbackWithLineComment,
  formatNumberedPlanPreview,
  formatPlanLineCommentFeedback,
  numberPlanLines,
  parsePlanLineComment,
} from '#/tui/utils/plan-line-comments';

describe('numberPlanLines', () => {
  it('numbers 1-based lines and trims trailing blanks', () => {
    const lines = numberPlanLines('alpha\nbeta\n\n');
    expect(lines).toEqual([
      { number: 1, text: 'alpha' },
      { number: 2, text: 'beta' },
    ]);
  });
});

describe('formatNumberedPlanPreview', () => {
  it('renders gutter numbers for operator review', () => {
    const preview = formatNumberedPlanPreview('# Plan\n\n1. Land bridge');
    expect(preview).toContain('1│');
    expect(preview).toContain('# Plan');
    expect(preview).toContain('Land bridge');
  });

  it('shows empty plan label in Korean', () => {
    setCliLocale('ko');
    expect(formatNumberedPlanPreview('')).toBe('(빈 계획)');
  });
});

describe('parsePlanLineComment', () => {
  it('parses L12: comment form', () => {
    expect(parsePlanLineComment('L12: fix auth first')).toEqual({
      line: 12,
      comment: 'fix auth first',
    });
  });

  it('parses Korean 라인 prefix', () => {
    expect(parsePlanLineComment('라인 3 경로 검증 추가')).toEqual({
      line: 3,
      comment: '경로 검증 추가',
    });
  });

  it('returns null for plain feedback without line', () => {
    expect(parsePlanLineComment('다시 짜 주세요')).toBeNull();
  });
});

describe('formatPlanLineCommentFeedback + enrich', () => {
  it('never emits an approve token — revise feedback only', () => {
    setCliLocale('ko');
    const feedback = formatPlanLineCommentFeedback(
      { line: 2, comment: 'deny rules first' },
      '- Apply edits',
    );
    expect(feedback).toContain('라인 2 코멘트');
    expect(feedback).toContain('deny rules first');
    expect(feedback.toLowerCase()).not.toContain('approve');
  });

  it('enriches revise feedback when line reference present', () => {
    setCliLocale('ko');
    const plan = '## Plan\n1. Inspect\n2. Change';
    const out = enrichReviseFeedbackWithLineComment('L2: keep inspect', plan);
    expect(out).toContain('라인 2');
    expect(out).toContain('keep inspect');
  });
});
