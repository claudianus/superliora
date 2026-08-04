import { describe, expect, it } from 'vitest';

import { createPacedBody } from '../src/providers/cursor/client';
import {
  buildRunFrames,
  concatBytes,
  decodeProtobufValue,
  encodeConnectFrame,
  encodeProtobufValue,
  extractAnswerText,
  extractReasoningText,
  extractToolCall,
  fieldLd,
  fieldStr,
  fieldVarint,
  ConnectFrameDecoder,
  renderCursorPrompt,
  toCursorWireModelId,
} from '../src/providers/cursor/index';
import type { Message } from '../src/message';

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
    // McpArgs { name=1, args=2 entry, tool_name=5 }
    const argEntry = concatBytes(
      fieldStr(1, 'file_path'),
      fieldLd(2, encodeProtobufValue('/tmp/x')),
    );
    const mcpArgs = concatBytes(
      fieldStr(1, 'Read'),
      fieldLd(2, argEntry),
      fieldStr(5, 'Read'),
      fieldStr(3, 'call-1'),
    );
    const exec = fieldLd(11, mcpArgs);
    const payload = fieldLd(2, exec);
    const call = extractToolCall(payload);
    expect(call?.name).toBe('Read');
    expect(call?.toolCallId).toBe('call-1');
    expect(JSON.parse(call?.inputJson ?? '{}')).toEqual({ file_path: '/tmp/x' });
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
});
