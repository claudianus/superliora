import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { visibleWidth } from '#/tui/renderer';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  advanceAppearanceAnimationClock,
  appearanceAnimationFrameIntervalMs,
  paintUltraworkEditorBorderGlow,
  renderMeteorField,
  renderParticleDivider,
  renderParticleRail,
  renderSpectacularText,
  resolveUltraworkBorderGlowHex,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('premium ambient cadence', () => {
  it('pins premium ambient repaint to ~30fps (33ms), not densify 1ms', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
      animationFps: 120,
    };
    setActiveAppearancePreferences(premium);
    expect(appearanceAnimationFrameIntervalMs(premium)).toBe(33);
  });

  it('keeps subtle ambient slower than premium cinematic floor', () => {
    const subtle = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'ambient' as const,
      animationFps: 20,
    };
    setActiveAppearancePreferences(subtle);
    expect(appearanceAnimationFrameIntervalMs(subtle)).toBeGreaterThanOrEqual(33);
  });
});

describe('soft ambient particles', () => {
  const previous = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps header dividers mostly quiet with a soft highlight + rare comet', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    const line = renderParticleDivider(48, 'header:divider', appearance);
    const plain = strip(line);
    expect(visibleWidth(line)).toBe(48);
    // Base stroke remains dominant; particles are accents.
    const strokes = Array.from(plain).filter((ch) => ch === '─' || ch === '━').length;
    const sparkles = Array.from(plain).filter((ch) => /[·∙•◦*]/.test(ch)).length;
    expect(strokes).toBeGreaterThan(sparkles);
    expect(sparkles).toBeGreaterThan(0);
    expect(sparkles).toBeLessThan(20);
  });

  it('renders a sparse welcome meteor field with stable geometry', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    const rows = renderMeteorField(40, 3, 'welcome:meteors', appearance);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(visibleWidth(row)).toBe(40);
    }
    const plain = rows.map(strip).join('\n');
    expect(plain).toMatch(/[·∙•◦*]/);
    // Most cells stay empty sky.
    const filled = Array.from(plain.replaceAll('\n', '')).filter((ch) => ch !== ' ').length;
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThan(40);
  });

  it('advances rail comets with the shared animation clock without densifying', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    const a = strip(renderParticleRail(40, appearance, 'rail-clock'));
    advanceAppearanceAnimationClock(Date.now() + 500);
    const b = strip(renderParticleRail(40, appearance, 'rail-clock'));
    expect(a).not.toBe(b);
    expect(Array.from(a).filter((ch) => ch !== ' ').length).toBeLessThan(24);
  });

  it('paints an Ultrawork perimeter chase on editor border glyphs only', () => {
    advanceAppearanceAnimationClock(0);
    const frame = [
      [
        { char: '╭', style: { fg: '#333333' } },
        { char: '─', style: { fg: '#333333' } },
        { char: '─', style: { fg: '#333333' } },
        { char: '╮', style: { fg: '#333333' } },
      ],
      [
        { char: '│', style: { fg: '#333333' } },
        { char: '>', style: { fg: '#EEEEEE' } },
        { char: ' ', style: { fg: '#EEEEEE' } },
        { char: '│', style: { fg: '#333333' } },
      ],
      [
        { char: '╰', style: { fg: '#333333' } },
        { char: '─', style: { fg: '#333333' } },
        { char: '─', style: { fg: '#333333' } },
        { char: '╯', style: { fg: '#333333' } },
      ],
    ];
    const painted = paintUltraworkEditorBorderGlow(frame, 0);
    expect(painted).toHaveLength(3);
    const top = painted[0] as Array<{ char: string; style?: { fg?: string; bold?: boolean } }>;
    const mid = painted[1] as Array<{ char: string; style?: { fg?: string; bold?: boolean } }>;
    // Prompt glyph must stay untouched.
    expect(mid[1]?.char).toBe('>');
    expect(mid[1]?.style?.fg).toBe('#EEEEEE');
    // Border cells pick up glow colors (not the original static #333333).
    const borderColors = [top[0], top[1], top[2], top[3], mid[0], mid[3]]
      .map((cell) => cell?.style?.fg)
      .filter((fg): fg is string => typeof fg === 'string');
    expect(borderColors.length).toBeGreaterThan(0);
    expect(borderColors.some((fg) => fg.toLowerCase() !== '#333333')).toBe(true);
    // Hue advances with the clock.
    const a = resolveUltraworkBorderGlowHex(0);
    const b = resolveUltraworkBorderGlowHex(900);
    expect(a).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(b).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(a.toLowerCase()).not.toBe(b.toLowerCase());
  });

  it('parses ANSI string editor lines instead of Array.from SGR explosion', () => {
    // Approval / permission dialogs replace the editor and still emit chalk
    // strings. Ultrawork border paint must parse CSI, not split ESC into cells.
    const ansiChoice =
      '\u001B[38;2;122;162;247m\u001B[1m  \u001B[0;1;38;2;230;57;70m❯\u001B[0m 1. Approve once\u001B[22m\u001B[39m';
    const frame = [
      '╭' + '─'.repeat(28) + '╮',
      ansiChoice,
      '╰' + '─'.repeat(28) + '╯',
    ];
    const painted = paintUltraworkEditorBorderGlow(frame, 0);
    expect(painted).toHaveLength(3);
    const mid = painted[1] as Array<{ char: string }>;
    const midText = mid.map((cell) => cell.char).join('');
    // Visible payload survives; SGR bodies must not become plain text cells.
    expect(midText).toContain('Approve once');
    expect(midText).toContain('❯');
    expect(midText).not.toMatch(/\[0;1;38/);
    expect(midText).not.toContain('38;2;230;57;70');
    // Cell count stays near the printable width, not the raw ANSI byte length.
    expect(mid.length).toBeLessThan(40);
    expect(mid.length).toBeGreaterThan(10);
  });
});

describe('spectacular text ANSI safety', () => {
  const previous = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
  };

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('never leaks stripped SGR bodies when restyling pre-colored text', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    // Pre-styled chalk-like SGR payload (thinking density / queue pointer bugs).
    const preStyled = '\u001B[0;1;38;2;230;57;70mthinking... 1.2s · 40c\u001B[0m';
    const rendered = renderSpectacularText(preStyled, 'ansi-leak', appearance, {
      intense: true,
    });
    // Valid output still contains CSI like `\u001B[0;1;38;2…m`. The bug is when
    // ESC is stripped and the body leaks as plain text: `[0;1;38;2…`.
    expect(rendered).not.toMatch(/(?<!\u001B)\[[0-9;]*38;2/);
    // Pre-styled source color must not survive as a plain/styled fragment.
    expect(rendered).not.toContain('38;2;230;57;70');
    // Visible payload remains.
    expect(strip(rendered)).toContain('thinking...');
    expect(strip(rendered)).toContain('40c');
  });
});
