import type { PromptPart, Session } from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import { SessionRequestsController, type SessionRequestsHost } from '#/tui/controllers/session/session-requests';

function makeHost() {
  return {
    streamingUI: {
      setTurnId: vi.fn(), resetLiveText: vi.fn(), resetToolUi: vi.fn(), resetToolCallState: vi.fn(),
    },
    messageDispatch: { steerMessage: vi.fn() },
    setAppState: vi.fn(), patchLivePane: vi.fn(), resetLivePane: vi.fn(), showError: vi.fn(),
  };
}

describe('session requests', () => {
  it('resets streaming surfaces before waiting and restores idle on send failure', () => {
    const host = makeHost();
    const controller = new SessionRequestsController(host as unknown as SessionRequestsHost);
    controller.beginSessionRequest();
    expect(host.streamingUI.setTurnId).toHaveBeenCalledWith(undefined);
    expect(host.streamingUI.resetLiveText).toHaveBeenCalledOnce();
    expect(host.streamingUI.resetToolUi).toHaveBeenCalledOnce();
    expect(host.streamingUI.resetToolCallState).toHaveBeenCalledOnce();
    expect(host.patchLivePane).toHaveBeenCalledWith({ mode: 'waiting', pendingApproval: null, pendingQuestion: null });
    expect(host.setAppState).toHaveBeenCalledWith({ streamingPhase: 'waiting', streamingStartTime: expect.any(Number) });

    controller.failSessionRequest('Provider unavailable');
    expect(host.setAppState).toHaveBeenLastCalledWith({ streamingPhase: 'idle' });
    expect(host.resetLivePane).toHaveBeenCalledOnce();
    expect(host.showError).toHaveBeenCalledWith('Provider unavailable');
  });

  it('forwards structured media and attachment ownership when steering', () => {
    const host = makeHost();
    const controller = new SessionRequestsController(host as unknown as SessionRequestsHost);
    const session = { id: 'session-1' } as Session;
    const input = ['Inspect the attached image'];
    const parts: readonly PromptPart[] = [{ type: 'text', text: input[0]! }];
    const options = { parts, imageAttachmentIds: [7] };
    controller.steerMessage(session, input, options);
    expect(host.messageDispatch.steerMessage).toHaveBeenCalledWith(session, input, options);
  });
});
