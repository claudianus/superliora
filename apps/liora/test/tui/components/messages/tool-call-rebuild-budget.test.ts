import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  resetToolCallRebuildBudgetForTest,
  tickToolCallRenderClock,
  type ToolCallRenderTickInput,
} from '#/tui/components/messages/tool-call/render-tick';
import {
  advanceAppearanceAnimationClock,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';

function streamingBashInput(id: string): ToolCallRenderTickInput {
  return {
    toolCall: {
      id,
      name: 'Bash',
      args: { command: 'cat x.ts' },
      streamingStartedAtMs: Date.now(),
      streamingArguments: '{"command":"cat x.ts',
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
      name: 'SessionControl',
      args: { operation: 'spawn', description: 'work', prompt: 'work' },
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
    subagentSpawnEntranceAtMs: undefined,
    subagentStartedAtMs: Date.now() - 5_000,
    subagentPhase: 'running',
    subagentOngoingSubCallsSize: 0,
  };
}

describe('tool-call rebuild budget (ambient storm guard)', () => {
  beforeEach(() => {
    resetToolCallRebuildBudgetForTest();
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    // Far enough into the clock that progress interval (1s) has elapsed from 0.
    advanceAppearanceAnimationClock(5_000);
  });

  it('refreshes every Bash progress header without rebuilding its body', () => {
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

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      tickToolCallRenderClock(streamingBashInput(id), callbacks);
    }

    expect(callbacks.refreshHeader).toHaveBeenCalledTimes(5);
    expect(rebuildBody).not.toHaveBeenCalled();
    expect(requestRender.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('caps subagent block rebuilds while refreshing every active header', () => {
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

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      tickToolCallRenderClock(runningSubagentInput(id), callbacks);
    }

    // Healthy budget = 4; fifth card only refreshes header + requestRender.
    expect(rebuildSubagentBlock).toHaveBeenCalledTimes(4);
    expect(rebuildBody).toHaveBeenCalledTimes(0);
    expect(requestRender.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
