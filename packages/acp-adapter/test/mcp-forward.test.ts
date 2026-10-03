import { describe, expect, it, vi } from 'vitest';

import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { LioraHarness, Session } from '@superliora/sdk';

import { AcpServer } from '../src/server';
import { AUTHED_STATUS } from './_helpers/harness-stubs';

class StubClient implements Client {
  async requestPermission(_p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    throw new Error('Unexpected permission request');
  }
  async sessionUpdate(_n: SessionNotification): Promise<void> {}
  async writeTextFile(_p: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error('Unexpected file write');
  }
  async readTextFile(_p: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    throw new Error('Unexpected file read');
  }
}

function makeBoundary() {
  const sessionId = 'sess-native';
  const session = {
    id: sessionId,
    prompt: async () => undefined,
    cancel: async () => undefined,
    onEvent: () => () => undefined,
    getResumeState: () => ({
      agents: {
        main: {
          permission: { mode: 'manual' },
          context: { history: [], tokenCount: 0 },
        },
      },
    }),
  } as unknown as Session;
  const createSession = vi.fn(async (_options: unknown) => session);
  const resumeSession = vi.fn(async (_options: unknown) => session);
  const harness = {
    auth: { status: async () => AUTHED_STATUS },
    createSession,
    resumeSession,
  } as unknown as LioraHarness;
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection(
    (conn) => new AcpServer(harness, conn),
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );
  const client = new ClientSideConnection(
    () => new StubClient(),
    ndJsonStream(clientToAgent.writable, agentToClient.readable),
  );
  return { client, sessionId, createSession, resumeSession };
}

const servers: Array<{ transport: string; server: McpServer }> = [
  {
    transport: 'stdio',
    server: { name: 'external', command: '/bin/external', args: [], env: [] },
  },
  {
    transport: 'http',
    server: { type: 'http', name: 'external', url: 'https://example.com/mcp', headers: [] },
  },
  {
    transport: 'sse',
    server: { type: 'sse', name: 'external', url: 'https://example.com/sse', headers: [] },
  },
];

for (const method of ['newSession', 'loadSession', 'resumeSession'] as const) {
  describe(`AcpServer ${method} native MCP boundary`, () => {
    it.each(servers)('rejects nonempty $transport lists with invalid_params before opening a session', async ({ server }) => {
      const boundary = makeBoundary();
      await expect(
        boundary.client[method]({
          sessionId: boundary.sessionId,
          cwd: '/tmp/work',
          mcpServers: [server],
        }),
      ).rejects.toMatchObject({ code: -32602 });
      expect(boundary.createSession).not.toHaveBeenCalled();
      expect(boundary.resumeSession).not.toHaveBeenCalled();
    });

    it('accepts an empty list without forwarding MCP configuration', async () => {
      const boundary = makeBoundary();
      const response = await boundary.client[method]({
        sessionId: boundary.sessionId,
        cwd: '/tmp/work',
        mcpServers: [],
      });
      if (method === 'newSession') {
        expect(response).toMatchObject({ sessionId: boundary.sessionId });
        expect(boundary.createSession).toHaveBeenCalledTimes(1);
        expect(boundary.createSession.mock.calls[0]).toEqual([
          expect.objectContaining({ workDir: '/tmp/work' }),
        ]);
        expect(boundary.resumeSession).not.toHaveBeenCalled();
      } else {
        expect(boundary.resumeSession).toHaveBeenCalledTimes(1);
        expect(boundary.resumeSession.mock.calls[0]).toEqual([
          expect.objectContaining({ id: boundary.sessionId }),
        ]);
        expect(boundary.createSession).not.toHaveBeenCalled();
      }
      const calls = method === 'newSession'
        ? boundary.createSession.mock.calls
        : boundary.resumeSession.mock.calls;
      expect(calls[0]?.[0]).not.toHaveProperty('mcpServers');
    });
  });
}
