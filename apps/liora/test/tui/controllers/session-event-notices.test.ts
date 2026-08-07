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
    showNotice: vi.fn(),
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
      askMode: false,
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

describe('SessionEventNotices.handleSessionWarning (Loop31a goal no-progress)', () => {
  it('surfaces GOAL_NO_PROGRESS wire warnings as a named notice', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);
    const message =
      'GOAL_NO_PROGRESS: No material progress for 6 consecutive goal turns (threshold K=6).';

    notices.handleSessionWarning({
      type: 'warning',
      message,
      code: 'goal-no-progress-sensor',
    });

    expect(host.showNotice).toHaveBeenCalledWith('Goal stalled (no progress)', message, {
      coalesceKey: 'goal-no-progress',
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'Goal stalled — change approach or UpdateGoal(blocked)',
      'warning',
    );
  });

  it('matches the GOAL_NO_PROGRESS: prefix without code', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);

    notices.handleSessionWarning({
      type: 'warning',
      message: 'GOAL_NO_PROGRESS: still spinning',
    });

    expect(host.showNotice).toHaveBeenCalledWith(
      'Goal stalled (no progress)',
      'GOAL_NO_PROGRESS: still spinning',
      { coalesceKey: 'goal-no-progress' },
    );
  });
});

describe('SessionEventNotices.handleSessionWarning (Loop32a cache freeze drift)', () => {
  it('surfaces CACHE_FREEZE_DRIFT wire warnings as a named notice', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);
    const message =
      'CACHE_FREEZE_DRIFT: mid-turn tool list fingerprint changed (drift×1). code=CACHE_FREEZE_DRIFT.';

    notices.handleSessionWarning({
      type: 'warning',
      message,
      code: 'cache-freeze-drift-sensor',
    });

    expect(host.showNotice).toHaveBeenCalledWith('Cache freeze drift', message, {
      coalesceKey: 'cache-freeze-drift',
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'Cache freeze: mid-turn tool list drifted',
      'warning',
    );
  });
});

describe('SessionEventNotices.handleSessionWarning (Loop34a stop sensor)', () => {
  it('surfaces STOP_SENSOR wire warnings as a named notice', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);
    const message =
      'STOP_SENSOR: Stop sensor: turn ended with unverified work still sticky. Do not claim done yet.';

    notices.handleSessionWarning({
      type: 'warning',
      message,
      code: 'stop-sensor',
    });

    expect(host.showNotice).toHaveBeenCalledWith('Stop sensor: verify before done', message, {
      coalesceKey: 'stop-sensor',
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'Stop sensor — one repair continuation',
      'warning',
    );
  });
});

describe('SessionEventNotices.handleSessionWarning (Loop35a abandoned tool)', () => {
  it('surfaces ABANDONED_TOOL wire warnings as a named notice', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);
    const message =
      'ABANDONED_TOOL: closed 2 unresolved tool exchanges (turn cancelled). Do not assume those tools succeeded.';

    notices.handleSessionWarning({
      type: 'warning',
      message,
      code: 'abandoned-tool-sensor',
    });

    expect(host.showNotice).toHaveBeenCalledWith('Unresolved tool calls closed', message, {
      coalesceKey: 'abandoned-tool',
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'Unresolved tools closed — do not assume success',
      'warning',
    );
  });
});

describe('SessionEventNotices.handleSessionWarning (Loop40a auto-check spawn error)', () => {
  it('surfaces AUTO_CHECK_SPAWN ERROR wire warnings as a named notice', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);
    const message =
      'AUTO_CHECK_SPAWN: ERROR: RunProjectChecks tool not available. Mutation was not auto-verified.';

    notices.handleSessionWarning({
      type: 'warning',
      message,
      code: 'auto-check-spawn-error',
    });

    expect(host.showNotice).toHaveBeenCalledWith('Auto-check spawn error', message, {
      coalesceKey: 'auto-check-spawn-error',
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'Auto-check spawn failed — run checks manually',
      'warning',
    );
  });
});

describe('SessionEventNotices.handleSessionWarning (Loop41a UserPromptSubmit block)', () => {
  it('surfaces USER_PROMPT_SUBMIT_BLOCK wire warnings as a named notice', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);
    const message =
      'USER_PROMPT_SUBMIT_BLOCK: policy denied. Turn will not start until the hook allows the prompt.';

    notices.handleSessionWarning({
      type: 'warning',
      message,
      code: 'user-prompt-submit-block',
    });

    expect(host.showNotice).toHaveBeenCalledWith('Prompt blocked by hook', message, {
      coalesceKey: 'user-prompt-submit-block',
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'Turn blocked — UserPromptSubmit hook',
      'warning',
    );
  });
});

describe('SessionEventNotices.handleSessionWarning (Loop46a AGENTS.md oversized)', () => {
  it('surfaces soft AGENTS.md size budget as a named notice', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);
    const message =
      'AGENTS.md exceeds the recommended 40,000 character budget (50,000 chars). Consider trimming project instructions to reduce context load.';

    notices.handleSessionWarning({
      type: 'warning',
      message,
      code: 'agents-md-oversized',
    });

    expect(host.showNotice).toHaveBeenCalledWith('AGENTS.md oversized', message, {
      coalesceKey: 'agents-md-oversized',
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'AGENTS.md oversized — consider trimming',
      'warning',
    );
  });

  it('surfaces hard AGENTS.md injection cap as a named notice', () => {
    const host = makeHost(0);
    const notices = makeNotices(host);
    const message =
      'AGENTS.md exceeds the hard injection cap of 120,000 characters (150,000 chars). Content was truncated before injection; trim project instructions.';

    notices.handleSessionWarning({
      type: 'warning',
      message,
      code: 'agents-md-oversized',
    });

    expect(host.showNotice).toHaveBeenCalledWith('AGENTS.md oversized', message, {
      coalesceKey: 'agents-md-oversized',
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      'AGENTS.md hard-capped — trim project instructions',
      'warning',
    );
  });
});
