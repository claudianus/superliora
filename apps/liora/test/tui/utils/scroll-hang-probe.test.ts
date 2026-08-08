import { afterEach, describe, expect, it } from 'vitest';

import {
  formatScrollHangHudLine,
  lastScrollHangDumpForTest,
  recordScrollHangSample,
  resetScrollHangProbeForTest,
  SCROLL_HANG_CALLBACK_MS,
  setScrollHangProbeSinkForTest,
  setScrollHangTraceEnabledForTest,
} from '#/tui/utils/render/scroll-hang-probe';

describe('scroll hang probe', () => {
  afterEach(() => {
    resetScrollHangProbeForTest();
    setScrollHangTraceEnabledForTest(undefined);
    setScrollHangProbeSinkForTest(undefined);
  });

  it('formats a HUD line from the latest sample', () => {
    recordScrollHangSample({
      causes: ['transcript-scroll'],
      pureScroll: true,
      storm: true,
      childPaints: 0,
      materializeContinue: false,
      renderCbMs: 3.2,
      deferredQueueSize: 4,
      settleArmed: true,
      streamingPhase: 'idle',
      scrollHold: true,
    });
    expect(formatScrollHangHudLine()).toContain('scroll storm');
    expect(formatScrollHangHudLine()).toContain('childPaints=0');
    expect(formatScrollHangHudLine()).toContain('defer=4');
    expect(formatScrollHangHudLine()).toContain('hold=Y');
  });

  it('emits a dump when callback exceeds hang budget', () => {
    const dumps: unknown[] = [];
    setScrollHangProbeSinkForTest((dump) => {
      dumps.push(dump);
    });
    setScrollHangTraceEnabledForTest(false);
    recordScrollHangSample({
      causes: ['transcript-scroll'],
      pureScroll: true,
      storm: false,
      childPaints: 2,
      materializeContinue: false,
      renderCbMs: SCROLL_HANG_CALLBACK_MS + 1,
      deferredQueueSize: 0,
      settleArmed: false,
      streamingPhase: 'idle',
      scrollHold: true,
    });
    expect(dumps).toHaveLength(1);
    expect(lastScrollHangDumpForTest()?.reason).toBe('callback-budget');
  });
});
