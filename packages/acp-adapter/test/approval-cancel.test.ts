/**
 * Regression coverage for the `session/cancel` ⇄ pending
 * `session/request_permission` interaction.
 *
 * Background. The SDK reverse-RPC layer parks `handleApproval` at
 * `conn.requestPermission` until the client answers. When the user
 * (or the IDE shutting down) sends `session/cancel` mid-await, two
 * invariants must hold:
 *
 *  1. The cancel notification flows through unblocked — neither the
 *     JSON-RPC layer nor `AcpServer.cancel` may be queued behind the
 *     parked `requestPermission`. `Session.cancel()` must observe the
 *     notification immediately so it can tear down the turn.
 *
 *  2. When the client subsequently honours the cancel by responding
 *     `outcome: 'cancelled'` to the still-pending request, the bridge
 *     must surface `{ decision: 'cancelled' }` to the SDK — not
 *     `rejected` (which would be a confusing audit trail) and not
 *     leak the await (which would wedge the next turn).
 *
 * Cancellation acknowledgement is not turn settlement: pending permission
 * and prompt requests remain live until their native operations finish.
 */

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
import type {
  ApprovalHandler,
  ApprovalRequest,
  ApprovalResponse,
  Event,
  LioraHarness,
  Session,
} from '@superliora/sdk';

import { APPROVE_ONCE_OPTION_ID } from '../src/approval';
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

/**
 * Scripted SDK Session that parks `prompt()` and exposes hooks for the
 * test to (a) inject events, (b) invoke the registered approval handler
 * just like the reverse-RPC layer would, and (c) observe `cancel()`.
 *
 * Mirrors the shape of `approval.test.ts`'s `makeApprovalSession`, with
 * one addition: a public `cancelCalls` counter so the test can prove the
 * `session/cancel` notification reached the SDK while another request
 * was parked.
 */
function makeCancellableApprovalSession(sessionId: string): {
  session: Session;
  emit: (event: Event) => void;
  invokeHandler: (req: ApprovalRequest) => Promise<ApprovalResponse> | ApprovalResponse;
  resolvePrompt: () => void;
  cancelCalls: () => number;
  promptStarted: Promise<void>;
  cancelObserved: Promise<void>;
  listenerCount: () => number;
} {
  const listeners = new Set<(event: Event) => void>();
  let approvalHandler: ApprovalHandler | undefined;
  const promptCompletion = Promise.withResolvers<void>();
  const promptStarted = Promise.withResolvers<void>();
  const cancelObserved = Promise.withResolvers<void>();
  let cancelCount = 0;

  const session = {
    id: sessionId,
    prompt: async (_input: unknown) => {
      promptStarted.resolve();
      await promptCompletion.promise;
    },
    cancel: async () => {
      cancelCount += 1;
      cancelObserved.resolve();
    },
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
    resolvePrompt: () => promptCompletion.resolve(),
    cancelCalls: () => cancelCount,
    promptStarted: promptStarted.promise,
    cancelObserved: cancelObserved.promise,
    listenerCount: () => listeners.size,
  };
}

/**
 * Test-only client that holds `requestPermission` open until the test
 * resolves it explicitly. Lets the test interleave a `session/cancel`
 * notification with a parked permission request and decide when (and
 * how) to settle the request.
 */
class ParkingPermissionClient implements Client {
  readonly updates: SessionNotification[] = [];
  readonly permissionRequests: RequestPermissionRequest[] = [];

  private pending: ((response: RequestPermissionResponse) => void) | undefined;

  /** Resolves on the first `requestPermission` call so the test can synchronise. */
  private readonly firstRequest = Promise.withResolvers<void>();
  readonly received = this.firstRequest.promise;

  /** Settle the parked request with the supplied outcome. */
  respond(response: RequestPermissionResponse): void {
    const cb = this.pending;
    if (!cb) throw new Error('respond() called before a requestPermission was received');
    this.pending = undefined;
    cb(response);
  }

  isPending(): boolean {
    return this.pending !== undefined;
  }

  async requestPermission(p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    this.permissionRequests.push(p);
    const response = Promise.withResolvers<RequestPermissionResponse>();
    this.pending = response.resolve;
    this.firstRequest.resolve();
    return response.promise;
  }

  async sessionUpdate(n: SessionNotification): Promise<void> {
    this.updates.push(n);
  }
  async writeTextFile(_p: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    throw new Error('not used');
  }
  async readTextFile(_p: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    throw new Error('not used');
  }
}

const textBlock = (text: string): ContentBlock => ({ type: 'text', text });

describe('AcpServer cancel ⇄ pending requestPermission', () => {
  it('processes session/cancel without blocking on an in-flight requestPermission, and the parked request can still settle to { decision: cancelled }', async () => {
    const sessionId = 'sess-cancel-while-approval';
    const turnId = 11;
    const handle = makeCancellableApprovalSession(sessionId);
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async () => handle.session,
    } as unknown as LioraHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const client = new ParkingPermissionClient();
    const clientConn = new ClientSideConnection(() => client, clientStream);

    await clientConn.newSession({ cwd: '/tmp/x', mcpServers: [] });

    // Start a prompt so the in-prompt onEvent subscription is live; the
    // scripted session parks `prompt()` until `resolvePrompt` is called.
    const pending = clientConn.prompt({
      sessionId,
      prompt: [textBlock('do the thing')],
    });
    let promptSettled = false;
    void pending.then(
      () => { promptSettled = true; },
      () => { promptSettled = true; },
    );

    await handle.promptStarted;

    // Advance the turnId so `buildPermissionToolCallUpdate` uses the
    // prefixed `${turnId}:${rawId}` form — proves the cancel test also
    // covers the production wire id.
    handle.emit({
      type: 'tool.call.started',
      sessionId,
      agentId: 'main',
      turnId,
      toolCallId: 'tc-cancel',
      name: 'Bash',
      args: { command: 'rm -rf /' },
    } as Event);

    // Invoke the approval handler as the SDK reverse-RPC layer would.
    // The bridge will call `conn.requestPermission`, which `ParkingPermissionClient`
    // parks until we explicitly respond.
    const approvalPromise = Promise.resolve(
      handle.invokeHandler({
        toolCallId: 'tc-cancel',
        toolName: 'Bash',
        action: 'run command',
        display: { kind: 'command', command: 'rm -rf /' },
      }),
    );

    // Wait until the request has reached the client and is parked.
    await client.received;
    expect(client.isPending()).toBe(true);
    expect(client.permissionRequests).toHaveLength(1);
    expect(client.permissionRequests[0]!.toolCall.toolCallId).toBe(`${turnId}:tc-cancel`);

    // The critical invariant: `session/cancel` (a notification) must
    // reach the SDK even though `requestPermission` is still parked at
    // the client. If the JSON-RPC handler queue were head-of-line
    // blocked on the pending request, `Session.cancel()` would never
    // fire and this would hang / fail.
    await clientConn.cancel({ sessionId });
    await handle.cancelObserved;
    expect(handle.cancelCalls()).toBe(1);
    expect(promptSettled).toBe(false);
    expect(client.isPending()).toBe(true);
    expect(handle.listenerCount()).toBeGreaterThan(0);

    // Now the client honours the cancel by closing the permission
    // prompt: `outcome: 'cancelled'`. The bridge must translate that
    // into `{ decision: 'cancelled' }` for the SDK so the audit trail
    // is "user cancelled", not "user rejected".
    client.respond({ outcome: { outcome: 'cancelled' } });
    const decision = await approvalPromise;
    expect(decision.decision).toBe('cancelled');

    // The terminal event is factual, but the SDK prompt still owns cleanup
    // until its operation promise settles.
    handle.emit({
      type: 'turn.ended',
      sessionId,
      agentId: 'main',
      turnId,
      reason: 'cancelled',
    } as Event);
    // A wire round-trip drains earlier responses without wall-clock sleeps.
    await expect(clientConn.extMethod('test/barrier', {})).rejects.toMatchObject({
      code: -32601,
    });
    expect(promptSettled).toBe(false);
    expect(handle.listenerCount()).toBeGreaterThan(0);
    handle.resolvePrompt();
    const promptResp = await pending;
    expect(promptResp.stopReason).toBe('cancelled');
    expect(handle.listenerCount()).toBe(0);
  });

  it('a client that ignores the cancel and approves the parked request still resolves the bridge to { decision: approved } — cancel and approval are independent channels', async () => {
    // Sister case to the test above: this guards against a refactor
    // that ties the `requestPermission` await to `Session.cancel()` and
    // accidentally aborts approval flows on cancel. The dev-2 design
    // keeps them independent — the client is the source of truth for
    // the approval outcome — and we want a regression that fails if
    // that changes silently.
    const sessionId = 'sess-cancel-independent-approval';
    const handle = makeCancellableApprovalSession(sessionId);
    const harness = {
      auth: { status: async () => AUTHED_STATUS },
      createSession: async () => handle.session,
    } as unknown as LioraHarness;

    const { agentStream, clientStream } = makeInMemoryStreamPair();
    new AgentSideConnection((c) => new AcpServer(harness, c), agentStream);
    const client = new ParkingPermissionClient();
    const clientConn = new ClientSideConnection(() => client, clientStream);

    await clientConn.newSession({ cwd: '/tmp/x', mcpServers: [] });
    const pending = clientConn.prompt({
      sessionId,
      prompt: [textBlock('hi')],
    });
    await handle.promptStarted;

    handle.emit({
      type: 'tool.call.started',
      sessionId,
      agentId: 'main',
      turnId: 1,
      toolCallId: 'tc-ind',
      name: 'Bash',
      args: { command: 'echo hi' },
    } as Event);

    const approvalPromise = Promise.resolve(
      handle.invokeHandler({
        toolCallId: 'tc-ind',
        toolName: 'Bash',
        action: 'run command',
        display: { kind: 'command', command: 'echo hi' },
      }),
    );

    await client.received;
    await clientConn.cancel({ sessionId });
    await handle.cancelObserved;
    expect(handle.cancelCalls()).toBe(1);

    // Client decides to approve anyway. The bridge does not unilaterally
    // re-interpret the outcome — `approved` round-trips through verbatim.
    client.respond({
      outcome: { outcome: 'selected', optionId: APPROVE_ONCE_OPTION_ID },
    });
    const decision = await approvalPromise;
    expect(decision.decision).toBe('approved');

    handle.emit({
      type: 'turn.ended',
      sessionId,
      agentId: 'main',
      turnId: 1,
      reason: 'cancelled',
    } as Event);
    handle.resolvePrompt();
    const promptResp = await pending;
    expect(promptResp.stopReason).toBe('cancelled');
  });
});
