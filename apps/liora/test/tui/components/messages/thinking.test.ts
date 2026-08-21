import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

import { visibleWidth, type RendererRootUI } from '#/tui/renderer';
import {
  ThinkingComponent,
  renderThinkingMascot,
  thinkingMascotGlyph,
} from '#/tui/components/messages/thinking';
import { THINKING_MASCOT_FRAMES, THINKING_MASCOT_PERIOD_MS } from '#/tui/constant/rendering';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceTransportStability,
} from '#/tui/features/appearance/appearance-effects';
import { setActiveTranscriptDetail } from '#/tui/features/transcript/transcript-density';
import { currentTheme } from '#/tui/theme';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const longThinking = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n');
const previousChalkLevel = chalk.level;
const previousEnv = {
  TERM: process.env['TERM'],
  CI: process.env['CI'],
  NO_COLOR: process.env['NO_COLOR'],
};

function enableLiveMotion(): void {
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  chalk.level = 3;
}

describe('ThinkingComponent', () => {
  beforeEach(() => {
    setActiveTranscriptDetail('standard');
  });

  afterEach(() => {
    setActiveTranscriptDetail('standard');
    chalk.level = previousChalkLevel;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('shows the live spinner header and a short content glance while streaming', () => {
    advanceAppearanceAnimationClock(0);
    const component = new ThinkingComponent('working it out', true, 'live');
    const out = strip(component.render(80).join('\n'));

    expect(out).toMatch(/[·∘○◎●] thinking\.\.\./);
    expect(out).not.toMatch(/  [·∘○◎●] thinking\.\.\./);
    expect(out).not.toMatch(new RegExp(`${STATUS_BULLET}[·∘○◎●]`));
    // Live thinking surfaces a short tail glance so progress is transparent.
    expect(out).toContain('working it out');
  });

  it('shows a 4-line live thinking tail while collapsed', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    const out = strip(component.render(80).join('\n'));

    expect(out).not.toContain('line1');
    expect(out).not.toContain('line2');
    expect(out).not.toContain('line3');
    expect(out).toContain('line4');
    expect(out).toContain('line5');
    expect(out).toContain('line6');
    expect(out).toContain('line7');
    expect(out).not.toContain('ctrl+o to expand');
  });

  it('keeps expanded live thinking height-limited to a longer tail', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.setExpanded(true);
    const out = strip(component.render(80).join('\n'));

    // Expanded live thinking is height-capped to max(preview, 4) → last 4 lines.
    expect(out).not.toContain('line1');
    expect(out).not.toContain('line3');
    expect(out).toContain('line4');
    expect(out).toContain('line6');
    expect(out).toContain('line7');
    expect(out).not.toContain('ctrl+o to expand');
  });

  it('advances the live spinner frame with the animation clock and stops on finalize', () => {
    enableLiveMotion();
    advanceAppearanceAnimationClock(0);
    const component = new ThinkingComponent('step', true, 'live', {
      requestRender: vi.fn(),
    } as unknown as RendererRootUI);

    // Cosine start: dust glyph.
    expect(strip(component.render(80).join('\n'))).toContain('· thinking...');

    // Mid-period dwells on the filled orb.
    advanceAppearanceAnimationClock(THINKING_MASCOT_PERIOD_MS / 2);
    expect(strip(component.render(80).join('\n'))).toContain('● thinking...');

    // After finalize the spinner line is replaced by the "thinking complete"
    // summary — no live "thinking..." row.
    component.finalize();
    const finalized = strip(component.render(80).join('\n'));
    expect(finalized).not.toContain('thinking...');
    expect(finalized).toContain('thinking complete');
  });

  it('finalizes in place into a hidden collapsed summary', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');

    component.finalize();

    const out = strip(component.render(80).join('\n'));
    expect(out).toContain('thinking complete');
    expect(out).toContain('... (7 lines hidden, ctrl+o to expand)');
    expect(out).not.toContain('line1');
    expect(out).not.toContain('line2');
    expect(out).not.toContain('line3');
    expect(out).not.toContain('line4');
  });

  it('reuses rendered line arrays at the same width until display state changes', () => {
    const component = new ThinkingComponent(longThinking, true, 'finalized');
    const first = component.render(80);
    const second = component.render(80);

    expect(second).toBe(first);

    component.setExpanded(true);
    expect(component.render(80)).not.toBe(first);
  });

  it('shows elapsed time while live and keeps it after finalization', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const component = new ThinkingComponent('step', true, 'live', {
      requestRender: vi.fn(),
    } as unknown as RendererRootUI);

    expect(strip(component.render(80).join('\n'))).toContain('thinking... 0s');

    vi.advanceTimersByTime(65_000);
    expect(strip(component.render(80).join('\n'))).toContain('thinking... 1m05s');

    component.finalize();
    expect(strip(component.render(80).join('\n'))).toContain('thinking complete 1m05s');

    vi.advanceTimersByTime(10_000);
    expect(strip(component.render(80).join('\n'))).toContain('thinking complete 1m05s');
    vi.useRealTimers();
  });

  it('labels live thinking as stalled after 30s without new text', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));
    const component = new ThinkingComponent('plan step', true, 'live');

    expect(strip(component.render(80).join('\n'))).not.toContain('stalled');

    vi.advanceTimersByTime(30_000);
    expect(strip(component.render(80).join('\n'))).toContain('stalled 30s');

    // Fresh tokens clear the stall marker.
    component.setText('plan step 2');
    expect(strip(component.render(80).join('\n'))).not.toContain('stalled');
    vi.useRealTimers();
  });

  it('expands and collapses after finalization', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();

    component.setExpanded(true);
    const expanded = strip(component.render(80).join('\n'));
    expect(expanded).toContain('line7');
    expect(expanded).not.toContain('ctrl+o to expand');

    component.setExpanded(false);
    const collapsed = strip(component.render(80).join('\n'));
    expect(collapsed).toContain('thinking complete');
    expect(collapsed).not.toContain('line7');
    expect(collapsed).toContain('ctrl+o to expand');
  });

  it('keeps the finalized truncation footer within the requested render width', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();

    for (const line of component.render(37)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(37);
    }
  });

  it('shows the full live thinking body when transcript detail is full', () => {
    setActiveTranscriptDetail('full');
    try {
      const component = new ThinkingComponent(longThinking, true, 'live');
      const out = strip(component.render(80).join('\n'));
      expect(out).toContain('line1');
      expect(out).toContain('line7');
      expect(out).not.toContain('ctrl+o to expand');
    } finally {
      setActiveTranscriptDetail('standard');
    }
  });

  it('hides live thinking body at minimal density', () => {
    setActiveTranscriptDetail('minimal');
    try {
      const component = new ThinkingComponent(longThinking, true, 'live');
      const out = strip(component.render(80).join('\n'));
      expect(out).toContain('thinking...');
      expect(out).not.toContain('line7');
    } finally {
      setActiveTranscriptDetail('standard');
    }
  });

  it('collapses compact thinking to a quiet status line', () => {
    setActiveTranscriptDetail('compact');
    try {
      const live = new ThinkingComponent(longThinking, true, 'live');
      const liveOut = strip(live.render(80).join('\n'));
      expect(liveOut).toMatch(/[·∘○◎●] Thinking…/);
      expect(liveOut).not.toContain('thinking...');
      expect(liveOut).not.toContain('line7');
      expect(liveOut).not.toContain('ctrl+o to expand');

      live.finalize();
      const done = strip(live.render(80).join('\n'));
      expect(done).toContain('Thought briefly');
      expect(done).not.toMatch(/[·∘○◎●] Thought/);
      expect(done).not.toContain('thinking complete');
      expect(done).not.toContain('line7');
    } finally {
      setActiveTranscriptDetail('standard');
    }
  });
});

describe('thinking thought-orb mascot', () => {
  const EMOJI_OR_DINGBAT = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u;
  const ENV_KEYS = ['TERM', 'NO_COLOR', 'CI', 'SSH_CLIENT', 'SSH_CONNECTION', 'SSH_TTY'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  function setMotionEnv(motionOn: boolean): void {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env['TERM'] = 'xterm-256color';
    if (!motionOn) process.env['NO_COLOR'] = '1';
  }

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceTransportStability('synchronized');
  });

  it('uses five monospace-safe orb glyphs', () => {
    expect([...THINKING_MASCOT_FRAMES]).toEqual(['·', '∘', '○', '◎', '●']);
    for (const frame of THINKING_MASCOT_FRAMES) {
      expect(frame).not.toMatch(EMOJI_OR_DINGBAT);
      expect(visibleWidth(frame)).toBe(1);
    }
  });

  it('morphs through every orb on a cosine period', () => {
    setMotionEnv(true);
    const seen = new Set<string>();
    for (let step = 0; step < 32; step++) {
      seen.add(thinkingMascotGlyph((step / 32) * THINKING_MASCOT_PERIOD_MS));
    }
    expect(seen).toEqual(new Set(THINKING_MASCOT_FRAMES));
    expect(thinkingMascotGlyph(0)).toBe('·');
    expect(thinkingMascotGlyph(THINKING_MASCOT_PERIOD_MS / 2)).toBe('●');
  });

  it('freezes on the rest orb when color motion is gated off', () => {
    setMotionEnv(false);
    expect(thinkingMascotGlyph(0)).toBe('○');
    expect(thinkingMascotGlyph(THINKING_MASCOT_PERIOD_MS / 2)).toBe('○');
  });

  it('keeps the orb pulse time-varying on an unstable transport', () => {
    setMotionEnv(true);
    setAppearanceTransportStability('unstable');
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    advanceAppearanceAnimationClock(0);
    const first = renderThinkingMascot();
    advanceAppearanceAnimationClock(400);
    const second = renderThinkingMascot();
    expect(strip(first)).toMatch(/[·∘○◎●] /);
    expect(first).not.toBe(second);
  });

  it('applies the brand gradient pulse when motion and premium are active', () => {
    setMotionEnv(true);
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    advanceAppearanceAnimationClock(0);
    const painted = renderThinkingMascot();
    expect(strip(painted)).toBe('· ');
    const plain = currentTheme.fg('textDim', '· ');
    if (plain !== '· ') {
      expect(painted).not.toBe(plain);
    }
  });
});
