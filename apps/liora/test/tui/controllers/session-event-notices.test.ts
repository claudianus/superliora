import { describe, expect, it, vi } from 'vitest';

import type { AgentStatusUpdatedEvent } from '@superliora/sdk';

import { SessionEventNotices } from '#/tui/controllers/session-event/notices';
import type { AppState } from '#/tui/types';
import { INTERVENTION_NEVER_HALT_TIP } from '#/tui/utils/never-halt/intervention-glance';
import { RUNTIME_DEGRADED_BADGE_TTL_MS } from '#/tui/utils/never-halt/runtime-degraded';
import { SEARCH_CASCADE_BADGE_TTL_MS } from '#/tui/utils/search/search-cascade';

function makeHost(interventionCount = 2) {
  return {
    state: {
      appState: {
        sessionId: 's1',
        model: 'kimi-model',
        availableModels: {},
        interventionCount,
        runtimeDegraded: null,
        searchCascade: null,
      } as AppState,
    },
    streamingUI: {
      flushNow: vi.fn(),
      hasThinkingDraft: vi.fn(() => false),
      finalizeAssistantStream: vi.fn(),
    },
    setAppState: vi.fn(),
    patchLivePane: vi.fn(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    updateTerminalTitle: vi.fn(),
    setLastTurnFailed: vi.fn(),
  };
}

function makeNotices(host: ReturnType<typeof makeHost>) {
  return new SessionEventNotices(host as any, {
    setCurrentTurnHasAssistantText: vi.fn(),
    setPendingModelBlockedFallback: vi.fn(),
  });
}

describe('SessionEventNotices.handleStatusUpdate interventionCount', () => {
  it('clears interventionCount when a full snapshot omits pendingInterventions', () => {
    const host = makeHost(2);
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      model: 'kimi-model',
      contextTokens: 100,
      permission: 'manual',
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({ interventionCount: 0 }),
    );
  });

  it('sets interventionCount from pendingInterventions when present', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      model: 'kimi-model',
      pendingInterventions: 3,
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({ interventionCount: 3 }),
    );
  });

  it('does not patch interventionCount on partial status updates', () => {
    const host = makeHost(2);
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      planMode: false,
    } as AgentStatusUpdatedEvent);

    const patch = host.setAppState.mock.calls[0]?.[0] as { interventionCount?: number } | undefined;
    expect(patch?.interventionCount).toBeUndefined();
  });

  it('shows Never-Halt tip when pendingInterventions increases', () => {
    const host = makeHost(1);
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      pendingInterventions: 2,
    } as AgentStatusUpdatedEvent);

    expect(host.showStatus).toHaveBeenCalledWith(INTERVENTION_NEVER_HALT_TIP, 'textMuted');
  });

  it('tracks staleInterventionCount from status snapshots', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      model: 'kimi-model',
      pendingInterventions: 2,
      staleInterventions: 1,
      oldestInterventionAgeMs: 45_000,
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({
        interventionCount: 2,
        staleInterventionCount: 1,
        oldestInterventionAgeMs: 45_000,
      }),
    );
  });

  it('clears oldestInterventionAgeMs when a full snapshot omits it', () => {
    const host = makeHost(0);
    host.state.appState.oldestInterventionAgeMs = 30_000;
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      model: 'kimi-model',
      contextTokens: 100,
      permission: 'manual',
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({ oldestInterventionAgeMs: undefined }),
    );
  });

  it('clears staleInterventionCount when a full snapshot omits staleInterventions', () => {
    const host = makeHost(0);
    host.state.appState.staleInterventionCount = 2;
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      model: 'kimi-model',
      contextTokens: 100,
      permission: 'manual',
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({ staleInterventionCount: 0 }),
    );
  });

  it('syncs circuitBreakers from agent.status.updated into AppState', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      model: 'kimi-model',
      circuitBreakers: {
        closed: 2,
        open: 1,
        halfOpen: 0,
        lastTripReason: 'brave 429',
      },
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({
        circuitBreakers: expect.objectContaining({ lastTripReason: 'brave 429' }),
      }),
    );
  });

  it('clears circuitBreakers when a full snapshot omits them', () => {
    const host = makeHost(0);
    host.state.appState.circuitBreakers = {
      closed: 0,
      open: 1,
      halfOpen: 0,
      lastTripReason: 'old trip',
    };
    const notices = makeNotices(host);

    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      model: 'kimi-model',
      contextTokens: 100,
      permission: 'manual',
    } as AgentStatusUpdatedEvent);

    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({ circuitBreakers: null }),
    );
  });

  it('clears expired runtimeDegraded and searchCascade on status snapshots', () => {
    const host = makeHost(0);
    const now = 200_000;
    host.state.appState.runtimeDegraded = {
      scope: 'search',
      reason: 'cooling',
      atMs: now - RUNTIME_DEGRADED_BADGE_TTL_MS - 1,
    };
    host.state.appState.searchCascade = {
      channelsTried: ['ch1'],
      atMs: now - SEARCH_CASCADE_BADGE_TTL_MS - 1,
    };
    const notices = makeNotices(host);

    vi.spyOn(Date, 'now').mockReturnValue(now);
    notices.handleStatusUpdate({
      type: 'agent.status.updated',
      model: 'kimi-model',
      contextTokens: 100,
    } as AgentStatusUpdatedEvent);
    vi.mocked(Date.now).mockRestore();

    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeDegraded: null,
        searchCascade: null,
      }),
    );
  });
});
