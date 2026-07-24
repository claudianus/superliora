import type { RendererRootUI } from '#/tui/renderer';
import { visibleWidth } from '#/tui/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MoonLoader } from '#/tui/components/chrome/moon-loader';
import { MOON_SPINNER_FRAMES } from '#/tui/constant/rendering';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
} from '#/tui/utils/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const loaders: MoonLoader[] = [];

function createLoader(
  style?: ConstructorParameters<typeof MoonLoader>[1],
  colorFn?: ConstructorParameters<typeof MoonLoader>[2],
  label?: ConstructorParameters<typeof MoonLoader>[3],
): MoonLoader {
  const loader = new MoonLoader({ requestRender: vi.fn() } as unknown as RendererRootUI, style, colorFn, label);
  loaders.push(loader);
  return loader;
}

afterEach(() => {
  for (const loader of loaders) loader.stop();
  loaders.length = 0;
  vi.useRealTimers();
});

describe('MoonLoader', () => {
  it('shows elapsed time next to a labeled spinner', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const loader = createLoader('braille', undefined, 'working...');

    expect(strip(loader.renderInline())).toContain('working... 0s');

    vi.advanceTimersByTime(1_100);
    expect(strip(loader.renderInline())).toContain('working... 1s');
  });

  it('shows elapsed time when the spinner has no label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const loader = createLoader();

    expect(strip(loader.renderInline())).toContain('0s');

    vi.advanceTimersByTime(61_000);
    loader.setAvailableWidth(80);
    expect(strip(loader.renderInline())).toContain('1m01s');
  });

  it('keeps the tip out of inline rendering for swarm progress lines', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const loader = createLoader('moon', undefined, 'working...');
    loader.setTip(' · Tip: ctrl+s: steer mid-turn');
    loader.setAvailableWidth(80);

    const inline = strip(loader.renderInline());
    expect(inline).toContain('working... 0s');
    expect(inline).not.toContain('Tip');
    expect(inline).not.toContain('steer');
  });

  it('renders only the animated glyph for dense swarm embeds', () => {
    const loader = createLoader('braille', undefined, 'working...');
    const glyph = strip(loader.renderGlyph());
    const inline = strip(loader.renderInline());

    expect(glyph.length).toBeGreaterThan(0);
    expect(inline).toContain('working...');
    expect(glyph).not.toContain('working...');
    expect(glyph).not.toContain('0s');
  });

  it('still shows the tip on the activity row when width allows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const loader = createLoader('moon', undefined, 'working...');
    loader.setTip(' · Tip: ctrl+s: steer mid-turn');
    loader.setAvailableWidth(80);

    const row = strip(loader.render(80).join('\n'));
    expect(row).toContain('Tip: ctrl+s: steer mid-turn');
  });

  it('renders a multi-cell comet trail for the comet style', () => {
    const loader = createLoader('comet', undefined, 'working...');
    const glyph = strip(loader.renderGlyph());
    const inline = strip(loader.renderInline());

    expect(glyph.length).toBeGreaterThan(1);
    expect(glyph).toMatch(/[·•◦○●]/);
    expect(inline).toContain('working...');
    expect(inline).toMatch(/[·•◦○●]/);
  });
});


describe('MoonLoader brand moon spinner', () => {
  // Pictographic emoji (incl. the old 🌑–🌘 moons) and dingbats (✦✧✺)
  // are banned — only monospace-safe glyphs may reach the grid.
  const EMOJI_OR_DINGBAT = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  const ENV_KEYS = ['TERM', 'NO_COLOR', 'CI', 'SSH_CLIENT', 'SSH_CONNECTION', 'SSH_TTY'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  function setMotionEnv(motionOn: boolean): void {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env['TERM'] = 'xterm-256color';
    if (!motionOn) process.env['CI'] = '1';
  }

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, 0));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.useRealTimers();
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('replaces emoji moon phases with monospace-safe brand glyphs', () => {
    expect(MOON_SPINNER_FRAMES).toEqual(['◐', '◓', '◑', '◒']);
    for (const frame of MOON_SPINNER_FRAMES) {
      expect(frame).not.toMatch(EMOJI_OR_DINGBAT);
      expect(visibleWidth(frame)).toBe(1);
    }
  });

  it('rotates through all four brand phases on the shared clock', () => {
    setMotionEnv(true);
    const loader = createLoader('moon');
    for (let tick = 0; tick < 4; tick++) {
      advanceAppearanceAnimationClock(tick * 120);
      expect(strip(loader.renderGlyph())).toBe(MOON_SPINNER_FRAMES[tick]);
    }
  });

  it('keeps a single safe glyph inline through every animation phase', () => {
    setMotionEnv(true);
    const loader = createLoader('moon');
    for (let tick = 0; tick < 4; tick++) {
      advanceAppearanceAnimationClock(tick * 120);
      const inline = strip(loader.renderInline());
      // Inline form is "<glyph> <elapsed>" — the glyph must stay a single
      // monospace-safe phase, never a double-width emoji.
      expect(inline).toMatch(/^[◐◓◑◒] /);
      expect(inline.charAt(0)).toBe(MOON_SPINNER_FRAMES[tick]);
    }
  });

  it('falls back to a static themed glyph when motion effects are off', () => {
    setMotionEnv(false); // CI=1 → motionEffectsAllowed() === false
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    advanceAppearanceAnimationClock(0);
    const loader = createLoader('moon');
    const glyph = loader.renderGlyph();
    // Static fallback: flat theme color, no gradient wave.
    expect(glyph).toBe(currentTheme.fg('primary', '◐'));
    expect(strip(glyph)).toBe('◐');
  });

  it('falls back to a static themed glyph when the appearance profile is off', () => {
    setMotionEnv(true);
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off',
      particles: 'off',
    });
    advanceAppearanceAnimationClock(0);
    const loader = createLoader('moon');
    expect(loader.renderGlyph()).toBe(currentTheme.fg('primary', '◐'));
  });

  it('applies the brand gradient pulse when motion and premium are active', () => {
    setMotionEnv(true);
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    advanceAppearanceAnimationClock(0);
    const loader = createLoader('moon');
    const glyph = loader.renderGlyph();
    expect(strip(glyph)).toBe('◐');
    const plain = currentTheme.fg('primary', '◐');
    // With color support the gradient must differ from a flat theme color;
    // on colorless terminals both collapse to the same plain glyph.
    if (plain !== '◐') {
      expect(glyph).not.toBe(plain);
    }
  });
});
