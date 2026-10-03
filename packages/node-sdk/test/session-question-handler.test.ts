import { ErrorCodes } from '@superliora/agent-core';
import { describe, expect, it } from 'vitest';

import type { Event, QuestionRequest } from '#/index';
import { SdkEventBridge } from '#/rpc/rpc-event-bridge';

function questionRequest(sessionId: string): QuestionRequest & { sessionId: string; agentId: string } {
  return {
    sessionId,
    agentId: 'main',
    questions: [{ question: 'Continue with this account?', options: [{ label: 'Continue' }, { label: 'Stop' }] }],
  };
}

describe('SDK native operator questions', () => {
  it('returns no answer when no host is registered or the host session is cleared', async () => {
    const bridge = new SdkEventBridge();
    const request = questionRequest('operator-session');
    await expect(bridge.requestQuestion(request)).resolves.toBeNull();
    bridge.setQuestionHandler(request.sessionId, () => ({ answers: { 'Continue with this account?': 'Continue' }, method: 'enter' }));
    await expect(bridge.requestQuestion(request)).resolves.toEqual({ answers: { 'Continue with this account?': 'Continue' }, method: 'enter' });
    bridge.clearSessionHandlers(request.sessionId);
    await expect(bridge.requestQuestion(request)).resolves.toBeNull();
  });

  it('propagates cancellation to the pending host interaction and waits for its response', async () => {
    const bridge = new SdkEventBridge();
    const controller = new AbortController();
    const hostReady = Promise.withResolvers<void>();
    bridge.setQuestionHandler('operator-session', async (_request, options) => {
      const signal = options?.signal;
      if (signal === undefined) throw new Error('Missing host interaction signal');
      const aborted = Promise.withResolvers<void>();
      signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      hostReady.resolve();
      await aborted.promise;
      return null;
    });
    const answer = bridge.requestQuestion(questionRequest('operator-session'), { signal: controller.signal });
    await hostReady.promise;
    controller.abort();
    await expect(answer).resolves.toBeNull();
  });

  it('reports a host failure with session identity without fabricating an answer', async () => {
    const bridge = new SdkEventBridge();
    const events: Event[] = [];
    bridge.onEvent((event) => events.push(event));
    bridge.setQuestionHandler('operator-session', () => { throw new Error('Host disconnected'); });
    await expect(bridge.requestQuestion(questionRequest('operator-session'))).resolves.toBeNull();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error', sessionId: 'operator-session', agentId: 'main', code: ErrorCodes.SESSION_QUESTION_HANDLER_ERROR,
    }));
  });
});
