import { describe, expect, it } from 'vitest';

import type { NativeRenderCause } from '#/tui/renderer';

import {
  frameInvalidationIntentToCause,
  isLiveGoalChromeActive,
  isPureInputFrame,
  isPureTranscriptScrollFrame,
  shouldReuseTUIChromeCache,
  tuiChromeEpoch,
} from '#/tui/features/native-layout/native-frame-policy';

describe('frameInvalidationIntentToCause', () => {
  it('maps every intent to a stable native cause', () => {
    // Pin the mapping so a future rename on the renderer side does not
    // silently drop a cause and let the chrome cache serve stale paint.
    expect(frameInvalidationIntentToCause('content')).toBe('request');
    expect(frameInvalidationIntentToCause('layout')).toBe('manual');
    expect(frameInvalidationIntentToCause('palette')).toBe('manual');
    expect(frameInvalidationIntentToCause('animation')).toBe('animation');
    expect(frameInvalidationIntentToCause('scroll')).toBe('transcript-scroll');
  });
});

describe('isPureTranscriptScrollFrame', () => {
  it('rejects frames with no transcript-scroll cause', () => {
    const causes: NativeRenderCause[] = ['animation'];
    expect(
      isPureTranscriptScrollFrame(causes, true, false),
    ).toBe(false);
  });

  it('accepts scroll with optional animation tick when geometry is stable', () => {
    const causes: NativeRenderCause[] = ['transcript-scroll', 'animation'];
    expect(
      isPureTranscriptScrollFrame(causes, true, false),
    ).toBe(true);
  });

  it('rejects when a structural shift is reported', () => {
    const causes: NativeRenderCause[] = ['transcript-scroll'];
    expect(
      isPureTranscriptScrollFrame(causes, true, true),
    ).toBe(false);
  });

  it('rejects when the viewport did not actually scroll', () => {
    const causes: NativeRenderCause[] = ['transcript-scroll'];
    expect(
      isPureTranscriptScrollFrame(causes, false, false),
    ).toBe(false);
  });
});

describe('isPureInputFrame', () => {
  it('accepts a single input cause when geometry is stable', () => {
    expect(isPureInputFrame(['input'], false, false)).toBe(true);
  });

  it('rejects when the viewport also scrolled', () => {
    expect(isPureInputFrame(['input'], false, true)).toBe(false);
  });

  it('rejects when a structural shift is reported', () => {
    expect(isPureInputFrame(['input'], true, false)).toBe(false);
  });

  it('rejects mixed causes', () => {
    expect(isPureInputFrame(['input', 'manual'], false, false)).toBe(false);
  });
});

describe('shouldReuseTUIChromeCache', () => {
  const base = {
    hasCache: true,
    widthMatches: true,
    stageWidthMatches: true,
    epochMatches: true,
    pureInputFrame: true,
    chromeStatic: false,
    causes: [] as NativeRenderCause[],
  };

  it('reuses on a pure input frame when geometry and epoch match', () => {
    expect(shouldReuseTUIChromeCache(base)).toBe(true);
  });

  it('rejects when the cache is missing', () => {
    expect(shouldReuseTUIChromeCache({ ...base, hasCache: false })).toBe(
      false,
    );
  });

  it('rejects when the renderer width drifted', () => {
    expect(shouldReuseTUIChromeCache({ ...base, widthMatches: false })).toBe(
      false,
    );
  });

  it('rejects when the stage width drifted', () => {
    expect(
      shouldReuseTUIChromeCache({ ...base, stageWidthMatches: false }),
    ).toBe(false);
  });

  it('rejects when the chrome epoch drifted', () => {
    expect(shouldReuseTUIChromeCache({ ...base, epochMatches: false })).toBe(
      false,
    );
  });

  it('rejects on request causes so live patches reach the chrome', () => {
    expect(
      shouldReuseTUIChromeCache({
        ...base,
        causes: ['request'],
      }),
    ).toBe(false);
  });

  it('rejects on manual causes so the goal-timer tick repaints', () => {
    expect(
      shouldReuseTUIChromeCache({
        ...base,
        causes: ['manual'],
      }),
    ).toBe(false);
  });

  it('reuses when chrome is static even on ambient animation', () => {
    expect(
      shouldReuseTUIChromeCache({
        ...base,
        pureInputFrame: false,
        chromeStatic: true,
        causes: ['animation'],
      }),
    ).toBe(true);
  });
});

describe('tuiChromeEpoch', () => {
  it('changes when the streaming phase changes', () => {
    const a = tuiChromeEpoch({ streamingPhase: 'idle', thinking: false });
    const b = tuiChromeEpoch({ streamingPhase: 'streaming', thinking: false });
    expect(a).not.toBe(b);
  });

  it('changes when the thinking flag flips', () => {
    const a = tuiChromeEpoch({ streamingPhase: 'idle', thinking: false });
    const b = tuiChromeEpoch({ streamingPhase: 'idle', thinking: true });
    expect(a).not.toBe(b);
  });

  it('changes when a live goal id or status changes', () => {
    const a = tuiChromeEpoch({
      streamingPhase: 'idle',
      thinking: false,
      liveGoalId: 'g-1',
      liveGoalStatus: 'active',
    });
    const b = tuiChromeEpoch({
      streamingPhase: 'idle',
      thinking: false,
      liveGoalId: 'g-1',
      liveGoalStatus: 'paused',
    });
    const c = tuiChromeEpoch({
      streamingPhase: 'idle',
      thinking: false,
      liveGoalId: 'g-2',
      liveGoalStatus: 'active',
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('is stable when no live goal is attached', () => {
    const a = tuiChromeEpoch({ streamingPhase: 'idle', thinking: false });
    const b = tuiChromeEpoch({ streamingPhase: 'idle', thinking: false });
    expect(a).toBe(b);
  });
});

describe('isLiveGoalChromeActive', () => {
  it('returns true for active/paused/blocked statuses', () => {
    expect(isLiveGoalChromeActive({ status: 'active' })).toBe(true);
    expect(isLiveGoalChromeActive({ status: 'paused' })).toBe(true);
    expect(isLiveGoalChromeActive({ status: 'blocked' })).toBe(true);
  });

  it('returns false for terminal statuses', () => {
    expect(isLiveGoalChromeActive({ status: 'done' })).toBe(false);
    expect(isLiveGoalChromeActive({ status: 'cancelled' })).toBe(false);
    expect(isLiveGoalChromeActive({ status: 'failed' })).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isLiveGoalChromeActive(null)).toBe(false);
    expect(isLiveGoalChromeActive(undefined)).toBe(false);
  });
});
