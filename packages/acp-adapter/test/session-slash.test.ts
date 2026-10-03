import { describe, expect, it, vi } from 'vitest';

import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import type { Event, LioraHarness, Session } from '@superliora/sdk';

import { AcpServer } from '../src/server';
import { AUTHED_STATUS } from './_helpers/harness-stubs';

class CollectingClient implements Client {
  readonly updates: SessionNotification[] = [];
  readonly commands = Promise.withResolvers<void>();

  async requestPermission(_params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    throw new Error('requestPermission should not be called');
  }

  async sessionUpdate(notification: SessionNotification): Promise<void> {
    this.updates.push(notification);
    if (notification.update.sessionUpdate === 'available_commands_update') this.commands.resolve();
  }

  get messages(): string[] {
    return this.updates.flatMap(({ update }) =>
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
        ? [update.content.text]
        : [],
    );
  }
}

function makeFakeSession(sessionId: string) {
  const listeners = new Set<(event: Event) => void>();
  const emit = (event: Event): void => {
    for (const listener of listeners) listener(event);
  };
  const prompt = vi.fn(async () => {
    emit({ type: 'turn.ended', sessionId, agentId: 'main', turnId: 1, reason: 'completed' } as Event);
  });
  const compact = vi.fn(async (_options: { instruction?: string }) => {
    emit({ type: 'compaction.started', sessionId, agentId: 'main' } as Event);
    emit({
      type: 'compaction.completed', sessionId, agentId: 'main',
      result: { compactedCount: 4, tokensBefore: 5000, tokensAfter: 1000 },
    } as Event);
  });
  const getStatus = vi.fn(async () => ({
    model: 'mock-model', thinkingLevel: 'high', permission: 'manual',
    contextTokens: 1234, maxContextTokens: 200_000, contextUsage: 0.00617,
  }));
  const getUsage = vi.fn(async () => ({
    total: { inputOther: 20, output: 10, inputCacheRead: 30, inputCacheCreation: 40 },
    byModel: { 'mock-model': { inputOther: 20, output: 10, inputCacheRead: 30, inputCacheCreation: 40 } },
  }));
  const listBackgroundTasks = vi.fn(async () => [{
    kind: 'process', taskId: 'bash-1', status: 'running', description: 'build assets',
    command: 'bun run build', pid: 123, exitCode: null, startedAt: 1, endedAt: null,
  }]);
  const unsubscribe = vi.fn();
  const session = {
    id: sessionId, prompt, compact, getStatus, getUsage, listBackgroundTasks,
    cancel: async () => undefined,
    onEvent: (listener: (event: Event) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); unsubscribe(); };
    },
  } as unknown as Session;
  return { session, prompt, compact, getStatus, getUsage, listBackgroundTasks, emit, unsubscribe };
}

async function openSession(session: Session) {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const harness = {
    auth: { status: async () => AUTHED_STATUS },
    createSession: async () => session,
    getConfig: async () => ({ providers: {}, models: {} }),
  } as unknown as LioraHarness;
  new AgentSideConnection(
    (connection) => new AcpServer(harness, connection),
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );
  const collecting = new CollectingClient();
  const client = new ClientSideConnection(
    () => collecting, ndJsonStream(clientToAgent.writable, agentToClient.readable),
  );
  const { sessionId } = await client.newSession({ cwd: '/tmp/x', mcpServers: [] });
  await collecting.commands.promise;
  const send = (text: string) => client.prompt({ sessionId, prompt: [{ type: 'text', text }] });
  return { client, collecting, send, sessionId };
}

describe('AcpSession native slash routing', () => {
  it.each(['/clear', '/unknown argument', '/skill:foo bar', '/plan'])(
    'reports unsupported %s locally without invoking the model',
    async (command) => {
      const handle = makeFakeSession('sess-unknown');
      const { send, collecting } = await openSession(handle.session);
      await expect(send(command)).resolves.toEqual({ stopReason: 'end_turn' });
      expect(handle.prompt).not.toHaveBeenCalled();
      expect(handle.compact).not.toHaveBeenCalled();
      expect(collecting.messages.join('\n')).toContain(`Unknown ACP command: ${command.split(' ')[0]}`);
    },
  );

  it('passes ordinary text and embedded slash text through to Session.prompt', async () => {
    const handle = makeFakeSession('sess-text');
    const { send } = await openSession(handle.session);
    await send('hello world');
    await send('please explain /status');
    expect(handle.prompt).toHaveBeenCalledTimes(2);
  });

  it('advertises only native builtins and renders that palette through /help', async () => {
    const handle = makeFakeSession('sess-help');
    const { send, collecting } = await openSession(handle.session);
    const update = collecting.updates.find((n) => n.update.sessionUpdate === 'available_commands_update')!.update;
    if (update.sessionUpdate !== 'available_commands_update') throw new Error('expected commands');
    expect(update.availableCommands.map((command) => command.name)).toEqual(['compact', 'status', 'usage', 'tasks', 'help']);
    await send('/help');
    expect(handle.prompt).not.toHaveBeenCalled();
    expect(collecting.messages.join('\n')).toContain('Available ACP commands:');
    for (const name of ['compact', 'status', 'usage', 'tasks', 'help']) {
      expect(collecting.messages.join('\n')).toContain(`/${name}`);
    }
  });

  it('renders native status without invoking the model', async () => {
    const handle = makeFakeSession('sess-status');
    const { send, collecting } = await openSession(handle.session);
    await send('/status');
    expect(handle.getStatus).toHaveBeenCalledTimes(1);
    expect(handle.prompt).not.toHaveBeenCalled();
    const text = collecting.messages.join('\n');
    expect(text).toContain('Model: mock-model');
    expect(text).toContain('Thinking: high');
    expect(text).toContain('Permission: manual');
    expect(text).toContain('Context: 1,234 / 200,000 (0.6%)');
  });

  it('renders usage and running background tasks from the SDK', async () => {
    const handle = makeFakeSession('sess-reports');
    const { send, collecting } = await openSession(handle.session);
    await send('/usage');
    await send('/tasks');
    expect(handle.getUsage).toHaveBeenCalledTimes(1);
    expect(handle.listBackgroundTasks).toHaveBeenCalledTimes(1);
    expect(handle.prompt).not.toHaveBeenCalled();
    const text = collecting.messages.join('\n');
    expect(text).toContain('input 20, output 10, cache read 30, cache creation 40');
    expect(text).toContain('mock-model');
    expect(text).toContain('bash-1: running');
    expect(text).toContain('command=bun run build');
  });

  it.each([
    { command: '/compact', instruction: undefined },
    { command: '/compact keep failing commands', instruction: 'keep failing commands' },
  ])('runs explicit $command with Session.compact({instruction})', async ({ command, instruction }) => {
    const handle = makeFakeSession('sess-compact');
    const { send, collecting } = await openSession(handle.session);
    await expect(send(command)).resolves.toEqual({ stopReason: 'end_turn' });
    expect(handle.compact).toHaveBeenCalledTimes(1);
    expect(handle.compact).toHaveBeenCalledWith({ instruction });
    expect(handle.prompt).not.toHaveBeenCalled();
    expect(handle.unsubscribe).toHaveBeenCalledTimes(1);
    const text = collecting.messages.join('\n');
    expect(text).toContain('Compaction completed.');
    expect(text).toContain('Messages compacted: 4');
    expect(text).toContain('Tokens before: 5,000');
    expect(text).toContain('Tokens after: 1,000');
  });

  it('waits for the actual compaction terminal event and ignores worker terminal events', async () => {
    const handle = makeFakeSession('sess-compact-pending');
    const started = Promise.withResolvers<void>();
    handle.compact.mockImplementation(async () => {
      handle.emit({ type: 'compaction.started', sessionId: handle.session.id, agentId: 'main' } as Event);
      started.resolve();
    });
    const { send, collecting } = await openSession(handle.session);
    let settled = false;
    const pending = send('/compact').then((response) => { settled = true; return response; });
    await started.promise;
    handle.emit({ type: 'compaction.cancelled', sessionId: handle.session.id, agentId: 'worker' } as Event);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(handle.unsubscribe).not.toHaveBeenCalled();
    handle.emit({ type: 'compaction.cancelled', sessionId: handle.session.id, agentId: 'main' } as Event);
    await expect(pending).resolves.toEqual({ stopReason: 'end_turn' });
    expect(handle.unsubscribe).toHaveBeenCalledTimes(1);
    expect(collecting.messages.join('\n')).toContain('Compaction cancelled.');
  });

  it('reports native command errors locally', async () => {
    const handle = makeFakeSession('sess-command-error');
    handle.getStatus.mockRejectedValueOnce(new Error('status unavailable'));
    handle.compact.mockRejectedValueOnce(new Error('compaction blocked'));
    const { send, collecting } = await openSession(handle.session);
    await expect(send('/status')).resolves.toEqual({ stopReason: 'end_turn' });
    await expect(send('/compact')).resolves.toEqual({ stopReason: 'end_turn' });
    expect(collecting.messages.join('\n')).toContain('/status failed: status unavailable');
    expect(collecting.messages.join('\n')).toContain('/compact failed: compaction blocked');
    expect(handle.unsubscribe).toHaveBeenCalledTimes(1);
    expect(handle.prompt).not.toHaveBeenCalled();
  });
});
