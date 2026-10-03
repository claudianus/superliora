import { describe, expect, it } from 'vitest';

import { createLoopEventDispatcher } from '../../src/loop/events';
import type { LoopEvent, LoopRecordedEvent } from '../../src/loop/events';
import { runTurn } from '../../src/loop/run-turn';
import { boundary, call, executionTool, nextTask, provider, response } from './fixtures/native-boundaries';

describe('native stream and durable event boundaries', () => {
  it('awaits durable append before publishing completed content, preserving signed reasoning and step ownership', async () => {
    const appendEntered = Promise.withResolvers<void>();
    const appendRelease = Promise.withResolvers<void>();
    const records: LoopRecordedEvent[] = [];
    const live: LoopEvent[] = [];
    const llm = provider(async (params) => {
      params.onThinkDelta?.('reason');
      await params.onThinkPart?.({ type: 'think', think: 'reason', encrypted: 'signature' });
      params.onTextDelta?.('answer');
      await params.onTextPart?.({ type: 'text', text: 'answer' });
      return response();
    });
    const { input } = boundary(llm, { dispatchEvent: createLoopEventDispatcher({
      appendTranscriptRecord: async (event) => {
        if (event.type === 'content.part' && event.part.type === 'think') {
          appendEntered.resolve();
          await appendRelease.promise;
        }
        records.push(event);
      },
      emitLiveEvent: (event) => { live.push(event); },
    }) });
    const turn = runTurn(input);
    await appendEntered.promise;
    expect(live.map((event) => event.type)).toEqual(['step.begin', 'thinking.delta']);
    expect(records.map((event) => event.type)).toEqual(['step.begin']);
    appendRelease.resolve();
    await turn;

    expect(records.map((event) => event.type)).toEqual(['step.begin', 'content.part', 'content.part', 'step.end']);
    const begin = records.find((event) => event.type === 'step.begin');
    const parts = records.filter((event) => event.type === 'content.part');
    expect(parts.map((event) => event.stepUuid)).toEqual([begin?.uuid, begin?.uuid]);
    expect(parts[0]?.part).toEqual({ type: 'think', think: 'reason', encrypted: 'signature' });
    expect(live.map((event) => event.type)).toEqual([
      'step.begin', 'thinking.delta', 'content.part', 'text.delta', 'content.part', 'step.end',
    ]);
    expect(records.some((event) => (event.type as string).endsWith('.delta'))).toBe(false);
  });

  it.each(['throw', 'reject'] as const)('contains live listener %s failures without losing durable tool results', async (mode) => {
    const records: LoopRecordedEvent[] = [];
    let request = 0;
    const llm = provider(async (params) => {
      params.onTextDelta?.('status');
      return request++ === 0 ? response([call('Bash', 'process')]) : response();
    });
    const bash = executionTool('Bash', async (ctx) => {
      ctx.onUpdate?.({ kind: 'stdout', text: 'process output' });
      return { output: 'process exited' };
    });
    const { input } = boundary(llm, { tools: [bash], dispatchEvent: createLoopEventDispatcher({
      appendTranscriptRecord: async (event) => { records.push(event); },
      emitLiveEvent: () => {
        if (mode === 'throw') throw new Error('renderer failed');
        return Promise.reject(new Error('renderer failed'));
      },
    }) });

    expect(await runTurn(input)).toMatchObject({ stopReason: 'end_turn', steps: 2 });
    await nextTask();
    expect(records.filter((event) => event.type === 'tool.result')).toEqual([
      expect.objectContaining({ toolCallId: 'process', result: { output: 'process exited' } }),
    ]);
    expect(records.filter((event) => event.type === 'step.end')).toHaveLength(2);
  });

  it('propagates durable content failure rather than publishing or sealing an unrecorded block', async () => {
    const failure = new Error('record storage unavailable');
    const live: LoopEvent[] = [];
    const llm = provider(async (params) => {
      await params.onTextPart?.({ type: 'text', text: 'unrecorded' });
      return response();
    });
    const { input } = boundary(llm, { dispatchEvent: createLoopEventDispatcher({
      appendTranscriptRecord: async (event) => { if (event.type === 'content.part') throw failure; },
      emitLiveEvent: (event) => { live.push(event); },
    }) });

    await expect(runTurn(input)).rejects.toBe(failure);
    expect(live.map((event) => event.type)).toEqual(['step.begin', 'turn.interrupted']);
    expect(llm.requests).toHaveLength(1);
  });
});
