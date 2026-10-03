import { describe, expect, it, vi } from 'vitest';
import type { AgentStatusUpdatedEvent, ErrorEvent, WarningEvent } from '@superliora/sdk';

import { SessionEventNotices, type NoticeEventHost } from '#/tui/controllers/session-event/notices';
import { OAUTH_LOGIN_REQUIRED_CODE, OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE } from '#/tui/constant/liora-tui';

function makeHost() {
  return {
    state: {
      appState: {
        sessionId: 's1',
        model: 'model-a',
        availableModels: { 'model-a': { cost: { input: 2, output: 8 } } },
        notifications: { enabled: false, condition: 'always' },
      },
    },
    streamingUI: {
      flushNow: vi.fn(),
      resetToolUi: vi.fn(),
      finalizeLiveTextBuffers: vi.fn(),
    },
    setAppState: vi.fn(),
    patchLivePane: vi.fn(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    updateTerminalTitle: vi.fn(),
    setLastTurnFailed: vi.fn(),
  };
}

const eventIdentity = { agentId: 'main', sessionId: 's1' };

describe('SessionEventNotices', () => {
  it('projects context, model and permission status without governance state', () => {
    const host = makeHost();
    new SessionEventNotices(host as unknown as NoticeEventHost).handleStatusUpdate({
      ...eventIdentity,
      type: 'agent.status.updated',
      contextUsage: 0.4,
      contextTokens: 40,
      maxContextTokens: 100,
      model: 'model-b',
      permission: 'manual',
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith({
      contextUsage: 0.4,
      contextTokens: 40,
      maxContextTokens: 100,
      model: 'model-b',
      permissionMode: 'manual',
    });
  });

  it('estimates cost from observed cumulative token usage', () => {
    const host = makeHost();
    new SessionEventNotices(host as unknown as NoticeEventHost).handleStatusUpdate({
      ...eventIdentity,
      type: 'agent.status.updated',
      usage: {
        total: { inputOther: 1_000_000, inputCacheRead: 0, inputCacheCreation: 0, output: 250_000 },
      },
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith({ sessionCostUsd: 4 });
  });

  it('leaves unchanged state alone on an empty status event', () => {
    const host = makeHost();
    new SessionEventNotices(host as unknown as NoticeEventHost).handleStatusUpdate({
      ...eventIdentity,
      type: 'agent.status.updated',
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).not.toHaveBeenCalled();
  });

  it('keeps real errors visible and marks the last turn failed', () => {
    const host = makeHost();
    new SessionEventNotices(host as unknown as NoticeEventHost).handleSessionError({
      ...eventIdentity,
      type: 'error',
      code: 'provider.connection_error',
      message: 'Provider timed out',
      retryable: true,
    } as ErrorEvent);

    expect(host.streamingUI.flushNow).toHaveBeenCalledOnce();
    expect(host.streamingUI.resetToolUi).toHaveBeenCalledOnce();
    expect(host.streamingUI.finalizeLiveTextBuffers).toHaveBeenCalledWith('idle');
    expect(host.setLastTurnFailed).toHaveBeenCalledWith(true);
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('Provider timed out'));
    expect(host.showNotice).not.toHaveBeenCalled();
  });

  it('keeps the OAuth login requirement actionable', () => {
    const host = makeHost();
    new SessionEventNotices(host as unknown as NoticeEventHost).handleSessionError({
      ...eventIdentity,
      type: 'error',
      code: OAUTH_LOGIN_REQUIRED_CODE,
      message: 'Login required',
      retryable: false,
    } as ErrorEvent);

    expect(host.showError).toHaveBeenCalledWith(OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE());
  });

  it('renders ordinary warnings without interpreting warning text as policy', () => {
    const host = makeHost();
    new SessionEventNotices(host as unknown as NoticeEventHost).handleSessionWarning({
      ...eventIdentity,
      type: 'warning',
      message: 'The provider returned a warning',
    } as WarningEvent);

    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('The provider returned a warning'),
      'warning',
    );
    expect(host.showNotice).not.toHaveBeenCalled();
  });
});
