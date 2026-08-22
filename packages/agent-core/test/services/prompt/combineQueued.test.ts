import { describe, expect, it } from 'vitest';

import {
  COMBINED_PROMPT_SEPARATOR,
  combinePromptPrefixLen,
  mergePromptStates,
  promptStateToCombineGate,
} from '#/services/prompt/combineQueued';
import type { PromptState } from '#/services/prompt/promptState';

function state(over: Partial<PromptState> & { text?: string; images?: boolean }): PromptState {
  const text = over.text ?? 'hi';
  return {
    agentId: 'main',
    promptId: over.promptId ?? 'p1',
    userMessageId: over.userMessageId ?? 'u1',
    createdAt: over.createdAt ?? '2026-01-01T00:00:00.000Z',
    turnId: null,
    completed: false,
    aborted: false,
    ...over,
    body: over.body ?? {
      content: [
        { type: 'text', text },
        ...(over.images === true
          ? [{ type: 'image' as const, source: { kind: 'url' as const, url: 'https://example.com/a.png' } }]
          : []),
      ],
    },
  };
}

describe('promptStateToCombineGate', () => {
  it('treats !bash and non-main agents as ineligible', () => {
    expect(promptStateToCombineGate(state({ text: '!ls' })).isBash).toBe(true);
    expect(promptStateToCombineGate(state({ agentId: 'agent_btw', text: 'x' })).isPlainPrompt).toBe(
      false,
    );
  });
});

describe('combinePromptPrefixLen', () => {
  it('merges adjacent plain prompts and stops at bash', () => {
    expect(combinePromptPrefixLen([state({ text: 'one' }), state({ text: 'two' })])).toBe(2);
    expect(
      combinePromptPrefixLen([state({ text: 'one' }), state({ text: '!ls' }), state({ text: 'two' })]),
    ).toBe(1);
  });

  it('lets the front keep images and stops at an image follower', () => {
    expect(combinePromptPrefixLen([state({ text: 'see', images: true }), state({ text: 'two' })])).toBe(
      2,
    );
    expect(combinePromptPrefixLen([state({ text: 'one' }), state({ text: 'see', images: true })])).toBe(
      1,
    );
  });
});

describe('mergePromptStates', () => {
  it('joins text and keeps the front image parts', () => {
    const merged = mergePromptStates([
      state({ promptId: 'a', text: 'one', images: true }),
      state({ promptId: 'b', text: 'two' }),
    ]);
    expect(merged.promptId).toBe('a');
    expect(merged.body.content[0]).toEqual({
      type: 'text',
      text: `one${COMBINED_PROMPT_SEPARATOR}two`,
    });
    expect(merged.body.content.some((part) => part.type === 'image')).toBe(true);
  });
});
