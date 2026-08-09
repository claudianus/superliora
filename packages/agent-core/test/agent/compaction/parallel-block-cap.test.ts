import type { Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import {
  MAX_PARALLEL_SUMMARY_BLOCKS,
  splitIntoBlocks,
} from '../../../src/agent/compaction/pipeline/summarize';
import type { CompactionPipelineContext } from '../../../src/agent/compaction/pipeline/types';

function msg(text: string, role: Message['role'] = 'user'): Message {
  return { role, content: [{ type: 'text', text }], toolCalls: [] };
}

describe('splitIntoBlocks parallel fan-out cap', () => {
  it('grows the token target so huge prefixes stay within MAX_PARALLEL_SUMMARY_BLOCKS', () => {
    // Many small exchanges: a 5k target would otherwise emit far more than 24 blocks.
    const messages: Message[] = [];
    for (let i = 0; i < 200; i++) {
      messages.push(msg(`user ${String(i)} ${'x'.repeat(800)}`));
      messages.push(msg(`assistant ${String(i)} ${'y'.repeat(800)}`, 'assistant'));
    }
    const ctx = {
      strategy: {
        parallelBlockTarget: 1_000,
      },
    } as unknown as CompactionPipelineContext;

    const blocks = splitIntoBlocks(ctx, messages);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.length).toBeLessThanOrEqual(MAX_PARALLEL_SUMMARY_BLOCKS);
  });
});
