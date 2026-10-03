import { describe, expect, it } from 'vitest';

import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type ContentBlock,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { Event, LioraHarness, Session } from '@superliora/sdk';

import { AcpServer } from '../src/server';
import { AUTHED_STATUS } from './_helpers/harness-stubs';
import { toolResultToAcpContent } from '../src/convert';
import {
  toolCallStartToSessionUpdate,
  toolCallStartedUpgradeToSessionUpdate,
} from '../src/convert/events-map';

class CollectingClient implements Client {
  readonly updates: SessionNotification[] = [];

  /**
   * Updates produced AFTER `session/new` returns. Phase 9.3 makes
   * `newSession` emit exactly one `available_commands_update` on
   * creation; existing tests assert only on prompt-driven updates,
   * so we filter that variant out.
   */
  get promptUpdates(): readonly SessionNotification[] {
    return this.updates.filter(
      (n) =>
        (n.update as { sessionUpdate?: string }).sessionUpdate !==
        'available_commands_update',
    );
  }

  async requestPermission(_p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    throw new Error('CollectingClient.requestPermission should not be called in tool-result test');
  }
  async sessionUpdate(n: SessionNotification): Promise<void> {
    this.updates.push(n);
  }
  async writeTextFile(_p: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error('CollectingClient.writeTextFile should not be called in tool-result test');
  }
  async readTextFile(_p: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    throw new Error('CollectingClient.readTextFile should not be called in tool-result test');
  }
}

function makeInMemoryStreamPair(): {
  agentStream: ReturnType<typeof ndJsonStream>;
  clientStream: ReturnType<typeof ndJsonStream>;
} {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const agentStream = ndJsonStream(agentToClient.writable, clientToAgent.readable);
  const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable);
  return { agentStream, clientStream };
}

function makeScriptedSession(sessionId: string, script: readonly Event[]): Session {
  const listeners = new Set<(event: Event) => void>();
  return {
    id: sessionId,
    prompt: async (_input: unknown) => {
      for (const ev of script) {
        for (const fn of listeners) fn(ev);
      }
    },
    cancel: async () => undefined,
    onEvent: (fn: (event: Event) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  } as unknown as Session;
}

const textBlock = (text: string): ContentBlock => ({ type: 'text', text });

async function flushNdjson(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe('toolResultToAcpContent (unit)', () => {
  it('returns a text content entry for a non-empty string output', () => {
    const content = toolResultToAcpContent({
      type: 'tool.result',
      turnId: 1,
      toolCallId: 'tc',
      output: 'hello world',
      isError: false,
    } as never);
    expect(content).toEqual([
      { type: 'content', content: { type: 'text', text: 'hello world' } },
    ]);
  });

  it('JSON-stringifies object output', () => {
    const content = toolResultToAcpContent({
      type: 'tool.result',
      turnId: 1,
      toolCallId: 'tc',
      output: { count: 3 },
    } as never);
    expect(content).toEqual([
      { type: 'content', content: { type: 'text', text: '{"count":3}' } },
    ]);
  });

  it('returns an empty array for empty / undefined / null output', () => {
    expect(toolResultToAcpContent({ output: '' } as never)).toEqual([]);
    expect(toolResultToAcpContent({ output: undefined } as never)).toEqual([]);
    expect(toolResultToAcpContent({ output: null } as never)).toEqual([]);
  });
});

describe('AcpServer tool.result → tool_call_update', () => {
  it('emits status=completed with text content for non-error string output', async () => {
    const sessionId = 'sess-tr-1';
    const turnId = 1;
    const toolCallId = 'tc-1';
    const session = makeScriptedSession(sessionId, [
      {
        type: 'tool.call.started',
        sessionId,
        agentId: 'main',
        turnId,
        toolCallId,
        name: 'Bash',
        args: { command: 'echo hi' },
      } as Event,
      {
        type: 'tool.result',
        sessionId,
        agentId: 'main',
        turnId,
        toolCallId,
        output: 'hello world',
        isError: false,
      } as Event,
      { type: 'turn.ended', sessionId, agentId: 'main', turnId, reason: 'completed' } as Event,
    ]);
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async () => session,
    } as unknown as LioraHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const collecting = new CollectingClient();
    const client = new ClientSideConnection(() => collecting, clientStream);
    await client.newSession({ cwd: '/tmp/x', mcpServers: [] });
    await client.prompt({ sessionId, prompt: [textBlock('go')] });
    await flushNdjson();

    // 1 start + 1 result = 2 updates.
    expect(collecting.promptUpdates).toHaveLength(2);
    expect(collecting.promptUpdates[1]?.update).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: `${turnId}:${toolCallId}`,
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'hello world' } },
      ],
      rawOutput: 'hello world',
    });
  });

  it('emits status=failed when isError is true', async () => {
    const sessionId = 'sess-tr-err';
    const turnId = 1;
    const toolCallId = 'tc-err';
    const session = makeScriptedSession(sessionId, [
      {
        type: 'tool.call.started',
        sessionId,
        agentId: 'main',
        turnId,
        toolCallId,
        name: 'Bash',
        args: { command: 'false' },
      } as Event,
      {
        type: 'tool.result',
        sessionId,
        agentId: 'main',
        turnId,
        toolCallId,
        output: 'oops',
        isError: true,
      } as Event,
      { type: 'turn.ended', sessionId, agentId: 'main', turnId, reason: 'completed' } as Event,
    ]);
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async () => session,
    } as unknown as LioraHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const collecting = new CollectingClient();
    const client = new ClientSideConnection(() => collecting, clientStream);
    await client.newSession({ cwd: '/tmp/x', mcpServers: [] });
    await client.prompt({ sessionId, prompt: [textBlock('go')] });
    await flushNdjson();

    const toolUpdates = collecting.updates.filter(
      (u) => (u.update as { sessionUpdate?: string }).sessionUpdate !==
        'available_commands_update',
    );
    const last = toolUpdates.at(-1)?.update as { sessionUpdate: string; status: string };
    expect(last.sessionUpdate).toBe('tool_call_update');
    expect(last.status).toBe('failed');
  });

  it('emits status=completed with empty content array for empty output', async () => {
    const sessionId = 'sess-tr-empty';
    const turnId = 1;
    const toolCallId = 'tc-empty';
    const session = makeScriptedSession(sessionId, [
      {
        type: 'tool.call.started',
        sessionId,
        agentId: 'main',
        turnId,
        toolCallId,
        name: 'Bash',
        args: { command: 'true' },
      } as Event,
      {
        type: 'tool.result',
        sessionId,
        agentId: 'main',
        turnId,
        toolCallId,
        output: '',
        isError: false,
      } as Event,
      { type: 'turn.ended', sessionId, agentId: 'main', turnId, reason: 'completed' } as Event,
    ]);
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async () => session,
    } as unknown as LioraHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const collecting = new CollectingClient();
    const client = new ClientSideConnection(() => collecting, clientStream);
    await client.newSession({ cwd: '/tmp/x', mcpServers: [] });
    await client.prompt({ sessionId, prompt: [textBlock('go')] });
    await flushNdjson();

    const toolUpdates = collecting.updates.filter(
      (u) => (u.update as { sessionUpdate?: string }).sessionUpdate !==
        'available_commands_update',
    );
    const last = toolUpdates.at(-1)?.update as {
      sessionUpdate: string;
      status: string;
      content: unknown[];
    };
    expect(last.sessionUpdate).toBe('tool_call_update');
    expect(last.status).toBe('completed');
    expect(last.content).toEqual([]);
  });
});

describe('native tool display propagation', () => {
  it.each([
    {
      name: 'Bash',
      args: { command: 'printf bar > a.txt' },
      display: { kind: 'command', command: 'printf bar > a.txt' },
      text: 'printf bar > a.txt',
    },
    {
      name: 'SessionControl',
      args: { operation: 'inspect', sessionId: 'worker-one' },
      display: { kind: 'generic', summary: 'Inspect worker-one' },
      text: 'Inspect worker-one',
    },
  ] as const)('preserves $name display in both create and streamed upgrade', ({ name, args, display, text }) => {
    const event = {
      type: 'tool.call.started' as const,
      turnId: 7,
      toolCallId: 'native-call',
      name,
      args,
      display,
    };
    for (const map of [toolCallStartToSessionUpdate, toolCallStartedUpgradeToSessionUpdate]) {
      const update = map('session-one', event).update;
      expect(update).toMatchObject({
        toolCallId: '7:native-call',
        title: name,
        status: 'in_progress',
        rawInput: args,
        content: [
          { type: 'content', content: { type: 'text', text } },
          { type: 'content', content: { type: 'text', text: JSON.stringify(args) } },
        ],
      });
    }
  });
});
