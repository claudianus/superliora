import { describe, expect, it, vi } from 'vitest';

import { FlagResolver } from '../../src/flags/resolver';
import {
  confirmAutoSplitIntents,
  confirmGreenfieldBrief,
  greenfieldBriefAskTemplate,
  greenfieldBriefMissing,
  mergeSplitIntents,
} from '../../src/tools/builtin/job/job-interactive-confirm';
import type { Agent } from '../../src/agent/index';

function mockAgent(opts: {
  readonly uxV2?: boolean;
  readonly answerLabel?: string;
}): Agent {
  const flags = new FlagResolver(
    opts.uxV2 === false
      ? { SUPERLIORA_EXPERIMENTAL_CONDUCTOR_UX_V2: 'false' }
      : {},
  );
  return {
    experimentalFlags: flags,
    rpc: {
      requestQuestion: vi.fn(async () => ({
        answers: { q: opts.answerLabel ?? 'Keep all (Recommended)' },
      })),
    },
  } as unknown as Agent;
}

describe('job-interactive-confirm', () => {
  it('greenfieldBriefMissing lists empty slots', () => {
    expect(
      greenfieldBriefMissing({
        successCriteria: [],
        mustNotTouch: [],
        verificationCommands: [],
      }),
    ).toHaveLength(2);
    expect(
      greenfieldBriefAskTemplate({
        successCriteria: [],
        mustNotTouch: ['none'],
        verificationCommands: [],
      }),
    ).toContain('success criteria');
  });

  it('confirmAutoSplitIntents keeps when fewer than 3 intents', async () => {
    const decision = await confirmAutoSplitIntents(mockAgent({}), [
      { title: 'A', prompt: 'A' },
      { title: 'B', prompt: 'B' },
    ]);
    expect(decision).toBe('keep');
  });

  it('confirmAutoSplitIntents asks and honors merge/cancel', async () => {
    const merge = await confirmAutoSplitIntents(
      mockAgent({ answerLabel: 'Merge into one' }),
      [
        { title: 'A', prompt: 'do A' },
        { title: 'B', prompt: 'do B' },
        { title: 'C', prompt: 'do C' },
      ],
    );
    expect(merge).toBe('merge');

    const cancel = await confirmAutoSplitIntents(
      mockAgent({ answerLabel: 'Cancel' }),
      [
        { title: 'A', prompt: 'do A' },
        { title: 'B', prompt: 'do B' },
        { title: 'C', prompt: 'do C' },
      ],
    );
    expect(cancel).toBe('cancel');
  });

  it('confirmAutoSplitIntents passthrough when UX v2 off', async () => {
    const decision = await confirmAutoSplitIntents(
      mockAgent({ uxV2: false, answerLabel: 'Cancel' }),
      [
        { title: 'A', prompt: 'do A' },
        { title: 'B', prompt: 'do B' },
        { title: 'C', prompt: 'do C' },
      ],
    );
    expect(decision).toBe('keep');
  });

  it('mergeSplitIntents joins prompts', () => {
    const merged = mergeSplitIntents(
      [
        { title: 'A', prompt: 'do A' },
        { title: 'B', prompt: 'do B' },
      ],
      'Batch',
    );
    expect(merged.title).toBe('Batch');
    expect(merged.prompt).toContain('do A');
    expect(merged.prompt).toContain('do B');
  });

  it('confirmGreenfieldBrief fills missing slots from answers', async () => {
    const agent = mockAgent({ answerLabel: 'Ship runnable MVP (Recommended)' });
    // First question only when successCriteria missing; fence uses second call path —
    // mock returns same label for all; "Nothing off-limits" needed for fence.
    let call = 0;
    agent.rpc!.requestQuestion = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          answers: {
            q0: 'Ship runnable MVP (Recommended)',
            q1: 'Nothing off-limits (Recommended)',
          },
        };
      }
      return { answers: { q: 'Nothing off-limits (Recommended)' } };
    });

    const filled = await confirmGreenfieldBrief(agent, {
      successCriteria: [],
      mustNotTouch: [],
      verificationCommands: [],
    });
    expect(filled?.successCriteria[0]).toContain('Ship runnable MVP');
    expect(filled?.mustNotTouch).toEqual(['none']);
  });
});
