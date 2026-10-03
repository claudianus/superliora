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
import type {
  ApprovalHandler,
  Event,
  LioraHarness,
  PermissionMode,
  Session,
} from '@superliora/sdk';

import { AcpServer } from '../src/server';
import { AUTHED_STATUS, makeModelsMap } from './_helpers/harness-stubs';

/**
 * Captures every `session/update` notification the server pushes so
 * `setMode` tests can assert the `config_option_update` payload (Phase
 * 14.3). The other reverse-RPC methods continue to throw because no
 * test under the `session/set_mode` or `session/unstable_setSessionModel`
 * describe blocks exercises them; surfacing an explicit error keeps
 * unintended paths loud rather than silently capturing them.
 */
class CapturingClient implements Client {
  readonly notifications: SessionNotification[] = [];
  async requestPermission(_p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    throw new Error('CapturingClient.requestPermission should not be called in session-control test');
  }
  async sessionUpdate(n: SessionNotification): Promise<void> {
    this.notifications.push(n);
  }
  async writeTextFile(_p: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error('CapturingClient.writeTextFile should not be called in session-control test');
  }
  async readTextFile(_p: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    throw new Error('CapturingClient.readTextFile should not be called in session-control test');
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

interface FakeSessionOverrides {
  setPermissionError?: Error;
}

interface FakeSessionHandle {
  session: Session;
  setPermissionCalls: PermissionMode[];
  setModelCalls: string[];
  setThinkingCalls: string[];
}

function makeFakeSession(
  sessionId: string,
  overrides: FakeSessionOverrides = {},
): FakeSessionHandle {
  const setPermissionCalls: PermissionMode[] = [];
  const setModelCalls: string[] = [];
  const setThinkingCalls: string[] = [];
  const session = {
    id: sessionId,
    prompt: async () => undefined,
    cancel: async () => undefined,
    onEvent: (_fn: (event: Event) => void) => () => undefined,
    setApprovalHandler: (_handler: ApprovalHandler | undefined) => undefined,
    setPermission: async (mode: PermissionMode) => {
      if (overrides.setPermissionError !== undefined) throw overrides.setPermissionError;
      setPermissionCalls.push(mode);
    },
    setModel: async (model: string) => {
      setModelCalls.push(model);
    },
    setThinking: async (level: string) => {
      setThinkingCalls.push(level);
    },
  } as unknown as Session;
  return { session, setPermissionCalls, setModelCalls, setThinkingCalls };
}

function makeHarness(handle: FakeSessionHandle): LioraHarness {
  return {
    auth: { status: async () => AUTHED_STATUS },
    createSession: async (_options: unknown) => handle.session,
    // Phase 14: server.newSession reads these for configOptions assembly.
    getConfig: async () => ({
      providers: {},
      defaultModel: 'kimi-coder',
      models: makeModelsMap([{ id: 'kimi-coder', name: 'Kimi Coder', thinkingSupported: false }]),
    }),
  } as unknown as LioraHarness;
}

async function openSession(
  harness: LioraHarness,
): Promise<{ client: ClientSideConnection; capturing: CapturingClient; sessionId: string }> {
  const { agentStream, clientStream } = makeInMemoryStreamPair();
  new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
  const capturing = new CapturingClient();
  const client = new ClientSideConnection((_a) => capturing, clientStream);
  const response = await client.newSession({ cwd: '/tmp/x', mcpServers: [] });
  return { client, capturing, sessionId: response.sessionId };
}

describe('AcpServer session/set_mode', () => {
  const MODE_CASES: ReadonlyArray<{
    modeId: 'manual' | 'auto' | 'yolo';
    expectedPermission: PermissionMode;
  }> = [
    { modeId: 'manual', expectedPermission: 'manual' },
    { modeId: 'auto', expectedPermission: 'auto' },
    { modeId: 'yolo', expectedPermission: 'yolo' },
  ];

  for (const { modeId, expectedPermission } of MODE_CASES) {
    it(`forwards "${modeId}" → setPermission(${expectedPermission}) + emits config_option_update`, async () => {
      const handle = makeFakeSession(`sess-${modeId}`);
      const harness = makeHarness(handle);
      const { client, capturing, sessionId } = await openSession(harness);

      await client.setSessionMode({ sessionId, modeId });

      expect(handle.setPermissionCalls).toEqual([expectedPermission]);

      const updates = capturing.notifications.filter(
        (n) => n.sessionId === sessionId && n.update.sessionUpdate === 'config_option_update',
      );
      expect(updates).toHaveLength(1);
      const update = updates[0]!.update;
      if (update.sessionUpdate !== 'config_option_update') {
        throw new Error('unreachable: filtered above');
      }
      // Phase 14.3: payload is the full SessionConfigOption snapshot;
      // the mode picker's currentValue reflects the just-applied mode.
      const modeOpt = update.configOptions.find((o) => o.id === 'mode');
      expect(modeOpt).toBeDefined();
      if (modeOpt && modeOpt.type === 'select') {
        expect(modeOpt.currentValue).toBe(modeId);
      }
      // Cross-check the model picker is still in the snapshot so a
      // client subscribed to one channel can repaint both dropdowns.
      const modelOpt = update.configOptions.find((o) => o.id === 'model');
      expect(modelOpt).toBeDefined();
    });
  }

  it.each(['turbo', 'default', 'plan'])('rejects unsupported modeId %s before SDK calls or notifications', async (modeId) => {
    const handle = makeFakeSession('sess-bad-mode');
    const harness = makeHarness(handle);
    const { client, capturing, sessionId } = await openSession(harness);

    await expect(
      client.setSessionMode({ sessionId, modeId }),
    ).rejects.toMatchObject({ code: -32602 });

    expect(handle.setPermissionCalls).toEqual([]);
    const updates = capturing.notifications.filter(
      (n) => n.update.sessionUpdate === 'config_option_update',
    );
    expect(updates).toEqual([]);
  });

  it('rejects unknown sessionId with invalid_params and does not call setPermission', async () => {
    const handle = makeFakeSession('sess-known');
    const harness = makeHarness(handle);
    const { client } = await openSession(harness);

    await expect(
      client.setSessionMode({ sessionId: 'sess-unknown', modeId: 'manual' }),
    ).rejects.toMatchObject({ code: -32602 });

    expect(handle.setPermissionCalls).toEqual([]);
  });

  it('propagates SDK errors from setPermission and suppresses the notification', async () => {
    const handle = makeFakeSession('sess-permission-error', {
      setPermissionError: new Error('boom: setPermission failed'),
    });
    const harness = makeHarness(handle);
    const { client, capturing, sessionId } = await openSession(harness);

    // The thrown SDK Error is opaque to the JSON-RPC layer; the only
    // contract we assert is that the request rejects (not an
    // invalid_params -32602, which would mean the adapter swallowed and
    // re-mapped the SDK error — see §4 "What you must NOT do").
    await expect(
      client.setSessionMode({ sessionId, modeId: 'auto' }),
    ).rejects.toBeDefined();

    expect(handle.setPermissionCalls).toEqual([]);
    const updates = capturing.notifications.filter(
      (n) => n.update.sessionUpdate === 'config_option_update',
    );
    expect(updates).toEqual([]); // notification suppressed on SDK error
  });
});

describe('AcpServer session/unstable_setSessionModel', () => {
  it('forwards modelId to Session.setModel exactly once + emits one config_option_update', async () => {
    const handle = makeFakeSession('sess-model');
    const harness = makeHarness(handle);
    const { client, capturing, sessionId } = await openSession(harness);

    await client.unstable_setSessionModel({ sessionId, modelId: 'kimi-v2-something' });

    expect(handle.setModelCalls).toEqual(['kimi-v2-something']);
    const updates = capturing.notifications.filter(
      (n) => n.sessionId === sessionId && n.update.sessionUpdate === 'config_option_update',
    );
    expect(updates).toHaveLength(1);
    const update = updates[0]!.update;
    if (update.sessionUpdate !== 'config_option_update') {
      throw new Error('unreachable: filtered above');
    }
    const modelOpt = update.configOptions.find((o) => o.id === 'model');
    expect(modelOpt).toBeDefined();
    if (modelOpt && modelOpt.type === 'select') {
      expect(modelOpt.currentValue).toBe('kimi-v2-something');
    }
  });

  it('passes a comma-containing model id intact without changing thinking', async () => {
    const handle = makeFakeSession('sess-model-thinking');
    // Only the exact catalog id supports thinking; no suffix alias is resolved.
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async () => handle.session,
      getConfig: async () => ({
        providers: {},
        defaultModel: 'kimi-v2-something',
        models: makeModelsMap([
          { id: 'kimi-v2-something', name: 'Kimi v2 something', thinkingSupported: true },
        ]),
      }),
    } as unknown as LioraHarness;
    const { client, capturing, sessionId } = await openSession(harness);

    await client.unstable_setSessionModel({
      sessionId,
      modelId: 'kimi-v2-something,thinking',
    });

    expect(handle.setModelCalls).toEqual(['kimi-v2-something,thinking']);
    expect(handle.setThinkingCalls).toEqual([]);
    const updates = capturing.notifications.filter(
      (n) => n.update.sessionUpdate === 'config_option_update',
    );
    expect(updates).toHaveLength(1);
    const update = updates[0]!.update;
    if (update.sessionUpdate !== 'config_option_update') throw new Error('unreachable');
    const modelOpt = update.configOptions.find((o) => o.id === 'model');
    if (modelOpt && modelOpt.type === 'select') {
      expect(modelOpt.currentValue).toBe('kimi-v2-something,thinking');
    }
    expect(update.configOptions.some((o) => o.id === 'thinking')).toBe(false);
  });

  it('rejects unknown sessionId with invalid_params and does not call setModel or emit notifications', async () => {
    const handle = makeFakeSession('sess-known');
    const harness = makeHarness(handle);
    const { client, capturing } = await openSession(harness);

    await expect(
      client.unstable_setSessionModel({ sessionId: 'sess-unknown', modelId: 'kimi-v2' }),
    ).rejects.toMatchObject({ code: -32602 });

    expect(handle.setModelCalls).toEqual([]);
    const updates = capturing.notifications.filter(
      (n) => n.update.sessionUpdate === 'config_option_update',
    );
    expect(updates).toEqual([]);
  });

  // Parameterised across 4 model ids — verifies the model-switch path
  // emits one config_option_update per call, mirroring the mode-switch
  // table above so a future regression in the funnel (Phase 14.3) hits
  // both pickers.
  for (const modelId of ['alpha', 'beta', 'gamma,thinking', 'delta']) {
    it(`emits exactly one config_option_update for setSessionModel(${modelId})`, async () => {
      const handle = makeFakeSession(`sess-${modelId.replace(',', '-')}`);
      const harness = makeHarness(handle);
      const { client, capturing, sessionId } = await openSession(harness);

      await client.unstable_setSessionModel({ sessionId, modelId });

      const updates = capturing.notifications.filter(
        (n) => n.sessionId === sessionId && n.update.sessionUpdate === 'config_option_update',
      );
      expect(updates).toHaveLength(1);
    });
  }
});
