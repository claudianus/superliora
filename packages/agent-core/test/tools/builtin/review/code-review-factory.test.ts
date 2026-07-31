import { describe, expect, it } from 'vitest';

import {
  CodeReviewTool,
  ReviewTool,
  createLioraReviewTool,
  createReviewTool,
} from '../../../../src/tools/builtin/review/code-review';

describe('createLioraReviewTool', () => {
  it('registers tool name LioraReview', () => {
    const kaos = {} as any;
    const agent = {} as any;
    const tool = createLioraReviewTool(kaos, agent);
    expect(tool).toBeInstanceOf(CodeReviewTool);
    expect(tool.name).toBe('LioraReview');
  });
});

describe('createReviewTool', () => {
  it('registers sovereign tool name Review', () => {
    const kaos = {} as any;
    const agent = {} as any;
    const tool = createReviewTool(kaos, agent);
    expect(tool).toBeInstanceOf(ReviewTool);
    expect(tool.name).toBe('Review');
  });
});
