import { describe, expect, it } from 'vitest';

import {
  frameInvalidationIntentToCause,
  isPureTranscriptScrollFrame,
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

  it('forces authoritative redraw and palette refresh on structural layout shifts', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['request'],
      viewportScrolled: false,
      structuralShift: true,
      nextTranscriptStart: 12,
      ambientAnimationAllowed: true,
    });

    expect(policy.force).toBe(true);
    expect(policy.clear).toBe(true);
    expect(policy.refreshTerminalPalette).toBe(true);
    expect(policy.clearTranscriptSelection).toBe(false);
  });

  it('uses incremental frames for pure transcript scroll', () => {
    expect(
      isPureTranscriptScrollFrame(['transcript-scroll'], true, false),
    ).toBe(true);

    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['transcript-scroll'],
      viewportScrolled: true,
      structuralShift: false,
      priorTranscriptStart: 4,
      nextTranscriptStart: 7,
      ambientAnimationAllowed: false,
    });

    expect(policy.force).toBe(false);
    expect(policy.clear).toBe(false);
    expect(policy.refreshTerminalPalette).toBe(false);
    expect(policy.clearTranscriptSelection).toBe(true);
    expect(
      shouldForceTUIStateNativeLayoutFrame(['transcript-scroll'], false, {
        viewportScrolled: true,
      }),
    ).toBe(false);
    expect(
      shouldRefreshNativeTerminalPalette(['transcript-scroll'], false, {
        viewportScrolled: true,
      }),
    ).toBe(false);
  });

  it('forces authoritative redraw when scroll is combined with content updates', () => {
    expect(
      isPureTranscriptScrollFrame(['transcript-scroll', 'request'], true, false),
    ).toBe(false);
    expect(
      shouldForceTUIStateNativeLayoutFrame(['transcript-scroll', 'request'], false, {
        viewportScrolled: true,
      }),
    ).toBe(true);
  });

  it('refreshes terminal palette on ambient animation authoritative frames', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['animation'],
      viewportScrolled: false,
      structuralShift: false,
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
      viewportScrolled: true,
      structuralShift: false,
      priorTranscriptStart: 2,
      nextTranscriptStart: 8,
      ambientAnimationAllowed: false,
    });

    expect(policy.clearTranscriptSelection).toBe(true);
  });
});
