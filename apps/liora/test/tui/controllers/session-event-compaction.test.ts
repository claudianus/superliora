import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompactionCancelledEvent,
  CompactionCompletedEvent,
  CompactionProgressEvent,
  CompactionStartedEvent,
} from '@superliora/sdk';

import { SessionEventCompaction, type CompactionEventHost } from '../../../src/tui/controllers/session-event/compaction';
import type { AppState, QueuedMessage } from '../../../src/tui/types';
import type { TUIState } from '../../../src/tui/tui-state';

function makeHost(next?: QueuedMessage, activeTurn = false): CompactionEventHost {
  const appState = {
    isCompacting: false,
    streamingPhase: 'idle',
    model: '',
    availableModels: {},
  } as AppState;
  return {
    state: { appState } as TUIState,
    streamingUI: {
      finalizeLiveTextBuffers: vi.fn(),
      beginCompaction: vi.fn(),
      endCompaction: vi.fn(),
      cancelCompaction: vi.fn(),
      updateCompactionProgress: vi.fn(),
      hasActiveTurn: () => activeTurn,
    } as unknown as CompactionEventHost['streamingUI'],
    setAppState(patch) { Object.assign(appState, patch); },
    resetLivePane: vi.fn(),
    shiftQueuedMessage: () => next,
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('SessionEventCompaction', () => {
  it('shows real foreground compaction and its selected model without background promotion', () => {
    const host = makeHost();
    new SessionEventCompaction(host).handleBegin({
      type: 'compaction.started',
      trigger: 'manual',
      instruction: 'Keep the working context',
      modelAlias: 'compact-model',
    } as CompactionStartedEvent);
    expect(host.streamingUI.finalizeLiveTextBuffers).toHaveBeenCalledWith('waiting');
    expect(host.state.appState.isCompacting).toBe(true);
    expect(host.state.appState.streamingPhase).toBe('waiting');
    expect(host.streamingUI.beginCompaction).toHaveBeenCalledWith(
      'Keep the working context', { modelAlias: 'compact-model' },
    );
    expect(host.state.appState.lastModelRouteNotice).toMatchObject({
      reason: 'compaction', toAlias: 'compact-model',
    });
  });


  it('forwards observed compaction phases, summary deltas, and block progress', () => {
    const host = makeHost();
    new SessionEventCompaction(host).handleProgress({
      type: 'compaction.progress',
      phase: 'summarizing',
      delta: 'Actual summary',
      streamKind: 'block',
      blockIndex: 1,
      blockCount: 2,
      blocksCompleted: 1,
      fraction: 0.5,
    } as CompactionProgressEvent);
    expect(host.streamingUI.updateCompactionProgress).toHaveBeenCalledWith(
      'summarizing', 'Actual summary',
      { streamKind: 'block', blockIndex: 1, blockCount: 2, blocksCompleted: 1, fraction: 0.5 },
    );
  });

  it('finishes with actual token counts and drains queued input only after compaction completes', () => {
    vi.useFakeTimers();
    const next: QueuedMessage = { text: 'Continue work' };
    const host = makeHost(next);
    const sendQueued = vi.fn();
    new SessionEventCompaction(host).handleEnd({
      type: 'compaction.completed',
      result: { tokensBefore: 1_000, tokensAfter: 250 },
    } as CompactionCompletedEvent, sendQueued);
    expect(host.streamingUI.endCompaction).toHaveBeenCalledWith(1_000, 250);
    expect(host.state.appState.isCompacting).toBe(false);
    expect(host.state.appState.streamingPhase).toBe('idle');
    expect(sendQueued).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(sendQueued).toHaveBeenCalledWith(next);
  });

  it('cancels the compaction card without fabricating a completed result', () => {
    const host = makeHost(undefined, true);
    const sendQueued = vi.fn();
    new SessionEventCompaction(host).handleCancel({
      type: 'compaction.cancelled',
    } as CompactionCancelledEvent, sendQueued);
    expect(host.streamingUI.cancelCompaction).toHaveBeenCalledOnce();
    expect(host.streamingUI.endCompaction).not.toHaveBeenCalled();
    expect(host.state.appState.isCompacting).toBe(false);
    expect(sendQueued).not.toHaveBeenCalled();
  });
});
