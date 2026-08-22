import { describe, expect, it } from 'vitest';

import {
  COMBINED_QUEUE_SEPARATOR,
  combineQueuedPrefixLen,
  joinQueuedTexts,
  stampCombinedDisplayTexts,
  type CombineQueuedGate,
} from '#/tui/features/transcript/combine-queued';

function plain(text: string, extra: Partial<CombineQueuedGate> = {}): CombineQueuedGate {
  return {
    isPlainPrompt: true,
    isBash: false,
    hasImages: false,
    text,
    ...extra,
  };
}

describe('combineQueuedPrefixLen', () => {
  it('merges a run of plain prompts', () => {
    expect(combineQueuedPrefixLen([plain('one'), plain('two'), plain('three')])).toBe(3);
  });

  it('stops at bash, images (followers), and expanded skills', () => {
    expect(
      combineQueuedPrefixLen([
        plain('one'),
        plain('two'),
        plain('ls', { isBash: true }),
        plain('three'),
      ]),
    ).toBe(2);
    expect(combineQueuedPrefixLen([plain('one'), plain('see', { hasImages: true })])).toBe(1);
    expect(combineQueuedPrefixLen([plain('see', { hasImages: true }), plain('two')])).toBe(2);
    expect(combineQueuedPrefixLen([plain('one'), plain('body', { isExpandedSkill: true })])).toBe(1);
  });

  it('takes an ineligible front alone', () => {
    expect(combineQueuedPrefixLen([plain('ls', { isBash: true }), plain('x')])).toBe(1);
    expect(combineQueuedPrefixLen([])).toBe(0);
  });
});

describe('joinQueuedTexts', () => {
  it('joins with a blank line and drops empties', () => {
    expect(joinQueuedTexts(['one', '', 'two'])).toBe(`one${COMBINED_QUEUE_SEPARATOR}two`);
  });
});

describe('stampCombinedDisplayTexts', () => {
  it('stamps only when at least two non-empty prompts were merged', () => {
    expect(stampCombinedDisplayTexts(['one', 'two'])).toEqual(['one', 'two']);
    expect(stampCombinedDisplayTexts(['one', '', 'two'])).toEqual(['one', 'two']);
    expect(stampCombinedDisplayTexts(['one'])).toBeUndefined();
    expect(stampCombinedDisplayTexts(['', ''])).toBeUndefined();
  });
});
