/**
 * Regression: deferred tool-body format used to call
 * invalidateGeometryAndPaint() on every apply. Repeated scroll through
 * tool-heavy history then remeasured O(transcript) children per frame and
 * froze the TUI. Format completion must only bust paint caches.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createTUIState } from '#/tui/tui-state';
import { TruncatedOutputComponent } from '#/tui/components/messages/tool-renderers/truncated';
import type { AppState } from '#/tui/types';
import {
  clearDeferredTranscriptFormatQueueForTest,
  flushDeferredTranscriptFormatQueueForTest,
  setDeferredFormatHoldPredicateForTest,
  setDeferredFormatSchedulerForTest,
} from '#/tui/utils/transcript/deferred-format-queue';
import { withTranscriptPaintMode } from '#/tui/utils/render/transcript-paint-mode';

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/kimi-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    thinking: false,
    streamingPhase: 'idle',
    appearance: undefined,
    goal: null,
  } as unknown as AppState;
}

describe('scroll + deferred format geometry isolation', () => {
  afterEach(() => {
    clearDeferredTranscriptFormatQueueForTest();
    setDeferredFormatSchedulerForTest(undefined);
    setDeferredFormatHoldPredicateForTest(undefined);
  });

  it('format apply does not force full geometry remeasure of cold siblings', () => {
    setDeferredFormatHoldPredicateForTest(() => false);
    setDeferredFormatSchedulerForTest((run) => {
      run();
    });

    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });

    let coldRenders = 0;
    // Distinct children (shared identity would poison per-slot caches).
    const colds = Array.from({ length: 60 }, (_, index) => {
      const lines = Array.from({ length: 5 }, (__, row) => `cold-${index}-${row}`);
      return {
        invalidate() {},
        render() {
          coldRenders += 1;
          return lines;
        },
      };
    });

    // Tall history so the viewport overflows and virtual-scroll is active.
    for (const cold of colds) {
      state.transcriptContainer.addChild(cold);
    }

    const largeBody = Array.from(
      { length: 80 },
      (_, i) => `{"id":${i},"pad":"${'z'.repeat(40)}"}`,
    ).join('\n');
    const hot = new TruncatedOutputComponent(largeBody, {
      expanded: false,
      isError: false,
      maxLines: 3,
    });
    state.transcriptContainer.addChild(hot);

    // Warm geometry for the whole tree.
    state.transcriptContainer.render(80);
    const afterWarm = coldRenders;
    expect(afterWarm).toBeGreaterThan(0);

    // Ambient paint of the large tool schedules + applies deferred format.
    // Host handler only invalidatePaint() — contentRowCount must stay free.
    hot.render(80);
    flushDeferredTranscriptFormatQueueForTest();
    state.transcriptContainer.invalidatePaint();

    for (let i = 0; i < 10; i++) {
      expect(state.transcriptContainer.contentRowCount(80)).toBeGreaterThan(0);
    }
    // Geometry short-circuit: no cold sibling remeasure after format apply.
    expect(coldRenders).toBe(afterWarm);

    // Pure-scroll paint storm: only newly intersecting children may render.
    const beforeScroll = coldRenders;
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      for (let i = 0; i < 8; i++) {
        state.transcriptViewport.scroll('line-up');
        state.transcriptContainer.render(80);
      }
    });
    // Must stay far below re-rendering the whole 60-child history each frame.
    expect(coldRenders - beforeScroll).toBeLessThan(20);
  });
});
