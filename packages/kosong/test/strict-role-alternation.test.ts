import type { Message } from '#/message';
import { AnthropicChatProvider } from '#/providers/anthropic';
import { GoogleGenAIChatProvider } from '#/providers/google-genai';
import { describe, expect, it, vi } from 'vitest';

const POST_COMPACTION_SHAPE: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Earlier prompt' }], toolCalls: [] },
  {
    role: 'user',
    content: [{ type: 'text', text: '<summary>Earlier work.</summary>' }],
    toolCalls: [],
  },
  {
    role: 'user',
    content: [{ type: 'text', text: '<system-reminder>Continue carefully.</system-reminder>' }],
    toolCalls: [],
  },
];

const STEER_AFTER_TOOL_RESULT: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Add 2 and 3' }], toolCalls: [] },
  {
    role: 'assistant',
    content: [],
    toolCalls: [{ type: 'function', id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }],
  },
  { role: 'tool', content: [{ type: 'text', text: '5' }], toolCallId: 'call_1', toolCalls: [] },
  { role: 'user', content: [{ type: 'text', text: 'Now multiply them instead' }], toolCalls: [] },
];

function assertNoConsecutiveSameRole(roles: readonly string[]): void {
  for (let i = 1; i < roles.length; i++) {
    expect(
      roles[i],
      `consecutive '${roles[i]}' turns at index ${i} in ${JSON.stringify(roles)}`,
    ).not.toBe(roles[i - 1]);
  }
}

async function collect(streamed: AsyncIterable<unknown>): Promise<void> {
  for await (const part of streamed) void part;
}

async function anthropicWireRoles(history: Message[]): Promise<string[]> {
  const provider = new AnthropicChatProvider({
    model: 'k25',
    apiKey: 'test-key',
    defaultMaxTokens: 1024,
    stream: false,
  });
  let captured: Record<string, unknown> | undefined;
  const client = Reflect.get(provider, '_client') as {
    messages: { create: (params: Record<string, unknown>) => Promise<Record<string, unknown>> };
  };
  client.messages.create = vi.fn().mockImplementation((params: Record<string, unknown>) => {
    captured = params;
    return Promise.resolve({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'k25',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });

  await collect(await provider.generate('', [], history));

  if (captured === undefined) throw new Error('Anthropic provider did not call messages.create');
  return (captured['messages'] as Array<{ role: string }>).map((message) => message.role);
}

async function googleWireRoles(history: Message[]): Promise<string[]> {
  const provider = new GoogleGenAIChatProvider({
    model: 'gemini-2.5-flash',
    apiKey: 'test-key',
    stream: false,
  });
  let captured: Record<string, unknown> | undefined;
  const response = {
    candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    modelVersion: 'gemini-2.5-flash',
  };
  const models = Reflect.get(Reflect.get(provider, '_client'), 'models') as Record<string, unknown>;
  models['generateContent'] = vi.fn().mockImplementation((params: Record<string, unknown>) => {
    captured = params;
    return Promise.resolve(response);
  });
  models['generateContentStream'] = vi.fn();

  await collect(await provider.generate('', [], history));

  if (captured === undefined) throw new Error('Google provider did not call generateContent');
  return (captured['contents'] as Array<{ role: string }>).map((content) => content.role);
}

const STRICT_PROVIDERS = [
  { name: 'anthropic', wireRoles: anthropicWireRoles },
  { name: 'google-genai', wireRoles: googleWireRoles },
] as const;

describe('strict provider role alternation', () => {
  for (const { name, wireRoles } of STRICT_PROVIDERS) {
    describe(name, () => {
      it('collapses the post-compaction shape into alternating turns', async () => {
        assertNoConsecutiveSameRole(await wireRoles(POST_COMPACTION_SHAPE));
      });

      it('stays alternating when a user turn follows a tool result', async () => {
        assertNoConsecutiveSameRole(await wireRoles(STEER_AFTER_TOOL_RESULT));
      });
    });
  }
});
