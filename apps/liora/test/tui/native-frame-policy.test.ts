import { describe, expect, it } from 'vitest';

import {
  frameInvalidationIntentToCause,
  resolveTUIStateNativeFramePolicy,
  shouldForceTUIStateNativeLayoutFrame,
  shouldRefreshNativeTerminalPalette,
} from '#/tui/utils/native-frame-policy';

describe('native-frame-policy', () => {
  it('maps invalidation intents to native render causes', () => {
    expect(frameInvalidationIntentToCause('content')).toBe('request');
    expect(frameInvalidationIntentToCause('layout')).toBe('manual');
    expect(frameInvalidationIntentToCause('palette')).toBe('manual');
    expect(frameInvalidationIntentToCause('animation')).toBe('animation');
    expect(frameInvalidationIntentToCause('scroll')).toBe('transcript-scroll');
  });

  it('forces authoritative redraw and palette refresh on layout shifts', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['request'],
      layoutShifted: true,
      nextTranscriptStart: 12,
      ambientAnimationAllowed: true,
    });

    expect(policy.force).toBe(true);
    expect(policy.clear).toBe(true);
    expect(policy.refreshTerminalPalette).toBe(true);
    expect(policy.clearTranscriptSelection).toBe(false);
  });

  it('refreshes terminal palette on ambient animation authoritative frames', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['animation'],
      layoutShifted: false,
      priorTranscriptStart: 4,
      nextTranscriptStart: 4,
      ambientAnimationAllowed: true,
    });

    expect(policy.force).toBe(true);
    expect(policy.clear).toBe(true);
    expect(policy.refreshTerminalPalette).toBe(true);
    expect(shouldRefreshNativeTerminalPalette(['animation'], false)).toBe(false);
    expect(shouldForceTUIStateNativeLayoutFrame(['animation'], false, { ambientAnimation: true })).toBe(
      true,
    );
  });

  it('clears transcript selection when the viewport start moves', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['request'],
      layoutShifted: false,
      priorTranscriptStart: 2,
      nextTranscriptStart: 8,
      ambientAnimationAllowed: false,
    });

    expect(policy.clearTranscriptSelection).toBe(true);
  });
});
