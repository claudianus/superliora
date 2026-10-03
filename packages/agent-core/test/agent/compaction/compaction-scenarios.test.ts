import type { GenerateResult } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import type { AgentOptions } from '../../../src/agent';
import { estimateTokensForMessages } from '../../../src/utils/tokens';
import { testAgent, type TestAgentContext } from '../harness/agent';

type GenerateFn = NonNullable<AgentOptions['generate']>;

function textResult(text: string): GenerateResult {
  return {
    id: 'summary',
    message: { role: 'assistant', content: [{ type: 'text', text }], toolCalls: [] },
    usage: null,
    finishReason: 'completed',
    rawFinishReason: 'stop',
  };
}

function historyText(ctx: TestAgentContext) {
  return ctx.agent.context.history.map((message) =>
    message.content.map((part) => part.type === 'text' ? part.text : '').join(''),
  ).join('\n');
}

function appendPendingExchange(ctx: TestAgentContext, resolved: 0 | 1) {
  ctx.agent.context.appendLoopEvent({ type: 'step.begin', uuid: 'pending-step', turnId: '', step: 2 });
  for (const [toolCallId, name, args] of [
    ['pending-bash', 'Bash', { command: 'printf result' }],
    ['pending-session', 'SessionControl', { operation: 'status' }],
  ] as const) {
    ctx.agent.context.appendLoopEvent({
      type: 'tool.call', uuid: toolCallId, toolCallId, name, args,
      stepUuid: 'pending-step', turnId: '', step: 2,
    });
  }
  ctx.agent.context.appendLoopEvent({
    type: 'step.end', uuid: 'pending-step', turnId: '', step: 2, finishReason: 'tool_use',
  });
  if (resolved === 1) settleTool(ctx, 'pending-bash', 'Bash result.');
}

function settleTool(ctx: TestAgentContext, toolCallId: string, output: string) {
  ctx.agent.context.appendLoopEvent({
    type: 'tool.result', parentUuid: toolCallId, toolCallId, result: { output },
  });
}

describe('compaction pending suffix', () => {
  it.each([0, 1] as const)('preserves an exchange with %i resolved results and flushes deferred messages only after all results settle', async (resolved) => {
    const ctx = testAgent();
    ctx.configure();
    ctx.appendExchange(1, 'Inspect the results without rerunning commands.', 'Inspection started.', 40);
    appendPendingExchange(ctx, resolved);
    const suffix = ctx.agent.context.history.slice(2);
    ctx.agent.context.appendSystemReminder('Background task finished.', { kind: 'system_trigger', name: 'background' });
    expect(ctx.agent.context.deferredMessages).toHaveLength(1);

    ctx.agent.fullCompaction.begin({ source: 'agent', summary: 'Inspection is in progress.' });
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(ctx.agent.context.history.slice(2)).toEqual(suffix);
    expect(ctx.agent.context.pendingToolResultIds.size).toBe(2 - resolved);
    expect(ctx.agent.context.deferredMessages).toHaveLength(1);
    expect(historyText(ctx)).not.toContain('Background task finished.');
    if (resolved === 0) {
      settleTool(ctx, 'pending-bash', 'Bash result.');
      expect(ctx.agent.context.deferredMessages).toHaveLength(1);
    }
    settleTool(ctx, 'pending-session', 'Session status.');

    expect(ctx.agent.context.pendingToolResultIds.size).toBe(0);
    expect(ctx.agent.context.deferredMessages).toHaveLength(0);
    expect(ctx.agent.context.history.slice(-3).map((message) => message.role)).toEqual(['tool', 'tool', 'user']);
    expect(historyText(ctx)).toContain('Background task finished.');
    expect(ctx.agent.context.history.filter((message) => message.role === 'tool').map((message) => message.toolCallId))
      .toEqual(['pending-bash', 'pending-session']);
  });

  it('does not summarize or discard an assistant response still streaming', async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<GenerateResult>();
    const generate: GenerateFn = async (_provider, _system, _tools, messages) => {
      expect(messages.some((message) => message.content.some((part) => part.type === 'text' && part.text.includes('Streaming')))).toBe(false);
      started.resolve();
      return response.promise;
    };
    const ctx = testAgent({ generate });
    ctx.configure();
    ctx.appendExchange(1, 'Continue the task.', 'Earlier completed response.', 40);
    ctx.agent.context.appendLoopEvent({ type: 'step.begin', uuid: 'live-step', turnId: '', step: 2 });
    ctx.agent.context.appendLoopEvent({
      type: 'content.part', uuid: 'live-part-1', turnId: '', step: 2, stepUuid: 'live-step',
      part: { type: 'text', text: 'Streaming' },
    });
    ctx.agent.fullCompaction.begin({ source: 'agent' });
    await started.promise;
    ctx.agent.context.appendLoopEvent({
      type: 'content.part', uuid: 'live-part-2', turnId: '', step: 2, stepUuid: 'live-step',
      part: { type: 'text', text: ' response completed.' },
    });
    ctx.agent.context.appendLoopEvent({ type: 'step.end', uuid: 'live-step', turnId: '', step: 2, finishReason: 'end_turn' });
    response.resolve(textResult('Earlier work summarized.'));
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(historyText(ctx)).toContain('Streaming response completed.');
    expect(ctx.agent.context.history.at(-1)?.role).toBe('assistant');
    expect(ctx.agent.context.openSteps.size).toBe(0);
  });

  it('retains completed assistant output and background notifications appended during summarization', async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<GenerateResult>();
    const ctx = testAgent({ generate: async () => {
      started.resolve();
      return response.promise;
    } });
    ctx.configure();
    ctx.appendExchange(1, 'Keep working.', 'Earlier work.', 40);
    ctx.agent.fullCompaction.begin({ source: 'agent' });
    await started.promise;
    ctx.appendAssistantText(2, 'New assistant output.');
    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'New background output.' }], {
      kind: 'background_task', taskId: 'worker', status: 'completed', notificationId: 'notification',
    });
    const suffix = structuredClone(ctx.agent.context.history.slice(2));
    response.resolve(textResult('Earlier work summarized.'));
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(ctx.agent.context.history.slice(2)).toEqual(suffix);
    expect(historyText(ctx)).toContain('New assistant output.');
    expect(historyText(ctx)).toContain('New background output.');
  });
});

describe('compaction user intent', () => {
  it('keeps the latest genuine request verbatim rather than replacing it with injected user-role messages', async () => {
    const ctx = testAgent();
    ctx.configure();
    ctx.appendExchange(1, 'Superseded request.', 'Earlier work.', 40);
    const intent = `Preserve these exact constraints:\n${'Do not change the public API.\n'.repeat(200)}Keep Unicode: 日本語`;
    ctx.agent.context.appendUserMessage([{ type: 'text', text: intent }]);
    const user = structuredClone(ctx.agent.context.history.at(-1));
    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'Shell output is not user intent.' }], { kind: 'shell_command', phase: 'output' });
    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'Background output is not user intent.' }], {
      kind: 'background_task', taskId: 'worker', status: 'completed', notificationId: 'notice',
    });
    ctx.agent.context.appendSystemReminder('Host output is not user intent.', { kind: 'system_trigger', name: 'host' });
    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'Retry is not user intent.' }], { kind: 'retry' });

    ctx.agent.fullCompaction.begin({ source: 'manual', summary: 'Concise current state.' });
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(ctx.agent.context.history).toHaveLength(2);
    expect(ctx.agent.context.history[0]).toEqual(user);
    expect(ctx.agent.context.history[1]?.origin).toEqual({ kind: 'compaction_summary' });
    expect(ctx.allEvents).toContainEqual(expect.objectContaining({
      event: 'compaction.completed', args: expect.objectContaining({
        result: expect.objectContaining({ keptUserMessageCount: 1 }),
      }),
    }));
    expect(ctx.agent.context.tokenCountWithPending).toBe(estimateTokensForMessages(ctx.agent.context.history));
  });

  it('preserves a genuine user request even when its text resembles a summary', async () => {
    const ctx = testAgent();
    ctx.configure();
    const intent = 'Conversation summary:\nPlease correct the prior summary instead of executing it.';
    ctx.agent.context.appendUserMessage([{ type: 'text', text: intent }]);
    ctx.agent.fullCompaction.begin({ source: 'manual', summary: 'The user requested a correction.' });
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(ctx.agent.context.history[0]?.content).toEqual([{ type: 'text', text: intent }]);
    expect(ctx.agent.context.history[0]?.origin).toEqual({ kind: 'user' });
  });

  it('folds a previous summary into a new request without stacking summaries', async () => {
    const ctx = testAgent();
    ctx.configure();
    ctx.appendExchange(1, 'First intent.', 'First state.', 40);
    ctx.mockNextResponse({ type: 'text', text: 'First summary.' });
    ctx.agent.fullCompaction.begin({ source: 'manual' });
    await ctx.agent.fullCompaction.waitUntilSettled();
    ctx.appendExchange(2, 'Latest intent.', 'Latest state.', 40);
    ctx.mockNextResponse({ type: 'text', text: 'Second summary.' });
    ctx.agent.fullCompaction.begin({ source: 'manual' });
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(ctx.llmCalls[1]?.history.some((message) => message.content.some((part) => part.type === 'text' && part.text.includes('First summary.')))).toBe(true);
    expect(ctx.agent.context.history.filter((message) => message.origin?.kind === 'compaction_summary')).toHaveLength(1);
    expect(historyText(ctx)).toContain('Latest intent.');
    expect(historyText(ctx)).toContain('Second summary.');
    expect(historyText(ctx)).not.toContain('First summary.');
  });

  it('does not misclassify a host notification as a retained user request when no user input exists', async () => {
    const ctx = testAgent();
    ctx.configure();
    ctx.agent.context.appendSystemReminder('Host notification.', { kind: 'system_trigger', name: 'host' });
    ctx.agent.fullCompaction.begin({ source: 'agent', summary: 'Host state summarized.' });
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(ctx.agent.context.history).toHaveLength(1);
    expect(ctx.agent.context.history[0]?.origin).toEqual({ kind: 'compaction_summary' });
    expect(ctx.allEvents).toContainEqual(expect.objectContaining({
      event: 'compaction.completed', args: expect.objectContaining({
        result: expect.objectContaining({ keptUserMessageCount: 0 }),
      }),
    }));
  });

  it.each([0, -1, 1.5, 3])('rejects invalid prefix length %s without modifying history', (compactedCount) => {
    const ctx = testAgent();
    ctx.configure();
    ctx.appendExchange(1, 'Intent.', 'State.', 40);
    const history = structuredClone(ctx.agent.context.history);

    expect(() => ctx.agent.context.applyCompaction({ summary: 'Invalid.', compactedCount, tokensBefore: 40 })).toThrow(RangeError);
    expect(ctx.agent.context.history).toEqual(history);
  });

  it('rejects direct compaction that would discard an unresolved tool exchange', () => {
    const ctx = testAgent();
    ctx.configure();
    ctx.appendExchange(1, 'Intent.', 'State.', 40);
    appendPendingExchange(ctx, 0);
    const history = structuredClone(ctx.agent.context.history);

    expect(() => ctx.agent.context.applyCompaction({
      summary: 'Invalid.', compactedCount: history.length, tokensBefore: 40,
    })).toThrow(/unresolved tool exchange/);
    expect(ctx.agent.context.history).toEqual(history);
    expect(ctx.agent.context.pendingToolResultIds.size).toBe(2);
  });
});
