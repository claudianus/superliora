import { describe, expect, it } from 'vitest';

import { createPacedBody } from '../src/providers/cursor/client';
import {
  buildRunFrames,
  concatBytes,
  decodeProtobufValue,
  encodeConnectFrame,
  encodeExecStreamClose,
  encodeInteractionQueryReply,
  encodeKvReply,
  encodeNativeExecReject,
  encodeProtobufValue,
  encodeRequestContextReply,
  extractAnswerText,
  extractExecMessage,
  extractInteractionQuery,
  extractKvMessage,
  extractReasoningText,
  extractToolCall,
  fieldLd,
  fieldStr,
  fieldVarint,
  normalizeCursorToolName,
  recoverToolCallsFromCursorText,
  sanitizeCursorAssistantText,
  ConnectFrameDecoder,
  renderCursorPrompt,
  toCursorWireModelId,
} from '../src/providers/cursor/index';
import type { Message } from '../src/message';
import { CursorStreamedMessage } from '../src/providers/cursor/stream';

describe('toCursorWireModelId', () => {
  it('keeps GetUsableModels Grok prefix and maps auto to default', () => {
    // Live Run rejects bare grok-4.5-*; prefix is required.
    expect(toCursorWireModelId('cursor-grok-4.5-high-fast')).toBe('cursor-grok-4.5-high-fast');
    expect(toCursorWireModelId('grok-4.5-high-fast')).toBe('cursor-grok-4.5-high-fast');
    expect(toCursorWireModelId('grok-4.5-fast-high')).toBe('cursor-grok-4.5-high-fast');
    expect(toCursorWireModelId('auto')).toBe('default');
    expect(toCursorWireModelId('composer-2.5')).toBe('composer-2.5');
  });
});

describe('cursor connect framing', () => {
  it('encodes and decodes Connect frames across chunk boundaries', () => {
    const payload = fieldStr(1, 'hello');
    const frame = encodeConnectFrame(payload);
    const decoder = new ConnectFrameDecoder();
    expect(decoder.push(frame.subarray(0, 3))).toEqual([]);
    const frames = decoder.push(frame.subarray(3));
    expect(frames).toHaveLength(1);
    expect(Buffer.from(frames[0]!.payload)).toEqual(Buffer.from(payload));
  });
});

describe('cursor protobuf value round-trip', () => {
  it('round-trips object / array / scalar Values', () => {
    const value = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        n: { type: 'number' },
      },
      required: ['path'],
    };
    const encoded = encodeProtobufValue(value);
    expect(decodeProtobufValue(encoded)).toEqual(value);
    expect(decodeProtobufValue(encodeProtobufValue(true))).toBe(true);
    expect(decodeProtobufValue(encodeProtobufValue(null))).toBeNull();
    expect(decodeProtobufValue(encodeProtobufValue(['a', 1]))).toEqual(['a', 1]);
  });
});

describe('cursor response extraction', () => {
  it('extracts nested answer and reasoning text', () => {
    const answer = fieldLd(1, fieldLd(1, fieldStr(1, 'hi')));
    expect(extractAnswerText(answer)).toBe('hi');
    const think = fieldLd(1, fieldLd(4, fieldStr(1, 'reason')));
    expect(extractReasoningText(think)).toBe('reason');
  });

  it('extracts MCP tool calls from exec_server_message', () => {
    // McpArgs { name=1, args=2 entry, tool_name=5, provider=4 }
    const argEntry = concatBytes(
      fieldStr(1, 'file_path'),
      fieldLd(2, encodeProtobufValue('/tmp/x')),
    );
    const mcpArgs = concatBytes(
      fieldStr(1, 'Read'),
      fieldLd(2, argEntry),
      fieldStr(5, 'Read'),
      fieldStr(3, 'call-1'),
      fieldStr(4, 'superliora'),
    );
    const exec = concatBytes(fieldVarint(1, 9), fieldLd(11, mcpArgs));
    const payload = fieldLd(2, exec);
    const call = extractToolCall(payload);
    expect(call?.name).toBe('Read');
    expect(call?.toolCallId).toBe('call-1');
    expect(JSON.parse(call?.inputJson ?? '{}')).toEqual({ file_path: '/tmp/x' });
    const execMsg = extractExecMessage(payload);
    expect(execMsg?.id).toBe(9);
    expect(execMsg?.caseField).toBe(11);
  });

  it('extracts MCP tool calls from interactionUpdate.toolCallCompleted', () => {
    const mcpArgs = concatBytes(
      fieldStr(1, 'mcp_superliora_Skill'),
      fieldLd(2, concatBytes(fieldStr(1, 'skill'), fieldLd(2, encodeProtobufValue('game-art')))),
      fieldStr(5, 'Skill'),
      fieldStr(4, 'superliora'),
      fieldStr(3, 'tc-9'),
    );
    const mcpToolCall = fieldLd(1, mcpArgs); // McpToolCall.args
    const toolCall = fieldLd(15, mcpToolCall); // ToolCall.mcp_tool_call
    const completed = concatBytes(fieldStr(1, 'tc-9'), fieldLd(2, toolCall));
    const interaction = fieldLd(3, completed); // tool_call_completed
    const payload = fieldLd(1, interaction); // interaction_update
    const call = extractToolCall(payload);
    expect(call?.name).toBe('Skill');
    expect(call?.toolCallId).toBe('tc-9');
    expect(JSON.parse(call?.inputJson ?? '{}')).toEqual({ skill: 'game-art' });
  });

  it('parses interaction_query ids for client replies', () => {
    const query = concatBytes(fieldVarint(1, 42), fieldLd(2, new Uint8Array(0)));
    const payload = fieldLd(7, query);
    expect(extractInteractionQuery(payload)).toEqual({ id: 42, queryField: 2 });
    const reply = encodeInteractionQueryReply(42, 2);
    expect(reply[0]).toBe(0); // Connect data frame
  });
});

describe('cursor tool name + text sanitize', () => {
  it('strips mcp_superliora_ display prefix', () => {
    expect(normalizeCursorToolName('mcp_superliora_Skill')).toBe('Skill');
    expect(normalizeCursorToolName('mcp__superliora__TodoList')).toBe('TodoList');
    expect(normalizeCursorToolName('Bash')).toBe('Bash');
  });

  it('removes leaked protocol tags and recovers text-form tool calls', () => {
    const leaked = [
      'ok',
      '<tool_call>',
      'mcp_superliora_Skill(skill=game-art)',
      'mcp_superliora_JobList(limit=20)',
      '</assistant>',
      '<tool_result>Skill "game-art" loaded inline. Follow its instructions.</tool_result>',
      'next',
    ].join('\n');
    expect(sanitizeCursorAssistantText(leaked)).toBe('ok\n\nnext');
    const recovered = recoverToolCallsFromCursorText(leaked);
    expect(recovered.map((call) => call.name)).toEqual(['Skill', 'JobList']);
    expect(JSON.parse(recovered[0]!.inputJson)).toEqual({ skill: 'game-art' });
    expect(JSON.parse(recovered[1]!.inputJson)).toEqual({ limit: 20 });
  });

  it('CursorStreamedMessage recovers text tool calls and hides protocol markup', async () => {
    async function* events() {
      yield {
        type: 'text' as const,
        text: 'hi\n<tool_call>\nmcp_superliora_Skill(skill=game-art)\n</tool_call>\n',
      };
      yield { type: 'end' as const };
    }
    const parts: Array<{ type: string; name?: string; text?: string }> = [];
    const stream = new CursorStreamedMessage(events());
    for await (const part of stream) {
      if (part.type === 'text') parts.push({ type: 'text', text: part.text });
      if (part.type === 'function') parts.push({ type: 'function', name: part.name });
    }
    expect(parts.some((part) => part.type === 'text' && part.text === 'hi')).toBe(true);
    expect(parts.some((part) => part.type === 'function' && part.name === 'Skill')).toBe(true);
    expect(parts.some((part) => part.text?.includes('tool_call'))).toBe(false);
    expect(stream.finishReason).toBe('tool_calls');
  });
});

describe('cursor client replies', () => {
  it('encodes requestContext reply with advertised tools', () => {
    const frame = encodeRequestContextReply(3, 'exec-1', [
      {
        name: 'Skill',
        description: 'load a skill',
        inputSchema: { type: 'object', properties: { skill: { type: 'string' } } },
      },
    ]);
    expect(frame[0]).toBe(0);
    expect(Buffer.from(frame).includes(Buffer.from('Skill', 'utf8'))).toBe(true);
    expect(Buffer.from(frame).includes(Buffer.from('superliora', 'utf8'))).toBe(true);
  });

  it('acks KV get/set so blob round-trips cannot stall', () => {
    const getArgs = concatBytes(fieldVarint(1, 7), fieldLd(2, fieldStr(1, 'blob')));
    const getPayload = fieldLd(4, getArgs);
    expect(extractKvMessage(getPayload)).toEqual({ id: 7, caseField: 2 });
    const getReply = encodeKvReply(7, 2);
    expect(getReply[0]).toBe(0);

    const setArgs = concatBytes(fieldVarint(1, 8), fieldLd(3, fieldStr(1, 'blob')));
    expect(extractKvMessage(fieldLd(4, setArgs))?.caseField).toBe(3);
    expect(encodeKvReply(8, 3)[0]).toBe(0);
  });

  it('rejects shellStream with streamClose so Cursor unblocks', () => {
    const frames = encodeNativeExecReject(4, 'e1', 14, concatBytes(fieldStr(1, 'ls'), fieldStr(2, '/tmp')));
    expect(frames.length).toBeGreaterThanOrEqual(3);
    const close = encodeExecStreamClose(4);
    expect(close[0]).toBe(0);
    // Last reject frame should be streamClose control.
    expect(Buffer.from(frames[frames.length - 1]!).equals(Buffer.from(close))).toBe(true);
  });
});

describe('cursor run frames', () => {
  it('builds a non-empty paced frame sequence with mcp tools', () => {
    const frames = buildRunFrames({
      prompt: 'hello',
      modelId: 'composer-2',
      cwd: '/tmp',
      mode: 1,
      tools: [
        {
          name: 'Bash',
          description: 'run a command',
          inputSchema: {
            type: 'object',
            properties: { command: { type: 'string' } },
          },
        },
      ],
    });
    expect(frames.length).toBeGreaterThan(5);
    // First frame is a Connect-wrapped RunRequest.
    expect(frames[0]![0]).toBe(0);
    const decoder = new ConnectFrameDecoder();
    const decoded = decoder.push(frames[0]!);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.payload.length).toBeGreaterThan(0);
  });

  it('encodes prefixed Grok wire ids (bare grok is rejected by Run)', () => {
    const frames = buildRunFrames({
      prompt: 'hi',
      modelId: 'grok-4.5-high-fast',
      cwd: '/tmp',
      mode: 1,
      tools: [],
    });
    const decoder = new ConnectFrameDecoder();
    const decoded = decoder.push(frames[0]!);
    const payload = Buffer.from(decoded[0]!.payload);
    expect(payload.includes(Buffer.from('cursor-grok-4.5-high-fast', 'utf8'))).toBe(true);
  });

  it('encodes empty tools as zero-length mcp_tools body placeholder', () => {
    // Smoke: empty tools still produce a valid first frame (field 4 present).
    const frames = buildRunFrames({
      prompt: 'hi',
      modelId: 'composer-2',
      cwd: '/tmp',
      mode: 1,
      tools: [],
    });
    expect(frames[0]!.length).toBeGreaterThan(10);
  });
});

describe('cursor prompt rendering', () => {
  it('folds system, assistant tool_use, and tool results into XML', () => {
    const history: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'list files' }],
        toolCalls: [],
      },
      {
        role: 'assistant',
        content: [],
        toolCalls: [
          {
            type: 'function',
            id: 'c1',
            name: 'Bash',
            arguments: '{"command":"ls"}',
          },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'text', text: 'a.txt' }],
        toolCalls: [],
        toolCallId: 'c1',
      },
    ];
    const prompt = renderCursorPrompt('be helpful', history);
    expect(prompt).toContain('<system>\nbe helpful\n</system>');
    expect(prompt).toContain('<tool_use id="c1" name="Bash">');
    expect(prompt).toContain('<tool_result tool_use_id="c1">');
    expect(prompt).toContain('a.txt');
  });
});

describe('cursor field helpers', () => {
  it('fieldVarint / fieldLd produce non-empty tags', () => {
    expect(fieldVarint(4, 1).length).toBeGreaterThan(1);
    expect(fieldLd(1, new Uint8Array([1, 2, 3])).length).toBe(5);
  });
});

describe('createPacedBody abort', () => {
  it('abort ends the body stream without an unhandled Readable error', async () => {
    const uncaught: Error[] = [];
    const onUncaught = (error: Error): void => {
      uncaught.push(error);
    };
    process.on('uncaughtException', onUncaught);
    try {
      const ac = new AbortController();
      const paced = createPacedBody([new Uint8Array([1, 2, 3])], ac.signal);
      // Drain so pipe teardown is not required for a clean end.
      paced.stream.resume();
      ac.abort();
      await new Promise<void>((resolve) => paced.stream.once('end', () => resolve()));
      await new Promise((resolve) => setImmediate(resolve));
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('abort() destroys without half-close (client-tool suspend path)', async () => {
    const uncaught: Error[] = [];
    const onUncaught = (error: Error): void => {
      uncaught.push(error);
    };
    process.on('uncaughtException', onUncaught);
    try {
      const paced = createPacedBody([new Uint8Array([1, 2, 3])]);
      paced.stream.resume();
      paced.abort();
      await new Promise((resolve) => setImmediate(resolve));
      expect(uncaught).toEqual([]);
      expect(paced.stream.destroyed).toBe(true);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});

describe('cursor No exec result trailer', () => {
  it('parseConnectEndError recognizes Cursor No exec result', async () => {
    const { parseConnectEndError } = await import('../src/providers/cursor/connect');
    const payload = Buffer.from(
      JSON.stringify({ error: { code: 'internal', message: 'No exec result' } }),
      'utf8',
    );
    const err = parseConnectEndError(payload);
    expect(err?.message).toContain('No exec result');
  });
});
