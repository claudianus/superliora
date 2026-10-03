import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@superliora/agent-core';

import type { ApprovalRequest, Event } from '#/index';
import { SdkEventBridge } from '#/rpc/rpc-event-bridge';

function approvalRequest(sessionId: string, agentId = 'main'): ApprovalRequest & { sessionId: string; agentId: string } {
  return {
    sessionId,
    agentId,
    toolCallId: 'bash-command',
    toolName: 'Bash',
    action: 'Run command',
    display: { kind: 'generic', summary: 'Run command' },
  };
}

describe('SDK approval handling', () => {
  it('fails closed for unregistered and cleared session handlers', async () => {
    const bridge = new SdkEventBridge();
    const request = approvalRequest('session-one');
    await expect(bridge.requestApproval(request)).resolves.toEqual({
      decision: 'cancelled',
      feedback: 'No approval handler registered.',
    });
    bridge.setApprovalHandler(request.sessionId, () => ({ decision: 'approved', scope: 'session' }));
    await expect(bridge.requestApproval(request)).resolves.toEqual({ decision: 'approved', scope: 'session' });
    bridge.clearSessionHandlers(request.sessionId);
    await expect(bridge.requestApproval(request)).resolves.toMatchObject({ decision: 'cancelled' });
  });

  it('isolates session handlers and preserves the requesting child identity', async () => {
    const bridge = new SdkEventBridge();
    let requestingAgent: string | undefined;
    bridge.setApprovalHandler('session-one', (request) => {
      if ('agentId' in request && typeof request.agentId === 'string') requestingAgent = request.agentId;
      return { decision: 'approved' };
    });
    bridge.setApprovalHandler('session-two', () => ({ decision: 'rejected', feedback: 'No shell access.' }));
    await expect(bridge.requestApproval(approvalRequest('session-one', 'child-one'))).resolves.toEqual({ decision: 'approved' });
    expect(requestingAgent).toBe('child-one');
    await expect(bridge.requestApproval(approvalRequest('session-two'))).resolves.toEqual({
      decision: 'rejected', feedback: 'No shell access.',
    });
  });

  it('fails closed and emits a scoped error when a host approval handler rejects', async () => {
    const bridge = new SdkEventBridge();
    const events: Event[] = [];
    bridge.onEvent((event) => events.push(event));
    bridge.setApprovalHandler('session-one', async () => {
      throw new Error('approval host unavailable');
    });
    await expect(bridge.requestApproval(approvalRequest('session-one', 'child-one'))).resolves.toEqual({
      decision: 'cancelled', feedback: 'Approval handler failed.',
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error', sessionId: 'session-one', agentId: 'child-one',
      code: ErrorCodes.SESSION_APPROVAL_HANDLER_ERROR,
    }));
  });
});
