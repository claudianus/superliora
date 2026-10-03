import { tmpdir } from 'node:os';
import { join } from 'pathe';

import type { Message } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRecord } from '../../src/agent';
import type { ContextMessage } from '../../src/agent/context';
import {
  AGENT_WIRE_PROTOCOL_VERSION,
  InMemoryAgentRecordPersistence,
} from '../../src/agent/records';
import { estimateTokensForMessages } from '../../src/utils/tokens';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';
import { testAgent } from './harness/agent';

const configRecord: AgentRecord = {
  type: 'config.update', cwd: process.cwd(), modelAlias: 'mock-model',
  systemPrompt: 'Native resume test prompt.', thinkingLevel: 'off',
};

function textContent(message: Message): string {
  return message.content.map((part) => part.type === 'text' ? part.text : '').join('');
}

function userMessage(text: string): ContextMessage {
  return { role: 'user', content: [{ type: 'text', text }], toolCalls: [], origin: { kind: 'user' } };
}

function loopEventsForTurn(turnId: string, text: string): AgentRecord[] {
  return [
    { type: 'context.append_loop_event', event: { type: 'step.begin', uuid: `step-${turnId}`, turnId, step: 1 } },
    {
      type: 'context.append_loop_event',
      event: { type: 'content.part', uuid: `content-${turnId}`, turnId, step: 1, stepUuid: `step-${turnId}`, part: { type: 'text', text } },
    },
    {
      type: 'context.append_loop_event',
      event: { type: 'step.end', uuid: `step-${turnId}`, turnId, step: 1, usage: { inputOther: 5, output: 2, inputCacheRead: 0, inputCacheCreation: 0 }, finishReason: 'end_turn' },
    },
    { type: 'usage.record', model: 'mock-model', usage: { inputOther: 5, output: 2, inputCacheRead: 0, inputCacheCreation: 0 } },
  ];
}

function promptedTurn(turnId: string, prompt: string, response: string): AgentRecord[] {
  return [
    { type: 'turn.prompt', input: [{ type: 'text', text: prompt }], origin: { kind: 'user' } },
    { type: 'context.append_message', message: userMessage(prompt) },
    ...loopEventsForTurn(turnId, response),
  ];
}

class RecordingAgentPersistence extends InMemoryAgentRecordPersistence {
  readonly appended: AgentRecord[] = [];
  readonly rewrites: AgentRecord[][] = [];

  constructor(records: readonly AgentRecord[]) {
    super(records.length === 0 || records[0]?.type === 'metadata' ? records : [
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 }, ...records,
    ]);
  }

  override append(record: AgentRecord): void {
    this.appended.push(record);
    super.append(record);
  }

  override rewrite(records: readonly AgentRecord[]): void {
    this.rewrites.push([...records]);
    super.rewrite(records);
  }
}

function findRpcEvent(events: readonly { type: string; event: string; args: unknown }[], name: string) {
  return events.find((entry) => entry.type === '[rpc]' && entry.event === name);
}

describe('native Agent resume', () => {
  it('restores a deleted worktree cwd without attempting to enter it', async () => {
    const gone = join(tmpdir(), 'liora-missing-cwd-does-not-exist');
    const chdir = vi.fn(async () => { throw Object.assign(new Error(`ENOENT: ${gone}`), { code: 'ENOENT' }); });
    const persistence = new RecordingAgentPersistence([{ type: 'config.update', cwd: gone }]);
    const ctx = testAgent({ persistence, kaos: createFakeKaos({ getcwd: () => '/workspace', chdir }) });
    await ctx.agent.resume();
    expect(chdir).not.toHaveBeenCalled();
    expect(ctx.agent.config.cwd).toBe(gone);
    expect(ctx.agent.kaos.getcwd()).toBe(gone);
    expect(persistence.appended).toEqual([]);
  });

  it('restores settled native records without restarting turns, tools or explicit compaction', async () => {
    const persistence = new RecordingAgentPersistence([
      configRecord,
      { type: 'permission.set_mode', mode: 'yolo' },
      ...promptedTurn('0', 'Historical prompt', 'Historical response'),
      { type: 'full_compaction.begin', source: 'manual', instruction: 'retain operator intent' },
      { type: 'context.apply_compaction', summary: 'Historical facts', contextSummary: 'Retained historical facts', compactedCount: 2, tokensBefore: 7, tokensAfter: 0 },
      { type: 'full_compaction.complete' },
      { type: 'turn.cancel', turnId: 0, source: 'esc' },
    ]);
    const execWithEnv = vi.fn().mockRejectedValue(new Error('Bash must not execute on resume'));
    const ctx = testAgent({ persistence, kaos: createFakeKaos({ execWithEnv }) });
    const original = structuredClone(persistence.records);
    await ctx.agent.resume();
    expect(ctx.llmCalls).toEqual([]);
    expect(execWithEnv).not.toHaveBeenCalled();
    expect(ctx.allEvents).toEqual([]);
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
    expect(ctx.agent.permission.data()).toMatchObject({ mode: 'yolo' });
    expect(ctx.agent.context.history.map(textContent)).toEqual(['Historical prompt', 'Retained historical facts']);
    expect(persistence.appended).toEqual([]);
    expect(persistence.rewrites).toEqual([]);
    expect(persistence.records).toEqual(original);
    await ctx.expectResumeMatches();

    ctx.mockNextResponse({ type: 'text', text: 'Fresh response' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Fresh prompt' }] });
    await ctx.untilTurnEnd();
    expect(findRpcEvent(ctx.allEvents, 'turn.started')?.args).toMatchObject({ turnId: 1 });
    expect(findRpcEvent(ctx.allEvents, 'turn.ended')?.args).toMatchObject({ turnId: 1, reason: 'completed' });
    expect(ctx.llmCalls[0]!.history.slice(0, 3).map(textContent)).toEqual(['Historical prompt', 'Retained historical facts', 'Fresh prompt']);
    expect(execWithEnv).not.toHaveBeenCalled();
  });

  it('allocates turn IDs beyond multiple historical prompted turns', async () => {
    const persistence = new RecordingAgentPersistence([
      configRecord,
      ...promptedTurn('0', 'First prompt', 'First response'),
      ...promptedTurn('1', 'Second prompt', 'Second response'),
    ]);
    const ctx = testAgent({ persistence });
    await ctx.agent.resume();
    expect(ctx.agent.turn.currentId).toBe(1);
    ctx.mockNextResponse({ type: 'text', text: 'Fresh response' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Fresh prompt' }] });
    await ctx.untilTurnEnd();
    expect(findRpcEvent(ctx.allEvents, 'turn.started')?.args).toMatchObject({ turnId: 2 });
    expect(findRpcEvent(ctx.allEvents, 'turn.ended')?.args).toMatchObject({ turnId: 2, reason: 'completed' });
  });

  it('observes loop turn IDs even when a prompt record is absent', async () => {
    const persistence = new RecordingAgentPersistence([configRecord, ...loopEventsForTurn('7', 'Recorded child response')]);
    const ctx = testAgent({ persistence });
    await ctx.agent.resume();
    expect(ctx.agent.turn.currentId).toBe(7);
    expect(ctx.llmCalls).toEqual([]);
    ctx.mockNextResponse({ type: 'text', text: 'Fresh response' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Fresh prompt' }] });
    await ctx.untilTurnEnd();
    expect(findRpcEvent(ctx.allEvents, 'turn.started')?.args).toMatchObject({ turnId: 8 });
  });

  it('keeps turn IDs monotonic across successive cold resumes', async () => {
    const persistence = new RecordingAgentPersistence([configRecord, ...promptedTurn('0', 'Historical prompt', 'Historical response')]);
    const first = testAgent({ persistence });
    await first.agent.resume();
    first.mockNextResponse({ type: 'text', text: 'Cycle one response' });
    await first.rpc.prompt({ input: [{ type: 'text', text: 'Cycle one prompt' }] });
    await first.untilTurnEnd();
    expect(first.agent.turn.currentId).toBe(1);
    await first.agent.records.flush();
    const nextPersistence = new RecordingAgentPersistence(persistence.records);
    const second = testAgent({ persistence: nextPersistence });
    await second.agent.resume();
    expect(second.agent.turn.currentId).toBe(1);
    expect(nextPersistence.appended).toEqual([]);
    second.mockNextResponse({ type: 'text', text: 'Cycle two response' });
    await second.rpc.prompt({ input: [{ type: 'text', text: 'Cycle two prompt' }] });
    await second.untilTurnEnd();
    expect(findRpcEvent(second.allEvents, 'turn.started')?.args).toMatchObject({ turnId: 2 });
    expect(findRpcEvent(second.allEvents, 'turn.ended')?.args).toMatchObject({ turnId: 2, reason: 'completed' });
  });

  it('restores out-of-order parallel results before deferred native messages', async () => {
    const persistence = new RecordingAgentPersistence([
      configRecord,
      { type: 'context.append_message', message: userMessage('Historical native tool request') },
      { type: 'context.append_loop_event', event: { type: 'step.begin', uuid: 'parallel', turnId: '0', step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'tool.call', uuid: 'bash-call', turnId: '0', step: 1, stepUuid: 'parallel', toolCallId: 'bash-call', name: 'Bash', args: { command: 'pwd' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.call', uuid: 'session-call', turnId: '0', step: 1, stepUuid: 'parallel', toolCallId: 'session-call', name: 'SessionControl', args: { operation: 'list' } } },
      { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: 'Explicit operator note' }], toolCalls: [], origin: { kind: 'system_trigger', name: 'operator-note' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.result', parentUuid: 'session-call', toolCallId: 'session-call', result: { output: 'Recorded session list' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.result', parentUuid: 'bash-call', toolCallId: 'bash-call', result: { output: '/workspace' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', uuid: 'parallel', turnId: '0', step: 1, finishReason: 'tool_use' } },
    ]);
    const execWithEnv = vi.fn().mockRejectedValue(new Error('Historical Bash cannot run'));
    const ctx = testAgent({ persistence, kaos: createFakeKaos({ execWithEnv }) });
    await ctx.agent.resume();
    expect(ctx.agent.context.history.map((message) => [message.role, message.toolCallId])).toEqual([
      ['user', undefined], ['assistant', undefined], ['tool', 'session-call'], ['tool', 'bash-call'], ['user', undefined],
    ]);
    expect(textContent(ctx.agent.context.history[4]!)).toBe('Explicit operator note');
    expect(ctx.agent.context.messages.some((message) => 'origin' in message)).toBe(false);
    expect(persistence.appended).toEqual([]);
    expect(execWithEnv).not.toHaveBeenCalled();
    expect(ctx.llmCalls).toEqual([]);
    ctx.mockNextResponse({ type: 'text', text: 'Fresh response' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Fresh prompt' }] });
    await ctx.untilTurnEnd();
    expect(ctx.llmCalls[0]!.history.slice(0, 5).map(textContent)).toEqual(ctx.agent.context.messages.slice(0, 5).map(textContent));
    await ctx.expectResumeMatches();
  });

  it('projects a persisted explicit compaction without repinning token estimates', async () => {
    const persistence = new RecordingAgentPersistence([
      { type: 'context.append_message', message: userMessage('Historical prompt') },
      { type: 'full_compaction.begin', source: 'manual', instruction: 'preserve facts' },
      { type: 'context.apply_compaction', summary: 'Historical facts', contextSummary: 'Explicit summary', compactedCount: 1, tokensBefore: 120, tokensAfter: 24 },
      { type: 'full_compaction.complete' },
    ]);
    const ctx = testAgent({ persistence });
    await ctx.agent.resume();
    expect(ctx.agent.context.history.map(textContent)).toEqual(['Historical prompt', 'Explicit summary']);
    expect(ctx.agent.replayBuilder.buildResult()).toEqual([
      expect.objectContaining({ type: 'message', message: expect.objectContaining({ origin: { kind: 'user' } }) }),
      expect.objectContaining({
        type: 'compaction', instruction: 'preserve facts',
        result: expect.objectContaining({ summary: 'Historical facts', contextSummary: 'Explicit summary', compactedCount: 1, tokensBefore: 120, tokensAfter: estimateTokensForMessages(ctx.agent.context.history) }),
      }),
    ]);
    expect(persistence.appended).toEqual([]);
  });

  it('projects a recorded cancellation without starting compaction', async () => {
    const persistence = new RecordingAgentPersistence([
      { type: 'full_compaction.begin', source: 'manual', instruction: 'preserve facts' },
      { type: 'full_compaction.cancel' },
    ]);
    const ctx = testAgent({ persistence });
    await ctx.agent.resume();
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
    expect(ctx.agent.replayBuilder.buildResult()).toEqual([
      expect.objectContaining({ type: 'compaction', instruction: 'preserve facts', result: 'cancelled' }),
    ]);
    expect(ctx.llmCalls).toEqual([]);
    expect(persistence.appended).toEqual([]);
  });

  it('preserves a recorded failed Bash result in context and replay', async () => {
    const persistence = new RecordingAgentPersistence([
      { type: 'context.append_loop_event', event: { type: 'step.begin', uuid: 'failed', turnId: '0', step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'tool.call', uuid: 'failed-call', turnId: '0', step: 1, stepUuid: 'failed', toolCallId: 'failed-call', name: 'Bash', args: { command: 'false' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.result', parentUuid: 'failed-call', toolCallId: 'failed-call', result: { output: 'exit code 1', isError: true } } },
    ]);
    const ctx = testAgent({ persistence });
    await ctx.agent.resume();
    expect(ctx.agent.context.history.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'failed-call', isError: true });
    expect(ctx.agent.replayBuilder.buildResult()).toContainEqual(expect.objectContaining({ type: 'message', message: expect.objectContaining({ role: 'tool', toolCallId: 'failed-call', isError: true }) }));
    expect(textContent(ctx.agent.context.messages.at(-1)!)).toContain('exit code 1');
    expect(persistence.appended).toEqual([]);
  });

  it('does not execute an unacknowledged historical Bash operation again', async () => {
    const intent: AgentRecord = {
      type: 'context.append_loop_event',
      event: { type: 'tool.intend', toolCallId: 'unacknowledged', name: 'Bash', args: { command: 'printf changed > result.txt' }, writePaths: [] },
    };
    const persistence = new RecordingAgentPersistence([
      { type: 'context.append_loop_event', event: { type: 'step.begin', uuid: 'unsettled', turnId: '0', step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'tool.call', uuid: 'unacknowledged', turnId: '0', step: 1, stepUuid: 'unsettled', toolCallId: 'unacknowledged', name: 'Bash', args: { command: 'printf changed > result.txt' } } },
      intent,
    ]);
    const execWithEnv = vi.fn().mockRejectedValue(new Error('Historical operation must not be repeated'));
    const ctx = testAgent({ persistence, kaos: createFakeKaos({ execWithEnv }) });
    await ctx.agent.resume();
    expect(execWithEnv).not.toHaveBeenCalled();
    expect(ctx.llmCalls).toEqual([]);
    expect(persistence.records.filter((record) => record.type === 'context.append_loop_event' && record.event.type === 'tool.intend')).toEqual([intent]);
  });

  it('removes replay messages belonging to an undone user turn', async () => {
    const persistence = new RecordingAgentPersistence([
      ...promptedTurn('0', 'First prompt', 'First response'),
      ...promptedTurn('1', 'Second prompt', 'Second response'),
      { type: 'context.undo', count: 1 },
    ]);
    const ctx = testAgent({ persistence });
    await ctx.agent.resume();
    expect(ctx.agent.context.history.map(textContent)).toEqual(['First prompt', 'First response']);
    const replay = ctx.agent.replayBuilder.buildResult();
    expect(replay).toHaveLength(2);
    expect(replay.flatMap((record) => record.type === 'message' ? [textContent(record.message)] : [])).toEqual(['First prompt', 'First response']);
    expect(persistence.appended).toEqual([]);
  });

  it('restores a native fork boundary without injecting context or changing the journal', async () => {
    const persistence = new RecordingAgentPersistence([
      { type: 'context.append_message', message: userMessage('Copied user intent') },
      { type: 'forked', time: 2 },
    ]);
    const ctx = testAgent({ persistence });
    const original = structuredClone(persistence.records);
    await ctx.agent.resume();
    expect(ctx.agent.context.history.map(textContent)).toEqual(['Copied user intent']);
    expect(ctx.agent.replayBuilder.buildResult()).toHaveLength(1);
    expect(persistence.records).toEqual(original);
    expect(persistence.appended).toEqual([]);
  });
});
