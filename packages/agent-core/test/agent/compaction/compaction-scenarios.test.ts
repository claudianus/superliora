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

function historyTexts(ctx: TestAgentContext): string[] {
  return ctx.agent.context.history.map((message) =>
    message.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join(''),
  );
}

function summaryMessageText(ctx: TestAgentContext): string {
  const summary = ctx.agent.context.history.find(
    (message) => message.origin?.kind === 'compaction_summary',
  );
  return summary?.content.map((part) => (part.type === 'text' ? part.text : '')).join('') ?? '';
}

describe('compaction — guard tests', () => {
  it('repeated compaction folds the prior summary into the new one, never stacking two summaries', async () => {
    const ctx = testAgent();
    ctx.configure({ provider: PROVIDER, modelCapabilities: CAPS });
    ctx.appendExchange(1, 'user one', 'assistant one', 40);

    ctx.mockNextResponse({ type: 'text', text: 'First summary.' });
    await ctx.rpc.beginCompaction({});
    await ctx.once('compaction.completed');

    ctx.appendExchange(2, 'user two', 'assistant two', 40);
    ctx.mockNextResponse({ type: 'text', text: 'Second summary.' });
    await ctx.rpc.beginCompaction({});
    await ctx.once('compaction.completed');

    const summaries = ctx.agent.context.history.filter(
      (message) => message.origin?.kind === 'compaction_summary',
    );
    // Exactly one summary survives; the first was re-summarized, not carried.
    expect(summaries).toHaveLength(1);
    expect(summaryMessageText(ctx)).toContain('Second summary.');
    expect(historyTexts(ctx).join('\n')).not.toContain('First summary.');
  });

  it('closes a dangling tool_use in the compaction summary request via synthesizeMissing', async () => {
    // Full compaction projects its summarizer input with { synthesizeMissing: true }
    // so an unresolved tool_use (whose result is sliced out / not yet recorded)
    // is answered by a synthetic tool_result — keeping the summary request
    // well-formed for strict providers instead of 400-ing on a dangling call.
    let summarizerMessages: Message[] | undefined;
    const capture: GenerateFn = async (_provider, _system, _tools, messages) => {
      summarizerMessages = messages;
      return textResult('Compacted summary.');
    };
    const ctx = testAgent({ generate: capture });
    ctx.configure({ provider: PROVIDER, modelCapabilities: CAPS });
    ctx.appendUnresolvedToolExchange(0); // assistant with 2 tool calls, no results

    await ctx.rpc.beginCompaction({});
    await ctx.once('compaction.completed');

    const msgs = summarizerMessages ?? [];
    const assistantIndex = msgs.findIndex(
      (message) => message.role === 'assistant' && message.toolCalls.length > 0,
    );
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    for (const toolCall of msgs[assistantIndex]!.toolCalls) {
      const answered = msgs
        .slice(assistantIndex + 1)
        .some((message) => message.role === 'tool' && message.toolCallId === toolCall.id);
      expect(answered).toBe(true);
    }
  });

  // Mutual exclusion: compaction and turn processing must not run concurrently,
  // or a turn mutating the context mid-summary loses output. Auto compaction is
  // structurally safe (it runs while the turn blocks at a step boundary); the
  // manual/SDK path is guarded explicitly here.
  it('rejects a manual compaction while a turn is active', async () => {
    const ctx = testAgent();
    ctx.configure({ provider: PROVIDER, modelCapabilities: CAPS });
    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'seed' }], { kind: 'user' });
    ctx.mockNextResponse({ type: 'text', text: 'turn done' });

    // launch() sets the active turn synchronously, so a turn is active before the
    // worker yields — exactly the window an SDK beginCompaction could land in.
    ctx.agent.turn.prompt([{ type: 'text', text: 'go' }]);
    expect(ctx.agent.turn.hasActiveTurn).toBe(true);

    await expect(ctx.rpc.beginCompaction({})).rejects.toThrow(/turn/i);

    await ctx.agent.turn.waitForCurrentTurn();
  });

  it('defers a prompt submitted during compaction and runs it afterward', async () => {
    const ctx = testAgent();
    ctx.configure({ provider: PROVIDER, modelCapabilities: CAPS });
    ctx.appendExchange(1, 'user one', 'assistant one', 40);
    ctx.mockNextResponse({ type: 'text', text: 'Compacted summary.' });
    ctx.mockNextResponse({ type: 'text', text: 'answer to the deferred prompt' });

    // begin() sets the compacting flag synchronously before the summarizer yields.
    void ctx.rpc.beginCompaction({});
    expect(ctx.agent.fullCompaction.isCompacting).toBe(true);

    // A prompt arriving mid-compaction is buffered (deferred), not rejected: null
    // means "not launched now", and it must run once compaction finishes.
    const turnId = ctx.agent.turn.prompt([{ type: 'text', text: 'DEFERRED-PROMPT' }]);
    expect(turnId).toBeNull();

    await ctx.once('compaction.completed');
    await ctx.agent.turn.waitForCurrentTurn();

    // Ran after compaction — neither lost nor stuck.
    expect(historyTexts(ctx).join('\n')).toContain('DEFERRED-PROMPT');
  });

  it('defers a steer arriving during compaction and delivers it afterward', async () => {
    const ctx = testAgent();
    ctx.configure({ provider: PROVIDER, modelCapabilities: CAPS });
    ctx.appendExchange(1, 'user one', 'assistant one', 40);
    ctx.mockNextResponse({ type: 'text', text: 'Compacted summary.' });
    ctx.mockNextResponse({ type: 'text', text: 'handled the steer' });

    void ctx.rpc.beginCompaction({});
    expect(ctx.agent.fullCompaction.isCompacting).toBe(true);

    // A background-task/cron steer mid-compaction must be buffered (null = buffered,
    // which is exactly what those fire-and-forget callers assume), not dropped.
    const turnId = ctx.agent.turn.steer([{ type: 'text', text: 'DEFERRED-STEER' }], {
      kind: 'background_task',
      taskId: 't',
      status: 'completed',
      notificationId: 'n',
    });
    expect(turnId).toBeNull();

    await ctx.once('compaction.completed');
    await ctx.agent.turn.waitForCurrentTurn();

    expect(historyTexts(ctx).join('\n')).toContain('DEFERRED-STEER');
  });
});
