import { APIConnectionError, APIStatusError } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { LLMChatParams } from '../../src/loop/llm';
import { runTurn } from '../../src/loop/run-turn';
import { boundary, provider } from './fixtures/native-boundaries';

describe('native provider failure boundaries', () => {
  it.each([
    new APIConnectionError('terminated'),
    new APIStatusError(503, 'provider unavailable'),
    new APIStatusError(400, '`tool_use` ids were found without `tool_result` blocks immediately after'),
  ])('surfaces a pre-output provider failure without retrying or projecting another request: %s', async (failure) => {
    const llm = provider(async () => { throw failure; });
    const recordStepUsage = vi.fn();
    const { input, records, live } = boundary(llm, { recordStepUsage });

    await expect(runTurn(input)).rejects.toBe(failure);
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.requestLogFields).toMatchObject({ turnStep: `${input.turnId}.1` });
    expect(recordStepUsage).not.toHaveBeenCalled();
    expect(records.map((event) => event.type)).toEqual(['step.begin']);
    expect(live.filter((event) => event.type === 'turn.interrupted')).toEqual([
      expect.objectContaining({ reason: 'error', activeStep: 1 }),
    ]);
  });

  const emissions: Array<[string, (params: LLMChatParams) => void | Promise<void>]> = [
    ['text delta', (params) => { params.onTextDelta?.('partial'); }],
    ['thinking delta', (params) => { params.onThinkDelta?.('partial reasoning'); }],
    ['tool arguments', (params) => { params.onToolCallDelta?.({ toolCallId: 'partial-call', argumentsPart: '{' }); }],
    ['text block', async (params) => { await params.onTextPart?.({ type: 'text', text: 'partial' }); }],
    ['thinking block', async (params) => { await params.onThinkPart?.({ type: 'think', think: 'partial', encrypted: 'signature' }); }],
  ];

  it.each(emissions)('preserves visible %s and does not replay a failed provider request', async (_label, emit) => {
    const failure = new APIConnectionError('terminated');
    const llm = provider(async (params) => { await emit(params); throw failure; });
    const { input, records, live } = boundary(llm);

    await expect(runTurn(input)).rejects.toBe(failure);
    expect(llm.requests).toHaveLength(1);
    expect(records.some((event) => event.type === 'step.end')).toBe(false);
    expect(live.filter((event) => event.type === 'turn.interrupted')).toEqual([
      expect.objectContaining({ reason: 'error', activeStep: 1 }),
    ]);
    if (_label.endsWith('block')) {
      expect(records.filter((event) => event.type === 'content.part')).toHaveLength(1);
    } else {
      expect(live.some((event) => event.type.endsWith('.delta'))).toBe(true);
    }
  });
});
