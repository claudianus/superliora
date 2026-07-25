import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import { setActiveAppearancePreferences } from '#/tui/utils/appearance-effects';
import {
  applyStreamTailGlow,
  applyTranscriptEntrance,
  isTranscriptEntranceActive,
  polishTranscriptLines,
  transcriptEntranceProgress,
  visibleTranscriptPayload,
  TRANSCRIPT_ENTRANCE_MS_PREMIUM,
} from '#/tui/utils/transcript-entrance';

describe('transcript-entrance', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of ['TERM', 'CI', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const) {
      delete process.env[key];
    }
    process.env['TERM'] = 'xterm-256color';
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
      animationFps: 60,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('progress eases from 0 to 1 over the entrance window', () => {
    const started = 1000;
    expect(transcriptEntranceProgress(started, undefined, 1000)).toBe(0);
    const mid = transcriptEntranceProgress(
      started,
      undefined,
      1000 + TRANSCRIPT_ENTRANCE_MS_PREMIUM / 2,
    );
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1);
    expect(
      transcriptEntranceProgress(started, undefined, 1000 + TRANSCRIPT_ENTRANCE_MS_PREMIUM),
    ).toBe(1);
    expect(isTranscriptEntranceActive(started, undefined, 1000 + 50)).toBe(true);
    expect(
      isTranscriptEntranceActive(started, undefined, 1000 + TRANSCRIPT_ENTRANCE_MS_PREMIUM + 10),
    ).toBe(false);
  });

  it('fades styled lines without dropping visible text', () => {
    const line = currentTheme.fg('primary', 'Hello stream');
    const faded = applyTranscriptEntrance([line], 1000, 'assistant', undefined, 1080);
    expect(faded).toHaveLength(1);
    expect(visibleTranscriptPayload(faded[0]!)).toContain('Hello stream');
    // Mid-entrance recolors SGR — not byte-identical to the source line.
    expect(faded[0]).not.toBe(line);
  });

  it('tail glow recolors the end of the last line', () => {
    const line = currentTheme.fg('text', 'abcdefghijklmnop');
    const glowed = applyStreamTailGlow([line], 'assistant');
    expect(visibleTranscriptPayload(glowed[0]!)).toContain('abcdefghijklmnop');
    expect(glowed[0]).not.toBe(line);
  });

  it('polish combines entrance + streaming glow while active', () => {
    const line = currentTheme.fg('text', 'partial body text here');
    const polished = polishTranscriptLines([line], {
      startedAtMs: 1000,
      kind: 'assistant',
      streaming: true,
      nowMs: 1060,
    });
    expect(visibleTranscriptPayload(polished[0]!)).toContain('partial body text here');
    expect(polished[0]).not.toBe(line);
  });

  it('snaps to original when motion is off', () => {
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off',
      particles: 'off',
      animationFps: 0,
    });
    const line = currentTheme.fg('primary', 'Instant');
    const faded = applyTranscriptEntrance([line], 1000, 'status', undefined, 1010);
    expect(faded[0]).toBe(line);
  });
});
