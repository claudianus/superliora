import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  errorShakeFeedback,
  feedbackBorderGlowHex,
  feedbackEffectsActive,
  focusGlowFeedback,
  noteErrorFeedback,
  noteFocusFeedback,
  noteSelectionFeedback,
  noteSuccessFeedback,
  resetFeedbackVfxForTests,
  selectionPulseFeedback,
  successFlashFeedback,
  typingRippleFeedback,
} from '#/tui/utils/feedback-vfx';
import {
  noteTUIInputInteraction,
  resetTUIInputInteractionForTests,
} from '#/tui/utils/input-interaction';
import {
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

const ENV_KEYS = ['TERM', 'CI', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const;

function enablePremiumMotion(): void {
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
  setActiveAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium' as const,
    particles: 'premium' as const,
  });
  setAppearanceRenderHealth('healthy');
  setAppearanceRenderQuality('full');
}

describe('feedback-vfx controller', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    resetFeedbackVfxForTests();
    resetTUIInputInteractionForTests();
    enablePremiumMotion();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetFeedbackVfxForTests();
    resetTUIInputInteractionForTests();
  });

  it('reports active when motion is allowed and ambient mode is not off', () => {
    expect(feedbackEffectsActive()).toBe(true);
  });

  it('returns neutral values before any event is recorded', () => {
    const now = 10_000;
    expect(typingRippleFeedback(now)).toBe(0);
    expect(errorShakeFeedback(now)).toBe(0);
    expect(successFlashFeedback(now)).toBe(0);
    expect(focusGlowFeedback(now)).toBe(0);
    expect(selectionPulseFeedback(now)).toBe(0);
  });

  it('emits a typing ripple after an input interaction, decaying to zero', () => {
    const keystroke = 10_000;
    noteTUIInputInteraction(keystroke);
    expect(typingRippleFeedback(keystroke + 10)).toBeGreaterThan(0);
    // typingRippleIntensity window is 150ms
    expect(typingRippleFeedback(keystroke + 1000)).toBe(0);
  });

  it('emits an error shake within its window and zero after it expires', () => {
    const at = 10_000;
    noteErrorFeedback(at);
    // sample mid-window where the damped sine is non-zero
    expect(Math.abs(errorShakeFeedback(at + 50))).toBeGreaterThan(0);
    // errorShakeOffset window is 400ms
    expect(errorShakeFeedback(at + 1000)).toBe(0);
  });

  it('emits a success flash within its window and zero after it expires', () => {
    const at = 10_000;
    noteSuccessFeedback(at);
    expect(successFlashFeedback(at + 10)).toBeGreaterThan(0);
    // successFlashIntensity window is 500ms
    expect(successFlashFeedback(at + 1000)).toBe(0);
  });

  it('emits a focus glow after a focus event', () => {
    const at = 10_000;
    noteFocusFeedback(at);
    expect(focusGlowFeedback(at + 10)).toBeGreaterThan(0);
  });

  it('emits a selection pulse within its window and zero after it expires', () => {
    const at = 10_000;
    noteSelectionFeedback(at);
    expect(selectionPulseFeedback(at + 10)).toBeGreaterThan(0);
    // selectionPulseIntensity window is 300ms
    expect(selectionPulseFeedback(at + 1000)).toBe(0);
  });

  it('collapses every getter to neutral when motion effects are disallowed', () => {
    const at = 10_000;
    noteTUIInputInteraction(at);
    noteErrorFeedback(at);
    noteSuccessFeedback(at);
    noteFocusFeedback(at);
    noteSelectionFeedback(at);

    process.env['NO_COLOR'] = '1';
    expect(feedbackEffectsActive()).toBe(false);

    const now = at + 10;
    expect(typingRippleFeedback(now)).toBe(0);
    expect(errorShakeFeedback(now)).toBe(0);
    expect(successFlashFeedback(now)).toBe(0);
    expect(focusGlowFeedback(now)).toBe(0);
    expect(selectionPulseFeedback(now)).toBe(0);
  });

  it('clears recorded events on reset', () => {
    const at = 10_000;
    noteErrorFeedback(at);
    noteSuccessFeedback(at);
    noteFocusFeedback(at);
    noteSelectionFeedback(at);
    resetFeedbackVfxForTests();

    const now = at + 10;
    expect(errorShakeFeedback(now)).toBe(0);
    expect(successFlashFeedback(now)).toBe(0);
    expect(focusGlowFeedback(now)).toBe(0);
    expect(selectionPulseFeedback(now)).toBe(0);
  });

  it('keeps the base border color when no feedback is active', () => {
    const base = '#E63946';
    const accent = '#FF8E98';
    expect(feedbackBorderGlowHex(base, accent, 10_000)).toBe(base);
  });

  it('blends the border toward the accent right after a keystroke', () => {
    const base = '#E63946';
    const accent = '#FF8E98';
    const keystroke = 10_000;
    noteTUIInputInteraction(keystroke);
    const blended = feedbackBorderGlowHex(base, accent, keystroke + 10);
    expect(blended).not.toBe(base);
    expect(blended).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('returns the base border color when motion effects are disallowed', () => {
    const base = '#E63946';
    const accent = '#FF8E98';
    const keystroke = 10_000;
    noteTUIInputInteraction(keystroke);
    process.env['NO_COLOR'] = '1';
    expect(feedbackBorderGlowHex(base, accent, keystroke + 10)).toBe(base);
  });
});
