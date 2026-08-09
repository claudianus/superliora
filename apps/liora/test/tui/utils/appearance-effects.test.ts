import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

import { visibleWidth } from '#/tui/renderer';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  advanceAppearanceAnimationClock,
  appearanceAnimationFrameIntervalMs,
  BRAND_MOTION_TOKENS,
  SPECTACULAR_TOKENS,
  isStatusFlashActive,
  renderAmbientDrift,
  renderCrossfadeLine,
  renderDangerBreathe,
  renderEnterBeat,
  renderExitBeat,
  renderMeteorField,
  renderParticleDivider,
  renderParticleRail,
  renderPhaseChip,
  renderPremiumBoxFrame,
  renderSettleFlash,
  renderSpectacularText,
  renderStatusFlashLine,
  renderToneSettleFlash,
  renderTypewriterLine,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
  SETTLE_FLASH_MS,
  STATUS_FLASH_MS,
  statusFlashDurationMs,
  TYPEWRITER_MS,
} from '#/tui/features/appearance/appearance-effects';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('premium ambient cadence', () => {
  it('honors animationFps up to ~60fps (16ms), not densify 1ms', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
      animationFps: 120,
    };
    setActiveAppearancePreferences(premium);
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    expect(appearanceAnimationFrameIntervalMs(premium, 'full', 'healthy')).toBe(16);
  });

  it('maps animationFps 30 to a 33ms premium interval', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
      animationFps: 30,
    };
    expect(appearanceAnimationFrameIntervalMs(premium, 'full', 'healthy')).toBe(33);
  });

  it('keeps premium cadence under watch and soft-degrades only on degraded health', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
      animationFps: 120,
    };
    // watch alone stays at premium ms; degraded soft floor is ~32ms, not subtle 100ms.
    expect(appearanceAnimationFrameIntervalMs(premium, 'full', 'watch')).toBe(16);
    expect(appearanceAnimationFrameIntervalMs(premium, 'full', 'degraded')).toBe(32);
  });

  it('keeps subtle ambient slower than premium cinematic floor', () => {
    const subtle = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'ambient' as const,
      animationFps: 20,
    };
    setActiveAppearancePreferences(subtle);
    expect(appearanceAnimationFrameIntervalMs(subtle)).toBeGreaterThanOrEqual(16);
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

describe('premium motion vocabulary', () => {
  const previousEnv = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    chalk.level = 3;
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
    chalk.level = previousChalkLevel;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const premium = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium' as const,
    particles: 'premium' as const,
  };

  it('renderEnterBeat returns ≥4 distinct frames across its lifetime', () => {
    const frames = new Set<string>();
    const start = Date.now();
    for (let t = 0; t <= 720; t += 40) {
      vi.setSystemTime(start + t);
      advanceAppearanceAnimationClock(Date.now());
      frames.add(renderEnterBeat('Compacting', 48, 'beat:compact', start, premium).join('\n'));
    }
    expect(frames.size).toBeGreaterThanOrEqual(4);
  });

  it('renderEnterBeat/renderExitBeat stay single-line when width < 40', () => {
    const start = Date.now();
    for (let t = 0; t <= 720; t += 80) {
      vi.setSystemTime(start + t);
      advanceAppearanceAnimationClock(Date.now());
      expect(renderEnterBeat('Status', 32, 'beat:status', start, premium)).toHaveLength(1);
      expect(renderExitBeat('Done', 32, 'beat:done', start, premium)).toHaveLength(1);
    }
  });

  it('renderSettleFlash returns static bold text when profile is off', () => {
    const off = { ...premium, profile: 'off' as const, particles: 'off' as const };
    const start = Date.now();
    const a = strip(renderSettleFlash('selected', 'settle', start, off));
    vi.setSystemTime(start + 200);
    advanceAppearanceAnimationClock(Date.now());
    const b = strip(renderSettleFlash('selected', 'settle', start, off));
    expect(a).toBe('selected');
    expect(b).toBe('selected');
  });

  it('renderToneSettleFlash is active at t0 and settles to the given tone', () => {
    const start = Date.now();
    const settledSuccess = currentTheme.fg('success', 'done');
    const t0 = renderToneSettleFlash('done', 'tone:t0', start, 'success', premium);
    expect(strip(t0)).toContain('done');
    expect(t0).not.toBe(settledSuccess);

    vi.setSystemTime(start + SETTLE_FLASH_MS + 40);
    advanceAppearanceAnimationClock(Date.now());
    expect(renderToneSettleFlash('done', 'tone:settled', start, 'success', premium)).toBe(
      settledSuccess,
    );
  });

  it('renderToneSettleFlash returns the static tone text when profile is off', () => {
    const off = { ...premium, profile: 'off' as const, particles: 'off' as const };
    const start = Date.now();
    const settledError = currentTheme.fg('error', 'failed');
    expect(renderToneSettleFlash('failed', 'tone:off', start, 'error', off)).toBe(settledError);
    vi.setSystemTime(start + SETTLE_FLASH_MS);
    advanceAppearanceAnimationClock(Date.now());
    expect(renderToneSettleFlash('failed', 'tone:off', start, 'error', off)).toBe(settledError);
  });

  it('renderToneSettleFlash produces ≥4 distinct frames across the flash', () => {
    const frames = new Set<string>();
    const start = Date.now();
    for (let t = 0; t <= SETTLE_FLASH_MS; t += 30) {
      vi.setSystemTime(start + t);
      advanceAppearanceAnimationClock(Date.now());
      frames.add(renderToneSettleFlash('completed', 'tone:frames', start, 'error', premium));
    }
    expect(frames.size).toBeGreaterThanOrEqual(4);
  });

  it('renderStatusFlashLine enters at t0 and exits to static text after the window', () => {
    const start = Date.now();
    const message = 'Warning: disk almost full';
    const staticLine = currentTheme.fg('warning', message);
    const t0 = renderStatusFlashLine(message, 'status:w', start, 'warning', premium);
    expect(strip(t0)).toContain('Warning:');
    expect(t0).not.toBe(staticLine);
    expect(isStatusFlashActive(start, premium, start)).toBe(true);

    vi.setSystemTime(start + STATUS_FLASH_MS + 40);
    advanceAppearanceAnimationClock(Date.now());
    expect(renderStatusFlashLine(message, 'status:w', start, 'warning', premium)).toBe(staticLine);
    expect(isStatusFlashActive(start, premium, Date.now())).toBe(false);
  });

  it('renderStatusFlashLine is static when profile is off', () => {
    const off = { ...premium, profile: 'off' as const, particles: 'off' as const };
    const start = Date.now();
    const staticLine = currentTheme.fg('error', 'Error: boom');
    expect(statusFlashDurationMs(off)).toBe(0);
    expect(renderStatusFlashLine('Error: boom', 'status:e', start, 'error', off)).toBe(staticLine);
  });

  it('renderStatusFlashLine cycles ≥4 distinct frames across enter + exit', () => {
    const frames = new Set<string>();
    const start = Date.now();
    for (let t = 0; t <= STATUS_FLASH_MS; t += 80) {
      vi.setSystemTime(start + t);
      advanceAppearanceAnimationClock(Date.now());
      frames.add(renderStatusFlashLine('Saved', 'status:frames', start, 'success', premium));
    }
    expect(frames.size).toBeGreaterThanOrEqual(4);
  });

  it('renderPhaseChip distinguishes running vs done (plain text)', () => {
    const run = strip(renderPhaseChip('mcp__x', 'running', 'chip', premium));
    const done = strip(renderPhaseChip('mcp__x', 'done', 'chip', premium));
    expect(run).toContain('mcp__x');
    expect(done).toContain('mcp__x');
    expect(run).not.toBe(done);
  });

  it('renderAmbientDrift is width-stable and non-empty under premium', () => {
    const line = renderAmbientDrift(40, 'drift:think', premium);
    expect(visibleWidth(line)).toBe(40);
    expect(strip(line).trim().length).toBeGreaterThan(0);
  });

  it('renderDangerBreathe pulses token under premium and is static under off', () => {
    const off = { ...premium, profile: 'off' as const, particles: 'off' as const };
    expect(strip(renderDangerBreathe('rm -rf', 'danger', off))).toBe('rm -rf');
    advanceAppearanceAnimationClock(0);
    const a = renderDangerBreathe('rm -rf', 'danger', premium);
    advanceAppearanceAnimationClock(300);
    const b = renderDangerBreathe('rm -rf', 'danger', premium);
    expect(strip(a)).toBe('rm -rf');
    expect(strip(b)).toBe('rm -rf');
    expect(a).not.toBe(b);
  });

  it('renderCrossfadeLine reaches toText after CROSSFADE window', () => {
    const start = Date.now();
    vi.setSystemTime(start + 800);
    advanceAppearanceAnimationClock(Date.now());
    expect(strip(renderCrossfadeLine('old tip', 'new tip', 'tip', start, premium))).toBe('new tip');
  });

  it('renderTypewriterLine is static full text when motion is off', () => {
    const off = { ...premium, profile: 'off' as const, particles: 'off' as const };
    const plain = 'Use /feed to drop food into the idle aquarium';
    expect(strip(renderTypewriterLine(plain, Date.now(), off))).toBe(plain);
  });

  it('renderTypewriterLine reveals the full text after the TYPEWRITER window', () => {
    const plain = 'Use /feed to drop food into the idle aquarium';
    const start = Date.now();
    vi.setSystemTime(start + TYPEWRITER_MS + 100);
    advanceAppearanceAnimationClock(Date.now());
    expect(strip(renderTypewriterLine(plain, start, premium))).toBe(plain);
  });

  it('renderTypewriterLine shows a partial prefix while typing', () => {
    const plain = 'Use /feed to drop food into the idle aquarium';
    const start = Date.now();
    vi.setSystemTime(start + 300);
    advanceAppearanceAnimationClock(Date.now());
    const out = strip(renderTypewriterLine(plain, start, premium));
    expect(out.startsWith(plain[0] ?? '')).toBe(true);
    expect(visibleWidth(out)).toBeLessThan(plain.length);
  });

  it('keeps brand motion tokens off shared success/warning/error hues', () => {
    expect(BRAND_MOTION_TOKENS).not.toContain('success');
    expect(BRAND_MOTION_TOKENS).not.toContain('warning');
    expect(BRAND_MOTION_TOKENS).not.toContain('error');
    expect(BRAND_MOTION_TOKENS).toEqual(
      expect.arrayContaining([
        'primary',
        'accent',
        'glow',
        'particle',
        'gradientStart',
        'gradientEnd',
        'roleUser',
        'shellMode',
      ]),
    );
  });

  it('keeps spectacular text on a gentle brand chain without role hue jumps', () => {
    expect(SPECTACULAR_TOKENS).not.toContain('roleUser');
    expect(SPECTACULAR_TOKENS).not.toContain('shellMode');
    expect(SPECTACULAR_TOKENS).not.toContain('success');
    expect(SPECTACULAR_TOKENS).toEqual([
      'gradientStart',
      'primary',
      'glow',
      'accent',
      'particle',
      'gradientEnd',
    ]);
  });


  it('renderExitBeat and done phase chip avoid the shared mint success hex', () => {
    const start = Date.now();
    const exit = renderExitBeat('Done', 40, 'exit:done', start, premium).join('\n');
    const done = renderPhaseChip('tool', 'done', 'chip:done', premium);
    const successRgb = [
      parseInt(darkColors.success.slice(1, 3), 16),
      parseInt(darkColors.success.slice(3, 5), 16),
      parseInt(darkColors.success.slice(5, 7), 16),
    ].join(';');
    // Older motion paths painted these with the shared mint success token.
    expect(exit).not.toContain(`38;2;${successRgb}`);
    expect(done).not.toContain(`38;2;${successRgb}`);
  });
});

describe('premium box frame', () => {
  const previous = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };

  afterEach(() => {
    vi.useRealTimers();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('draws a static rounded frame with uniform rows when motion is off', () => {
    process.env['TERM'] = 'dumb';
    const rows = renderPremiumBoxFrame(['hello', 'world'], { width: 20 });
    expect(strip(rows[0]!)).toMatch(/^╭─+╮$/);
    expect(strip(rows.at(-1)!)).toMatch(/^╰─+╯$/);
    expect(strip(rows[1]!)).toBe('│hello             │');
    for (const row of rows) expect(visibleWidth(row)).toBe(20);
  });

  it('embeds title and live footer text in the borders', () => {
    process.env['TERM'] = 'dumb';
    const rows = renderPremiumBoxFrame(['x'], {
      width: 30,
      title: 'Hub',
      footerLeft: 'filter: mo',
      footerRight: '3/9',
    });
    expect(strip(rows[0]!)).toContain('─ Hub ─');
    const bottom = strip(rows.at(-1)!);
    expect(bottom).toContain('filter: mo');
    expect(bottom).toContain('3/9');
  });

  it('truncates an oversized footer embed instead of breaking the frame', () => {
    process.env['TERM'] = 'dumb';
    const rows = renderPremiumBoxFrame(['x'], {
      width: 16,
      footerLeft: 'filter: a-very-long-query',
    });
    expect(visibleWidth(rows.at(-1)!)).toBe(16);
    expect(strip(rows.at(-1)!)).toMatch(/^╰─.*╯$/);
  });

  it('animates a comet chase around the perimeter under premium motion', () => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const premiumMotion = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    const openedAt = Date.now();
    const first = renderPremiumBoxFrame(['body'], {
      width: 40,
      appearance: premiumMotion,
      openedAtMs: openedAt,
    });
    // The top border carries several distinct hues (breath base + chase head/trail).
    const codes = new Set(first[0]!.match(/\u001B\[[0-9;]*m/g) ?? []);
    expect(codes.size).toBeGreaterThan(2);
    // The chase travels: a later frame differs while geometry stays stable.
    vi.setSystemTime(new Date('2026-07-01T00:00:02Z'));
    advanceAppearanceAnimationClock(Date.now());
    const second = renderPremiumBoxFrame(['body'], {
      width: 40,
      appearance: premiumMotion,
      openedAtMs: openedAt,
    });
    expect(second[0]).not.toBe(first[0]);
    for (const row of second) expect(visibleWidth(row)).toBe(40);
  });
});
