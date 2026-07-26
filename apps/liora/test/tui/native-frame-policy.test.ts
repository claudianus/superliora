import { describe, expect, it } from 'vitest';

import {
  frameInvalidationIntentToCause,
  isPureInputFrame,
  isPureTranscriptScrollFrame,
  resolveTUIStateNativeFramePolicy,
  shouldForceNativeCursor,
  shouldForceTUIStateNativeLayoutFrame,
  shouldRefreshNativeTerminalPalette,
  shouldUseAmbientDamageOnlyPaint,
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

  it('treats scroll coalesced with ambient animation as pure scroll (no force/clear)', () => {
    expect(
      isPureTranscriptScrollFrame(['transcript-scroll', 'animation'], true, false),
    ).toBe(true);
    expect(
      shouldForceTUIStateNativeLayoutFrame(['transcript-scroll', 'animation'], false, {
        viewportScrolled: true,
        ambientAnimation: true,
      }),
    ).toBe(false);

    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['transcript-scroll', 'animation'],
      viewportScrolled: true,
      structuralShift: false,
      priorTranscriptStart: 4,
      nextTranscriptStart: 7,
      ambientAnimationAllowed: true,
    });
    expect(policy.force).toBe(false);
    expect(policy.clear).toBe(false);
    expect(policy.refreshTerminalPalette).toBe(false);
  });

  it('keeps pure transcript scroll damage-only so stack regions do not clear-fill', () => {
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: false,
        viewportScrolled: true,
        causes: ['transcript-scroll'],
        ambientAnimationAllowed: false,
        idleAquariumMounted: false,
      }),
    ).toBe(true);
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: false,
        viewportScrolled: true,
        causes: ['transcript-scroll', 'animation'],
        ambientAnimationAllowed: true,
        idleAquariumMounted: false,
      }),
    ).toBe(true);
    // Scroll + content still needs clears for uncovered rows.
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: false,
        viewportScrolled: true,
        causes: ['transcript-scroll', 'request'],
        ambientAnimationAllowed: false,
        idleAquariumMounted: true,
      }),
    ).toBe(false);
  });

  it('keeps ambient animation damage-only without clear or OSC palette spam', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['animation'],
      viewportScrolled: false,
      structuralShift: false,
      priorTranscriptStart: 4,
      nextTranscriptStart: 4,
      ambientAnimationAllowed: true,
    });

    expect(policy.force).toBe(false);
    expect(policy.clear).toBe(false);
    expect(policy.refreshTerminalPalette).toBe(false);
    expect(
      shouldForceTUIStateNativeLayoutFrame(['animation'], false, { ambientAnimation: true }),
    ).toBe(false);
  });

  it('still clears on resize even when animation is coalesced', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['resize', 'animation'],
      viewportScrolled: false,
      structuralShift: false,
      nextTranscriptStart: 0,
      ambientAnimationAllowed: true,
    });

    expect(policy.force).toBe(true);
    expect(policy.clear).toBe(true);
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

  it('treats pure keystroke frames as incremental (no force/clear) while forceCursor stays on', () => {
    expect(isPureInputFrame(['input'], false, false)).toBe(true);
    expect(isPureInputFrame(['input', 'request'], false, false)).toBe(false);
    expect(isPureInputFrame(['input'], true, false)).toBe(false);
    expect(isPureInputFrame(['input'], false, true)).toBe(false);

    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['input'],
      viewportScrolled: false,
      structuralShift: false,
      nextTranscriptStart: 0,
      ambientAnimationAllowed: true,
    });

    // force/clear stay off on pure input even when ambient is allowed —
    // ambient is only forced when the frame cause is animation.
    expect(policy.force).toBe(false);
    expect(policy.clear).toBe(false);
    expect(
      shouldForceTUIStateNativeLayoutFrame(['input'], false, {
        ambientAnimation: true,
        viewportScrolled: false,
      }),
    ).toBe(false);
    // IME path: cursor re-emit is independent of force/clear.
    expect(shouldForceNativeCursor({ causes: ['input'] })).toBe(true);
  });

  it('keeps forceCursor on for animation-only frames without coupling it to force', () => {
    // Pure ambient animation stays damage-only; forceCursor remains independent (IME).
    expect(
      shouldForceTUIStateNativeLayoutFrame(['animation'], false, {
        ambientAnimation: true,
      }),
    ).toBe(false);
    expect(shouldForceNativeCursor({ causes: ['animation'] })).toBe(true);

    expect(
      shouldForceTUIStateNativeLayoutFrame(['animation'], false, {
        ambientAnimation: false,
      }),
    ).toBe(false);
    expect(shouldForceNativeCursor({ causes: ['animation'] })).toBe(true);
  });

  it('keeps append-only transcript growth damage-only without full clear', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['request'],
      viewportScrolled: false,
      structuralShift: true,
      contentGrew: true,
      geometryShift: false,
      contentShrunk: false,
      nextTranscriptStart: 12,
      ambientAnimationAllowed: true,
    });
    // Still force present for correctness, but do not clear the buffer.
    expect(policy.force).toBe(true);
    expect(policy.clear).toBe(false);

    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: true,
        contentGrew: true,
        geometryShift: false,
        contentShrunk: false,
        viewportScrolled: false,
        causes: ['request'],
        ambientAnimationAllowed: true,
        idleAquariumMounted: false,
      }),
    ).toBe(true);
  });

  it('still clears when transcript content shrinks', () => {
    const policy = resolveTUIStateNativeFramePolicy({
      causes: ['request'],
      viewportScrolled: false,
      structuralShift: true,
      contentGrew: false,
      contentShrunk: true,
      geometryShift: false,
      nextTranscriptStart: 3,
      ambientAnimationAllowed: false,
    });
    expect(policy.force).toBe(true);
    expect(policy.clear).toBe(true);
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: true,
        contentShrunk: true,
        contentGrew: false,
        geometryShift: false,
        viewportScrolled: false,
        causes: ['request'],
        ambientAnimationAllowed: false,
        idleAquariumMounted: true,
      }),
    ).toBe(false);
  });

  it('keeps Jewel Tank idle damage-only on request-only thinking ticks', () => {
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: false,
        viewportScrolled: false,
        causes: ['request'],
        ambientAnimationAllowed: true,
        idleAquariumMounted: true,
      }),
    ).toBe(true);
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: false,
        viewportScrolled: false,
        causes: ['request'],
        ambientAnimationAllowed: false,
        idleAquariumMounted: true,
      }),
    ).toBe(true);
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: false,
        viewportScrolled: false,
        causes: ['request'],
        ambientAnimationAllowed: true,
        idleAquariumMounted: false,
      }),
    ).toBe(false);
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: true,
        viewportScrolled: false,
        causes: ['request'],
        ambientAnimationAllowed: true,
        idleAquariumMounted: true,
      }),
    ).toBe(false);
    expect(
      shouldUseAmbientDamageOnlyPaint({
        structuralShift: false,
        viewportScrolled: false,
        causes: ['resize', 'animation'],
        ambientAnimationAllowed: true,
        idleAquariumMounted: true,
      }),
    ).toBe(false);
  });
});
