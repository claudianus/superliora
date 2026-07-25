import { describe, expect, it } from 'vitest';

import {
  CodeReviewTool,
  createLioraReviewTool,
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
