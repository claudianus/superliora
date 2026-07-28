import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import { setActiveAppearancePreferences } from '#/tui/utils/appearance-effects';
import {
  applyStreamTailGlow,
  applyToolHeaderEntrance,
  applyTranscriptEntrance,
  applyTurnBoundaryCue,
  isTranscriptEntranceActive,
  isTurnBoundaryCueActive,
  polishTranscriptLines,
  toolHeaderEntranceDurationMs,
  turnBoundaryCueDurationMs,
  transcriptEntranceProgress,
  visibleTranscriptPayload,
  TOOL_HEADER_ENTRANCE_MS,
  TRANSCRIPT_ENTRANCE_MS_PREMIUM,
  TURN_BOUNDARY_CUE_MS,
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

  it('does not insert spaces for CJK/emoji wide-char continuation pads', () => {
    const line = currentTheme.fg('text', '한a👍b');
    const faded = applyTranscriptEntrance([line], 1000, 'assistant', undefined, 1080);
    const visible = visibleTranscriptPayload(faded[0]!);
    // No space between wide cluster and next ASCII/emoji cluster.
    expect(visible).toContain('한a');
    expect(visible).toContain('👍b');
    expect(visible.includes('한 a')).toBe(false);
    expect(visible.includes('👍 b') || visible.includes('a 👍')).toBe(false);
  });

  describe('tool header entrance settle', () => {
    it('highlights the header at t0 and settles byte-identical after the window', () => {
      const line = currentTheme.dim('(foo.ts)');
      const started = 5000;
      const active = applyToolHeaderEntrance(line, started, undefined, started);
      expect(visibleTranscriptPayload(active)).toContain('(foo.ts)');
      expect(active).not.toBe(line);
      // Previously unbolded runs gain a bold truecolor highlight while the
      // settle decays; the settled line is the untouched input.
      expect(active).toContain('\u001B[0;1;38;2');
      expect(line).not.toContain('\u001B[0;1;38;2');

      const settled = applyToolHeaderEntrance(
        line,
        started,
        undefined,
        started + TOOL_HEADER_ENTRANCE_MS + 20,
      );
      expect(settled).toBe(line);
    });

    it('stretches the settle under subtle but keeps it under the 400ms cue ceiling', () => {
      const subtle = {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'subtle' as const,
        particles: 'ambient' as const,
      };
      const duration = toolHeaderEntranceDurationMs(subtle);
      expect(duration).toBeGreaterThan(TOOL_HEADER_ENTRANCE_MS);
      expect(duration).toBeLessThanOrEqual(400);
      expect(toolHeaderEntranceDurationMs()).toBe(TOOL_HEADER_ENTRANCE_MS);
    });

    it('returns the line untouched when motion is off', () => {
      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        particles: 'off',
      });
      const line = currentTheme.fg('primary', 'Using Read');
      expect(applyToolHeaderEntrance(line, 1000, undefined, 1000)).toBe(line);
      expect(toolHeaderEntranceDurationMs()).toBe(0);
    });
  });

  describe('turn boundary cue', () => {
    it('highlights the line at t0 and settles byte-identical after the window', () => {
      const line = currentTheme.fg('text', 'First answer line');
      const started = 9000;
      const active = applyTurnBoundaryCue(line, started, undefined, started);
      expect(visibleTranscriptPayload(active)).toContain('First answer line');
      expect(active).not.toBe(line);
      expect(active).toContain('\u001B[0;1;38;2');
      expect(line).not.toContain('\u001B[0;1;38;2');

      const settled = applyTurnBoundaryCue(
        line,
        started,
        undefined,
        started + TURN_BOUNDARY_CUE_MS + 20,
      );
      expect(settled).toBe(line);
    });

    it('tracks the cue window through isTurnBoundaryCueActive', () => {
      const started = 9000;
      expect(isTurnBoundaryCueActive(started, undefined, started)).toBe(true);
      expect(
        isTurnBoundaryCueActive(started, undefined, started + TURN_BOUNDARY_CUE_MS - 1),
      ).toBe(true);
      expect(
        isTurnBoundaryCueActive(started, undefined, started + TURN_BOUNDARY_CUE_MS + 1),
      ).toBe(false);
      // Never armed → never active.
      expect(isTurnBoundaryCueActive(undefined, undefined, started)).toBe(false);
    });

    it('stretches the cue under subtle but keeps it under the 400ms ceiling', () => {
      const subtle = {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'subtle' as const,
        particles: 'ambient' as const,
      };
      const duration = turnBoundaryCueDurationMs(subtle);
      expect(duration).toBeGreaterThan(TURN_BOUNDARY_CUE_MS);
      expect(duration).toBeLessThanOrEqual(400);
      expect(turnBoundaryCueDurationMs()).toBe(TURN_BOUNDARY_CUE_MS);
    });

    it('returns the line untouched when motion is off', () => {
      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        particles: 'off',
      });
      const line = currentTheme.fg('text', 'Turn begins');
      expect(applyTurnBoundaryCue(line, 1000, undefined, 1000)).toBe(line);
      expect(turnBoundaryCueDurationMs()).toBe(0);
      expect(isTurnBoundaryCueActive(1000, undefined, 1000)).toBe(false);
    });
  });
});
