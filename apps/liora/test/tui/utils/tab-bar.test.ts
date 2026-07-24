import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES, type AppearancePreferences } from '#/tui/config';
import { TabBar } from '#/tui/utils/tab-bar';

const ANSI_SGR = /\u001b\[[0-9;]*m/g;
// Pictographic emoji and dingbats are banned — only monospace-safe glyphs may
// reach the grid (matches the spinner/surface glyph-safety policy).
const EMOJI_OR_DINGBAT = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const PREMIUM: AppearancePreferences = {
  ...DEFAULT_APPEARANCE_PREFERENCES,
  profile: 'premium',
  particles: 'premium',
};
const OFF: AppearancePreferences = {
  ...DEFAULT_APPEARANCE_PREFERENCES,
  profile: 'off',
  particles: 'off',
};

// Identity color callbacks — the effect underline emits its own ANSI via the
// renderer styled-run primitive, so we strip ANSI and assert on raw glyphs.
const id = (_token: string, text: string): string => text;
const baseOptions = { width: 80, fg: id, boldFg: id, dimFg: id };

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function makeBar(): { bar: TabBar; a: string; c: string } {
  const bar = new TabBar();
  const a = bar.addTab({ id: 'a', title: 'agent-core', status: 'working' });
  bar.addTab({ id: 'b', title: 'node-sdk', status: 'idle' });
  const c = bar.addTab({ id: 'c', title: 'tui-renderer', status: 'error' });
  return { bar, a, c };
}

describe('TabBar.render regression (underline slide methods)', () => {
  it('does not throw across premium tab switches and clock ticks', () => {
    // Regression: render() called updateUnderlineSlide/resolveUnderlineSlide/
    // renderEffectUnderline before they were defined → TypeError crash whenever
    // a premium tab bar re-rendered. Exercise the full path repeatedly.
    const { bar, a, c } = makeBar();
    bar.setActive(a);
    let last: string[] = [];
    for (let t = 0; t <= 2000; t += 250) {
      last = bar.render({ ...baseOptions, appearance: PREMIUM, nowMs: t });
      expect(Array.isArray(last)).toBe(true);
      expect(last.length).toBeGreaterThanOrEqual(2);
    }
    // Switch active tab mid-animation and keep ticking — the slide path runs.
    bar.setActive(c);
    for (let t = 2000; t <= 4000; t += 150) {
      last = bar.render({ ...baseOptions, appearance: PREMIUM, nowMs: t });
      expect(last.length).toBeGreaterThanOrEqual(2);
    }
    expect(last.some((line) => strip(line).includes('━'))).toBe(true);
  });

  it('premium render frames the active tab with rounded notches', () => {
    const { bar, a } = makeBar();
    bar.setActive(a);
    const out = bar
      .render({ ...baseOptions, appearance: PREMIUM, nowMs: 0 })
      .map(strip)
      .join('\n');
    expect(out).toContain('╭');
    expect(out).toContain('╮');
    expect(out).toContain('agent-core');
  });

  it('off profile renders a static, time-invariant underline', () => {
    const { bar, a } = makeBar();
    bar.setActive(a);
    const at0 = bar.render({ ...baseOptions, appearance: OFF, nowMs: 0 }).map(strip);
    const at5000 = bar.render({ ...baseOptions, appearance: OFF, nowMs: 5000 }).map(strip);
    // Static legacy render must not depend on the animation clock.
    expect(at5000).toEqual(at0);
    const joined = at0.join('\n');
    expect(joined).toContain('━'); // active segment
    expect(joined).toContain('─'); // inactive fill
  });

  it('underline slides when the active tab changes (in-flight frame differs)', () => {
    const { bar, a, c } = makeBar();
    bar.setActive(a);
    // Establish the "from" geometry.
    bar.render({ ...baseOptions, appearance: PREMIUM, nowMs: 0 });
    bar.setActive(c);
    const start = bar
      .render({ ...baseOptions, appearance: PREMIUM, nowMs: 1000 })
      .map(strip)
      .join('\n');
    const mid = bar
      .render({ ...baseOptions, appearance: PREMIUM, nowMs: 1150 })
      .map(strip)
      .join('\n');
    // The underline head moves during the slide, so an intermediate frame must
    // differ from the first post-switch frame.
    expect(mid).not.toEqual(start);
  });

  it('emits no emoji or dingbat glyphs in premium frames', () => {
    const { bar, a, c } = makeBar();
    bar.setActive(a);
    const frames: string[] = [];
    for (let t = 0; t <= 1600; t += 200) {
      frames.push(...bar.render({ ...baseOptions, appearance: PREMIUM, nowMs: t }));
    }
    bar.setActive(c);
    for (let t = 1600; t <= 2400; t += 200) {
      frames.push(...bar.render({ ...baseOptions, appearance: PREMIUM, nowMs: t }));
    }
    for (const frame of frames) {
      expect(strip(frame)).not.toMatch(EMOJI_OR_DINGBAT);
    }
  });
});
