import { createUserMessage } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import { buildEmergencyBackstopSummary } from '../../../src/agent/compaction/backstop';
import { CONTEXT_COMPACTION_V2_VERSION } from '../../../src/agent/compaction/planner';

describe('buildEmergencyBackstopSummary', () => {
  it('preserves structured continuity fields and an extractive transcript', () => {
    const messages = [
      createUserMessage('Fix compaction in apps/liora/src/tui/foo.ts'),
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'I decided to inspect full.ts first.' }],
        toolCalls: [],
      },
      {
        role: 'assistant' as const,
        content: [],
        toolCalls: [
          {
            type: 'function' as const,
            id: 'call_1',
            name: 'Read',
            arguments: '{"path":"packages/agent-core/src/agent/compaction/full.ts"}',
          },
        ],
      },
      {
        role: 'tool' as const,
        content: [{ type: 'text' as const, text: 'Error: APIEmptyResponseError during compaction' }],
        toolCalls: [],
        toolCallId: 'call_1',
      },
    ];
    const plan = {
      algorithmVersion: CONTEXT_COMPACTION_V2_VERSION,
      compactedCount: messages.length,
      compactedTokens: 1200,
      retainedTokens: 300,
      actions: [],
      rawRefs: [
        {
          kind: 'tool_exchange' as const,
          messageStart: 2,
          messageEnd: 3,
          tokens: 400,
        },
      ],
      qualityWarnings: [],
    };

    const summary = buildEmergencyBackstopSummary(messages, plan, 'Focus on root cause');

    expect(summary).toContain('current_goal:');
    expect(summary).toContain('Fix compaction in apps/liora/src/tui/foo.ts');
    expect(summary).toContain('files_touched:');
    expect(summary).toContain('foo.ts');
    expect(summary).toContain('failed_attempts:');
    expect(summary).toContain('APIEmptyResponseError');
    expect(summary).toContain('next_actions:');
    expect(summary).toContain('raw_refs:');
    expect(summary).toContain('tool_exchange');
    expect(summary).toContain('Emergency extractive transcript');
  });
});
