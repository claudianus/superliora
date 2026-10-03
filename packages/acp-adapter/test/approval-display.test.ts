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
  type ToolCallContent,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type {
  ApprovalHandler,
  ApprovalRequest,
  ApprovalResponse,
  Event,
  LioraHarness,
  Session,
} from '@superliora/sdk';
import { describe, expect, it } from 'vitest';

import {
  APPROVE_ALWAYS_OPTION_ID,
  APPROVE_ONCE_OPTION_ID,
  buildPermissionToolCallUpdate,
} from '../src/approval';
import { AcpServer } from '../src/server';
import { AUTHED_STATUS } from './_helpers/harness-stubs';

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

function makeApprovalSession(sessionId: string): {
  session: Session;
  emit: (event: Event) => void;
  invokeHandler: (req: ApprovalRequest) => Promise<ApprovalResponse> | ApprovalResponse;
  resolvePrompt: () => void;
} {
  const listeners = new Set<(event: Event) => void>();
  let approvalHandler: ApprovalHandler | undefined;
  let releasePrompt: (() => void) | undefined;

  const session = {
    id: sessionId,
    prompt: async (_input: unknown) => {
      await new Promise<void>((resolve) => {
        releasePrompt = resolve;
      });
    },
    cancel: async () => undefined,
    onEvent: (fn: (event: Event) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setApprovalHandler: (handler: ApprovalHandler | undefined) => {
      approvalHandler = handler;
    },
  } as unknown as Session;

  return {
    session,
    emit: (event: Event) => {
      for (const fn of listeners) fn(event);
    },
    invokeHandler: (req: ApprovalRequest) => {
      if (!approvalHandler) {
        throw new Error('approval handler was not registered by AcpSession');
      }
      return approvalHandler(req);
    },
    resolvePrompt: () => releasePrompt?.(),
  };
}

class ApprovalDisplayClient implements Client {
  readonly updates: SessionNotification[] = [];
  readonly permissionRequests: RequestPermissionRequest[] = [];
  reply: RequestPermissionResponse = {
    outcome: { outcome: 'selected', optionId: APPROVE_ONCE_OPTION_ID },
  };

  async requestPermission(
    p: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    this.permissionRequests.push(p);
    return this.reply;
  }
  async sessionUpdate(n: SessionNotification): Promise<void> {
    this.updates.push(n);
  }
  async writeTextFile(_p: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error('not used in approval-display test');
  }
  async readTextFile(_p: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    throw new Error('not used in approval-display test');
  }
}

const textBlock = (text: string): ContentBlock => ({ type: 'text', text });

describe('buildPermissionToolCallUpdate', () => {
  it('shows the exact Bash command and approval action', () => {
    const update = buildPermissionToolCallUpdate(5, {
      toolCallId: 'tc-cmd',
      toolName: 'Bash',
      action: 'run shell command',
      display: { kind: 'command', command: 'ls -la' },
    });
    expect(update.toolCallId).toBe('5:tc-cmd');
    expect(update.title).toBe('Bash');
    expect(update.content).toEqual([
      { type: 'content', content: { type: 'text', text: 'ls -la' } },
      {
        type: 'content',
        content: { type: 'text', text: 'Requesting approval to run shell command' },
      },
    ]);
  });

  it('shows the SessionControl operation summary', () => {
    const update = buildPermissionToolCallUpdate(6, {
      toolCallId: 'tc-session',
      toolName: 'SessionControl',
      action: 'stop worker',
      display: { kind: 'generic', summary: 'Stop session worker-one' },
    });
    expect(update.title).toBe('SessionControl');
    expect(update.content).toEqual([
      { type: 'content', content: { type: 'text', text: 'Stop session worker-one' } },
      {
        type: 'content',
        content: { type: 'text', text: 'Requesting approval to stop worker' },
      },
    ]);
  });
});


describe('AcpSession ↔ requestPermission bridge', () => {
  it('returns session-scoped consent and displays the exact Bash command', async () => {
    const sessionId = 'sess-approval-display';
    const turnId = 11;
    const handle = makeApprovalSession(sessionId);
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async () => handle.session,
    } as unknown as LioraHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const client = new ApprovalDisplayClient();
    client.reply = {
      outcome: { outcome: 'selected', optionId: APPROVE_ALWAYS_OPTION_ID },
    };
    const clientConn = new ClientSideConnection(() => client, clientStream);

    await clientConn.newSession({ cwd: '/tmp/x', mcpServers: [] });

    const pending = clientConn.prompt({
      sessionId,
      prompt: [textBlock('approve me')],
    });
    // Let the agent-side subscribe before we emit events.
    await new Promise((r) => setTimeout(r, 5));

    handle.emit({
      type: 'tool.call.started',
      sessionId,
      agentId: 'main',
      turnId,
      toolCallId: 'edit-1',
      name: 'Bash',
      args: { command: "printf new > /tmp/x.ts" },
    } as Event);

    const decision = await handle.invokeHandler({
      toolCallId: 'edit-1',
      toolName: 'Bash',
      action: 'edit file',
      display: { kind: 'command', command: 'printf new > /tmp/x.ts' },
    });

    expect(decision).toEqual({
      decision: 'approved',
      scope: 'session',
    });

    expect(client.permissionRequests).toHaveLength(1);
    const req = client.permissionRequests[0]!;
    expect(req.toolCall.toolCallId).toBe(`${turnId}:edit-1`);
    expect(req.toolCall.title).toBe('Bash');
    expect(req.toolCall.content).toHaveLength(2);
    const [command, action] = req.toolCall.content as [ToolCallContent, ToolCallContent];
    expect(command).toEqual({
      type: 'content',
      content: { type: 'text', text: 'printf new > /tmp/x.ts' },
    });
    expect(action).toEqual({
      type: 'content',
      content: { type: 'text', text: 'Requesting approval to edit file' },
    });

    handle.emit({
      type: 'turn.ended',
      sessionId,
      agentId: 'main',
      turnId,
      reason: 'completed',
    } as Event);
    handle.resolvePrompt();
    await pending;
  });
});
