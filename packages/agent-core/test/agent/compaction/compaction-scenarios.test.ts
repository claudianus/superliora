// Compaction scenario + probe tests.
//
// Two kinds of tests live here:
//   * GUARD tests lock in behavior we rely on (so future refactors can't
//     silently regress it).
//   * PROBE tests exercise the high-risk scenarios surfaced in review and in
//     our own audit, asserting the DESIRED behavior. Each probe is a live
//     regression guard: the suite must fail while the behavior is broken.
//
// Compaction is a hot path, so these intentionally drive the real
// Agent/ContextMemory/FullCompaction machinery through the test harness rather
// than mocking it.
import type { ContentPart, Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import type { AgentOptions } from '../../../src/agent';
import { COMPACTION_ELISION_VARIANT, COMPACTION_SUMMARY_PREFIX } from '../../../src/agent/compaction';
import type { AgentRecord } from '../../../src/agent';
import {
  AGENT_WIRE_PROTOCOL_VERSION,
  InMemoryAgentRecordPersistence,
} from '../../../src/agent/records';
import type { ContextMessage } from '../../../src/agent/context';
import { testAgent, type TestAgentContext } from '../harness/agent';

type GenerateFn = NonNullable<AgentOptions['generate']>;

const PROVIDER = { type: 'kimi', apiKey: 'test-key', model: 'superliora' } as const;
const CAPS = {
  image_in: true,
  video_in: true,
  audio_in: false,
  pdf_in: false,
  thinking: true,
  tool_use: true,
  max_context_tokens: 256_000,
} as const;

function textResult(text: string): Awaited<ReturnType<GenerateFn>> {
  return {
    id: 'mock-compaction-summary',
    message: { role: 'assistant', content: [{ type: 'text', text }], toolCalls: [] },
    usage: { inputOther: 1, output: 1, inputCacheRead: 0, inputCacheCreation: 0 },
    finishReason: 'completed',
    rawFinishReason: 'stop',
  };
}
