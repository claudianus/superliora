import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chromeBandAnimating,
  renderLiveRatioBar,
  renderLiveSectionHeader,
  renderPulseCountChip,
} from '#/tui/components/chrome/chrome-band-motion';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';
import { currentTheme, darkColors } from '#/tui/theme';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const off = { ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' as const };

beforeEach(() => {
  currentTheme.setPalette(darkColors);
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
});

afterEach(() => {
  currentTheme.setPalette(darkColors);
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
});

describe('chrome-band-motion', () => {
  it('renders a static section header when ambient is off', () => {
    expect(strip(renderLiveSectionHeader('TK', true, 'test', off))).toBe('TK');
    expect(strip(renderLiveSectionHeader('TK', false, 'test', off))).toBe('TK');
  });

  it('prefixes a live dot when ambient motion is on', () => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    // Pulse frames rotate (●/◆/…); only the live prefix + label matter here.
    expect(strip(renderLiveSectionHeader('FLOW', true))).toMatch(/^. FLOW$/);
  });

  it('keeps ratio bars byte-stable when animated is false', () => {
    const a = renderLiveRatioBar(0.5, 8, { animated: false, now: 1_000 });
    const b = renderLiveRatioBar(0.5, 8, { animated: false, now: 9_000 });
    expect(a).toBe(b);
    expect(strip(a)).toMatch(/^[▓░]+$/);
  });

  it('falls back pulse chips to plain fg when ambient is off', () => {
    expect(strip(renderPulseCountChip('wip 1/1', 'todo:wip', 'primary', off))).toBe('wip 1/1');
  });

  it('gates memo-skip on live/reveal/marquee/flash only', () => {
    expect(chromeBandAnimating({})).toBe(false);
    expect(chromeBandAnimating({ live: true })).toBe(true);
    expect(chromeBandAnimating({ revealPending: true })).toBe(true);
    expect(chromeBandAnimating({ marquee: true })).toBe(true);
    expect(chromeBandAnimating({ changeFlash: true })).toBe(true);
  });
});
