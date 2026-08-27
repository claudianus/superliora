import { describe, expect, it } from 'vitest';

import { createPacedBody } from '../src/providers/cursor/client';
import {
  buildRunFrames,
  concatBytes,
  convertCursorError,
  cursorAgentVersionsDirs,
  cursorEnvironmentOs,
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
  explicitCursorAgentOrigin,
  fieldLd,
  fieldStr,
  fieldVarint,
  isCursorAuthApiOrigin,
  isCursorDefaultFallbackOrigin,
  mergeCursorProtocolHeaders,
  normalizeCursorAgentOrigin,
  normalizeCursorToolName,
  parseCursorWindowsMachineGuid,
  parseGetServerConfigAgentUrl,
  parseHttp2Trailers,
  recoverToolCallsFromCursorText,
  resolveCursorAgentOrigin,
  sanitizeCursorAssistantText,
  unwrapConnectPayload,
  ConnectFrameDecoder,
  renderCursorPrompt,
  toCursorWireModelId,
  CURSOR_AGENT_FALLBACK_URL,
} from '../src/providers/cursor/index';
import { iterFields } from '../src/providers/cursor/proto';
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

  it('recovers JobCreate JSON array kwargs instead of splitting them on commas', () => {
    const leaked = [
      '<tool_call>',
      'mcp_superliora_JobCreate(title=Grok bot harness, kind=research, task_track=general, staff=true, context_paths=["packages/oauth/src/xai.ts", "packages/kosong"], must_not_touch=["apps/liora/src"], success_criteria=["cite official docs", "map harness loop"])',
      '</tool_call>',
    ].join('\n');
    const recovered = recoverToolCallsFromCursorText(leaked);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.name).toBe('JobCreate');
    expect(JSON.parse(recovered[0]!.inputJson)).toEqual({
      title: 'Grok bot harness',
      kind: 'research',
      task_track: 'general',
      staff: true,
      context_paths: ['packages/oauth/src/xai.ts', 'packages/kosong'],
      must_not_touch: ['apps/liora/src'],
      success_criteria: ['cite official docs', 'map harness loop'],
    });
  });

  it('keeps brace globs and dashed flags intact in text-form tool calls', () => {
    const recovered = recoverToolCallsFromCursorText(
      'mcp_superliora_Grep(path=C:/repo, pattern=grok, glob=*.{ts,tsx}, -i=true, head_limit=40)',
    );
    expect(JSON.parse(recovered[0]!.inputJson)).toEqual({
      path: 'C:/repo',
      pattern: 'grok',
      glob: '*.{ts,tsx}',
      '-i': true,
      head_limit: 40,
    });
  });

  it('recovers quoted kwargs and array items that contain commas or parentheses', () => {
    const recovered = recoverToolCallsFromCursorText(
      'mcp_superliora_JobCreate(title="Grok bot, harness", success_criteria=["foo() returns 0", "bar, baz"])',
    );
    expect(JSON.parse(recovered[0]!.inputJson)).toEqual({
      title: 'Grok bot, harness',
      success_criteria: ['foo() returns 0', 'bar, baz'],
    });
  });

  it('accepts a JSON object as the whole argument list', () => {
    const recovered = recoverToolCallsFromCursorText('mcp_superliora_JobList({"limit":20})');
    expect(JSON.parse(recovered[0]!.inputJson)).toEqual({ limit: 20 });
  });

  it('recovers single-quoted Python-style list kwargs', () => {
    const recovered = recoverToolCallsFromCursorText(
      "mcp_superliora_JobCreate(context_paths=['packages/oauth/src/xai.ts', 'packages/kosong'])",
    );
    expect(JSON.parse(recovered[0]!.inputJson)).toEqual({
      context_paths: ['packages/oauth/src/xai.ts', 'packages/kosong'],
    });
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
    expect(Buffer.from(frames.at(-1)!).equals(Buffer.from(close))).toBe(true);
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
    const outer = [...iterFields(decoded[0]!.payload)];
    const req = outer.find((field) => field.field === 1);
    expect(req).toBeDefined();
    const reqFields = [...iterFields(req!.data)];
    expect(reqFields.some((field) => field.field === 19 && field.varint === 1n)).toBe(true);
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
    expect(err?.status).toBe(500);
  });

  it('parseConnectEndError accepts a bare Connect error object', async () => {
    const { parseConnectEndError } = await import('../src/providers/cursor/connect');
    const err = parseConnectEndError(
      Buffer.from(JSON.stringify({ code: 'unauthenticated', message: 'invalid token' }), 'utf8'),
    );
    expect(err?.status).toBe(401);
    expect(err?.message).toContain('invalid token');
  });

  it('parseConnectEndError gunzips a compressed trailer', async () => {
    const { gzipSync } = await import('node:zlib');
    const { parseConnectEndError } = await import('../src/providers/cursor/connect');
    const json = JSON.stringify({ error: { code: 'unavailable', message: 'region is not available' } });
    const err = parseConnectEndError(gzipSync(Buffer.from(json, 'utf8')));
    expect(err?.status).toBe(503);
    expect(err?.message).toContain('region is not available');
  });
});

describe('cursor protocol compatibility', () => {
  it('does not treat api2 as an AgentService/Run host', () => {
    expect(isCursorAuthApiOrigin('https://api2.cursor.sh')).toBe(true);
    expect(normalizeCursorAgentOrigin('https://api2.cursor.sh')).toBeUndefined();
    expect(normalizeCursorAgentOrigin('https://agentn.us.api5.cursor.sh')).toBe(
      'https://agentn.us.api5.cursor.sh',
    );
    expect(normalizeCursorAgentOrigin('https://agent-gcpp-uswest.api5.cursor.sh')).toBe(
      'https://agent-gcpp-uswest.api5.cursor.sh',
    );
    expect(normalizeCursorAgentOrigin('https://evil.example.com')).toBeUndefined();
  });

  it('does not treat the global fallback host as an explicit Run override', () => {
    expect(isCursorDefaultFallbackOrigin(CURSOR_AGENT_FALLBACK_URL)).toBe(true);
    expect(explicitCursorAgentOrigin(CURSOR_AGENT_FALLBACK_URL)).toBeUndefined();
    expect(explicitCursorAgentOrigin('https://api2.cursor.sh')).toBeUndefined();
    expect(explicitCursorAgentOrigin('https://agentn.us.api5.cursor.sh')).toBe(
      'https://agentn.us.api5.cursor.sh',
    );
  });

  it('reads GetServerConfig agentnUrl in camelCase and snake_case', () => {
    expect(
      parseGetServerConfigAgentUrl({
        agentUrlConfig: { agentnUrl: 'https://agentn.us.api5.cursor.sh' },
      }),
    ).toBe('https://agentn.us.api5.cursor.sh');
    expect(
      parseGetServerConfigAgentUrl({
        agent_url_config: { agentn_url: 'agent-gcpp-uswest.api5.cursor.sh' },
      }),
    ).toBe('agent-gcpp-uswest.api5.cursor.sh');
  });

  it('falls back to the global agent host when GetServerConfig is skipped', async () => {
    const origin = await resolveCursorAgentOrigin({
      token: 'test-token',
      configuredBaseUrl: 'https://api2.cursor.sh',
      clientVersion: 'cli-2026.08.25-3e8eec8',
      skipServerConfig: true,
    });
    expect(origin).toBe(CURSOR_AGENT_FALLBACK_URL);
  });

  it('honors a region agent override and ignores api2 leftovers', async () => {
    const origin = await resolveCursorAgentOrigin({
      token: 'test-token',
      configuredBaseUrl: 'https://agentn.us.api5.cursor.sh',
      clientVersion: 'cli-2026.08.25-3e8eec8',
      skipServerConfig: true,
    });
    expect(origin).toBe('https://agentn.us.api5.cursor.sh');
  });

  it('keeps protocol identity headers over OAuth customHeaders', () => {
    const merged = mergeCursorProtocolHeaders(
      {
        'x-ghost-mode': 'true',
        'x-cursor-client-version': 'cli-2026.08.25-3e8eec8',
        authorization: 'Bearer tok',
      },
      {
        'x-ghost-mode': 'false',
        'x-cursor-client-version': 'stale',
        'x-request-id': 'keep-me',
      },
    );
    expect(merged['x-ghost-mode']).toBe('true');
    expect(merged['x-cursor-client-version']).toBe('cli-2026.08.25-3e8eec8');
    expect(merged['x-request-id']).toBe('keep-me');
    expect(merged['authorization']).toBe('Bearer tok');
  });

  it('unwraps Connect envelopes but leaves raw protobuf alone', () => {
    const proto = fieldStr(1, 'composer-2.5');
    expect(Buffer.from(unwrapConnectPayload(proto))).toEqual(Buffer.from(proto));
    const framed = encodeConnectFrame(proto);
    expect(Buffer.from(unwrapConnectPayload(framed))).toEqual(Buffer.from(proto));
  });

  it('converts Connect auth and HTTP failures into typed provider errors', async () => {
    const { APIStatusError, APIConnectionError } = await import('../src/errors');
    const auth = convertCursorError(new Error('Cursor Connect error: unauthenticated: expired'));
    expect(auth).toBeInstanceOf(APIStatusError);
    expect((auth as InstanceType<typeof APIStatusError>).statusCode).toBe(401);

    const alb = convertCursorError(new Error('Cursor AgentService/Run failed (HTTP 464): Incompatible'));
    expect(alb).toBeInstanceOf(APIConnectionError);
  });

  it('maps HTTP/2 grpc-status trailers onto Connect codes', () => {
    const err = parseHttp2Trailers({ 'grpc-status': '16', 'grpc-message': 'invalid token' });
    expect(err?.status).toBe(401);
    expect(err?.code).toBe('unauthenticated');
    expect(err?.message).toContain('invalid token');
  });

  it('parses Cursor CLI REG_SZ MachineGuid output', () => {
    const guid = parseCursorWindowsMachineGuid(
      [
        '',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography',
        '    MachineGuid    REG_SZ    ABCD1234-5678-90AB-CDEF-1234567890AB',
        '',
      ].join('\r\n'),
    );
    expect(guid).toBe('abcd1234-5678-90ab-cdef-1234567890ab');
  });

  it('advertises os_version as platform plus kernel release', () => {
    expect(cursorEnvironmentOs()).toMatch(/^(win32|darwin|linux) /);
  });

  it('discovers the Cursor IDE agent-cli versions directory', () => {
    const dirs = cursorAgentVersionsDirs();
    expect(dirs.some((dir) => dir.includes('anysphere.cursor-agent-worker'))).toBe(true);
  });

  it('encodes RequestContextEnv sandbox flags as disabled', () => {
    const frames = buildRunFrames({
      prompt: 'hi',
      modelId: 'composer-2.5',
      cwd: '/tmp',
      mode: 1,
      tools: [],
    });
    const decoder = new ConnectFrameDecoder();
    const decoded = decoder.push(frames[1]!);
    expect(decoded).toHaveLength(1);
    const payload = Buffer.from(decoded[0]!.payload);
    expect(payload.includes(Buffer.from(cursorEnvironmentOs(), 'utf8'))).toBe(true);
  });

  it('decodes protobuf Values even when an unknown field precedes the kind', () => {
    const unknown = fieldVarint(99, 1);
    const encoded = concatBytes(unknown, encodeProtobufValue({ path: '/tmp' }));
    expect(decodeProtobufValue(encoded)).toEqual({ path: '/tmp' });
  });
});

