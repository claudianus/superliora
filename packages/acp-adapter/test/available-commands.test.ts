import { describe, expect, it } from 'vitest';

import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Client,
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
import { availableCommandsUpdateNotification } from '../src/convert/events-map';
import { ACP_BUILTIN_SLASH_COMMANDS } from '../src/builtin-commands';

class CollectingClient implements Client {
  readonly updates: SessionNotification[] = [];

  async requestPermission(_p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    throw new Error(
      'CollectingClient.requestPermission should not be called in available-commands test',
    );
  }
  async sessionUpdate(n: SessionNotification): Promise<void> {
    this.updates.push(n);
  }
  async writeTextFile(_p: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error(
      'CollectingClient.writeTextFile should not be called in available-commands test',
    );
  }
  async readTextFile(_p: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    throw new Error(
      'CollectingClient.readTextFile should not be called in available-commands test',
    );
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
  const session = {
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
  return session;
}


async function flushNdjson(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}


describe('Phase 9.3 unit · availableCommandsUpdateNotification', () => {
  it('builds an available_commands_update with an empty list by default', () => {
    expect(availableCommandsUpdateNotification('sess-z')).toEqual({
      sessionId: 'sess-z',
      update: { sessionUpdate: 'available_commands_update', availableCommands: [] },
    });
  });

  it('passes a caller-supplied command list through', () => {
    const cmds = [
      { name: 'help', description: 'Show help' },
      { name: 'clear', description: 'Clear the screen' },
    ];
    const note = availableCommandsUpdateNotification('sess-z', cmds);
    expect(note.update).toEqual({
      sessionUpdate: 'available_commands_update',
      availableCommands: cmds,
    });
  });
});

describe('newSession available commands', () => {
  it('newSession returns and the client sees exactly one available_commands_update', async () => {
    const sessionId = 'sess-cmds-new';
    const session = makeScriptedSession(sessionId, []);
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async () => session,
    } as unknown as LioraHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const collecting = new CollectingClient();
    const client = new ClientSideConnection(() => collecting, clientStream);

    const response = await client.newSession({ cwd: '/tmp/x', mcpServers: [] });
    expect(response.sessionId).toBe(sessionId);
    await flushNdjson();

    const cmdUpdates = collecting.updates.filter(
      (n) =>
        (n.update as { sessionUpdate: string }).sessionUpdate ===
        'available_commands_update',
    );
    expect(cmdUpdates).toHaveLength(1);
    expect(cmdUpdates[0]?.sessionId).toBe(sessionId);
    expect(cmdUpdates[0]?.update).toMatchObject({
      sessionUpdate: 'available_commands_update',
      availableCommands: ACP_BUILTIN_SLASH_COMMANDS,
    });
  });
});

describe('loadSession available commands', () => {
  it('loadSession returns and the client sees exactly one available_commands_update (not duplicated during replay)', async () => {
    const sessionId = 'sess-cmds-load';
    const session = {
      id: sessionId,
      cancel: async () => undefined,
      prompt: async () => undefined,
      onEvent: (_fn: (event: Event) => void) => () => undefined,
      setApprovalHandler: () => undefined,
      getResumeState: () => ({
        agents: {
          main: {
            permission: { mode: 'manual' },
            context: {
              tokenCount: 1,
              history: [
                {
                  role: 'user',
                  content: [{ type: 'text', text: 'hi' }],
                  toolCalls: [],
                },
              ],
            },
          },
        },
      }),
    } as unknown as Session;
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      resumeSession: async (_opts: { id: string }) => session,
    } as unknown as LioraHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const collecting = new CollectingClient();
    const client = new ClientSideConnection(() => collecting, clientStream);

    await client.loadSession({ sessionId, cwd: '/tmp/x', mcpServers: [] });
    await flushNdjson();

    const cmdUpdates = collecting.updates.filter(
      (n) =>
        (n.update as { sessionUpdate: string }).sessionUpdate ===
        'available_commands_update',
    );
    expect(cmdUpdates).toHaveLength(1);
    expect(cmdUpdates[0]?.update).toMatchObject({
      sessionUpdate: 'available_commands_update',
      availableCommands: ACP_BUILTIN_SLASH_COMMANDS,
    });
  });
});

