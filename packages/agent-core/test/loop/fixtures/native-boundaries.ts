import { setImmediate } from 'node:timers/promises';

import { emptyUsage } from '@superliora/kosong';
import type { TokenUsage, ToolCall } from '@superliora/kosong';

import { createLoopEventDispatcher } from '../../../src/loop/events';
import type { LoopEvent, LoopRecordedEvent } from '../../../src/loop/events';
import type { LLM, LLMChatParams, LLMChatResponse } from '../../../src/loop/llm';
import type { RunTurnInput } from '../../../src/loop/run-turn';
import { ToolAccesses } from '../../../src/loop/tool-access';
import type { ExecutableTool, RunnableToolExecution } from '../../../src/loop/types';

export function provider(
  chat: LLM['chat'],
): LLM & { requests: LLMChatParams[] } {
  const requests: LLMChatParams[] = [];
  return {
    systemPrompt: '',
    modelName: 'boundary-provider',
    requests,
    chat: async (params) => {
      requests.push(params);
      return chat(params);
    },
  };
}

export function response(toolCalls: ToolCall[] = [], usage: Partial<TokenUsage> = {}): LLMChatResponse {
  return {
    toolCalls,
    providerFinishReason: toolCalls.length === 0 ? 'completed' : 'tool_calls',
    usage: { ...emptyUsage(), ...usage },
  };
}

export function call(name: 'Bash' | 'SessionControl', id: string): ToolCall {
  return {
    type: 'function',
    name,
    id,
    arguments: JSON.stringify(name === 'Bash' ? { command: 'pwd' } : { operation: 'wait' }),
  };
}

// Execution gates expose uncertain settlement, without simulating shell output
// or replacing the native scheduler, authorization, or event dispatcher.
export function executionTool(
  name: 'Bash' | 'SessionControl',
  execute: RunnableToolExecution['execute'],
  accesses: ToolAccesses = ToolAccesses.all(),
): ExecutableTool {
  const key = name === 'Bash' ? 'command' : 'operation';
  return {
    name,
    description: 'Controlled execution settlement boundary',
    parameters: {
      type: 'object',
      properties: { [key]: { type: 'string' } },
      required: [key],
      additionalProperties: false,
    },
    resolveExecution: () => ({ approvalRule: name, accesses, execute }),
  };
}

export function boundary(llm: LLM, overrides: Partial<RunTurnInput> = {}) {
  const records: LoopRecordedEvent[] = [];
  const live: LoopEvent[] = [];
  const input: RunTurnInput = {
    turnId: 'turn-boundary',
    signal: new AbortController().signal,
    llm,
    buildMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
    dispatchEvent: createLoopEventDispatcher({
      appendTranscriptRecord: async (event) => { records.push(event); },
      emitLiveEvent: (event) => { live.push(event); },
    }),
    ...overrides,
  };
  return { input, records, live };
}

export async function nextTask(): Promise<void> {
  await setImmediate();
}
