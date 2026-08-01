import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  resetToolCallRebuildBudgetForTest,
  tickToolCallRenderClock,
  type ToolCallRenderTickInput,
} from '#/tui/components/messages/tool-call/render-tick';
import { advanceAppearanceAnimationClock } from '#/tui/features/appearance/appearance-effects';

function streamingEditInput(id: string): ToolCallRenderTickInput {
  return {
    toolCall: {
      id,
      name: 'Edit',
      args: { file_path: 'x.ts' },
      streamingStartedAtMs: Date.now(),
      streamingArguments: '{"file_path":"x.ts"}',
    },
    result: undefined,
    previewRevealEligible: false,
    previewItemTotal: 0,
    builtPreviewItemCount: 0,
    // Force progress interval to fire on this tick.
    lastStreamingProgressTickMs: 0,
    lastSubagentElapsedTickMs: 0,
    entranceStartedAtMs: Date.now(),
    resultSettledAtMs: undefined,
    isSingleSubagentView: false,
    derivedSubagentPhase: undefined,
    isStreamingEditPreview: true,
    subagentSpawnEntranceAtMs: undefined,
    subagentStartedAtMs: undefined,
    // Idle phase — must not compete with body rebuild budget in this suite.
    subagentPhase: 'done',
    subagentOngoingSubCallsSize: 0,
  };
}

function runningSubagentInput(id: string): ToolCallRenderTickInput {
  return {
    toolCall: {
      id,
      name: 'Task',
      args: { description: 'work' },
    },
    result: undefined,
    previewRevealEligible: false,
    previewItemTotal: 0,
    builtPreviewItemCount: 0,
    lastStreamingProgressTickMs: 0,
    lastSubagentElapsedTickMs: 0,
    entranceStartedAtMs: Date.now(),
    resultSettledAtMs: undefined,
    isSingleSubagentView: true,
    derivedSubagentPhase: 'running',
    isStreamingEditPreview: false,
    subagentSpawnEntranceAtMs: undefined,
    subagentStartedAtMs: Date.now() - 5_000,
    subagentPhase: 'running',
    subagentOngoingSubCallsSize: 0,
  };
}

describe('tool-call rebuild budget (ambient storm guard)', () => {
  beforeEach(() => {
    resetToolCallRebuildBudgetForTest();
    // Far enough into the clock that progress interval (1s) has elapsed from 0.
    advanceAppearanceAnimationClock(5_000);
  });

  it('allows at most two full body rebuilds per animation clock tick', () => {
    const rebuildBody = vi.fn();
    const requestRender = vi.fn();
    const callbacks = {
      rebuildCallPreviewBlock: vi.fn(),
      rebuildBody,
      rebuildSubagentBlock: vi.fn(),
      refreshHeader: vi.fn(),
      notifySnapshotChange: vi.fn(),
      requestRender,
      setLastStreamingProgressTickMs: vi.fn(),
      setLastSubagentElapsedTickMs: vi.fn(),
      setSubagentSpinnerFrame: vi.fn(),
      getSubagentSpinnerFrame: () => 0,
    };

    for (const id of ['a', 'b', 'c']) {
      tickToolCallRenderClock(streamingEditInput(id), callbacks);
    }

    // Budget = 2 rebuilds; remaining cards still request follow-up frames.
    expect(rebuildBody).toHaveBeenCalledTimes(2);
    expect(requestRender.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('shares the rebuild budget with subagent block rebuilds', () => {
    const rebuildBody = vi.fn();
    const rebuildSubagentBlock = vi.fn();
    const requestRender = vi.fn();
    const callbacks = {
      rebuildCallPreviewBlock: vi.fn(),
      rebuildBody,
      rebuildSubagentBlock,
      refreshHeader: vi.fn(),
      notifySnapshotChange: vi.fn(),
      requestRender,
      setLastStreamingProgressTickMs: vi.fn(),
      setLastSubagentElapsedTickMs: vi.fn(),
      setSubagentSpinnerFrame: vi.fn(),
      getSubagentSpinnerFrame: () => 0,
    };

    for (const id of ['a', 'b', 'c']) {
      tickToolCallRenderClock(runningSubagentInput(id), callbacks);
    }

    // Shared budget = 2; third card only refreshes header + requestRender.
    expect(rebuildSubagentBlock).toHaveBeenCalledTimes(2);
    expect(rebuildBody).toHaveBeenCalledTimes(0);
    expect(requestRender.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
