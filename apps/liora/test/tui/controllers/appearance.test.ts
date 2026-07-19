import { visibleWidth, type RendererTerminalHost } from '#/tui/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { AppearanceController, shouldAnimate, shouldRenderAmbientAnimationFrame, terminalMutationAllowed } from '#/tui/controllers/appearance';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
  getActiveAppearancePreferences,
  renderParticleDivider,
  renderParticleRail,
  renderPulseGlyph,
  renderShimmerPrefix,
  renderSpectacularText,
  resolveQualityAdjustedAmbientEffectMode,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import {
  noteTUIInputInteraction,
  resetTUIInputInteractionForTests,
} from '#/tui/utils/input-interaction';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

const ENV_KEYS = [
  'TERM',
  'CI',
  'NO_COLOR',
  'SSH_TTY',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'TMUX',
] as const;

describe('AppearanceController', () => {
  const originalEnv = { ...process.env };
  let stdoutDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    for (const key of ENV_KEYS) delete process.env[key];
    process.env['TERM'] = 'xterm-256color';
    setStdoutTty(true);
    currentTheme.setCanvasBackgroundEnabled(true);
    advanceAppearanceAnimationClock();
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    setAppearanceRenderHealth('healthy');
    if (stdoutDescriptor === undefined) {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    } else {
      Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor);
    }
    currentTheme.setCanvasBackgroundEnabled(true);
    setAppearanceRenderQuality('full');
  });

  it('enables animation for auto and explicit motion profiles in safe terminals', () => {
    expect(
      shouldAnimate({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
      }),
    ).toBe(true);
    expect(shouldAnimate(DEFAULT_APPEARANCE_PREFERENCES)).toBe(true);
    expect(
      shouldAnimate({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
      }),
    ).toBe(false);

    process.env['SSH_TTY'] = '/dev/pts/1';
    expect(
      shouldAnimate({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
      }),
    ).toBe(false);
  });

  it('keeps ambient animation gating independent of transcript message count', () => {
    resetTUIInputInteractionForTests();
    expect(shouldRenderAmbientAnimationFrame(true, 24)).toBe(true);
    expect(shouldRenderAmbientAnimationFrame(true, 1)).toBe(true);
    expect(shouldRenderAmbientAnimationFrame(false, 24)).toBe(false);
    expect(shouldRenderAmbientAnimationFrame(true, 0)).toBe(false);
    expect(shouldRenderAmbientAnimationFrame(true, Number.NaN)).toBe(false);
  });

  it('suppresses ambient animation for a short window after prompt input', () => {
    resetTUIInputInteractionForTests();
    noteTUIInputInteraction(1_000);
    expect(shouldRenderAmbientAnimationFrame(true, 24, false, { nowMs: 1_050 })).toBe(false);
    expect(shouldRenderAmbientAnimationFrame(true, 24, false, { nowMs: 1_250 })).toBe(true);
  });

  it('blocks terminal palette mutation in unsafe environments', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      terminalBackground: 'session' as const,
    };

    expect(terminalMutationAllowed(appearance)).toBe(true);
    process.env['NO_COLOR'] = '1';
    expect(terminalMutationAllowed(appearance)).toBe(false);
    delete process.env['NO_COLOR'];
    process.env['TMUX'] = '/tmp/tmux';
    expect(terminalMutationAllowed(appearance)).toBe(false);
  });

  it('reapplies OSC palette without scheduling another palette invalidation', () => {
    const writes: string[] = [];
    const terminal = {
      write: (chunk: string) => {
        writes.push(chunk);
      },
    } as RendererTerminalHost;
    const onAppearanceApplied = vi.fn();
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off' as const,
      canvasBackground: false,
      terminalBackground: 'session' as const,
      terminalPalette: true,
    };

    const controller = new AppearanceController({
      terminal,
      requestRender: vi.fn(),
      setAmbientSchedule: vi.fn(),
      getAppearance: () => appearance,
      onAppearanceApplied,
    });
    writes.length = 0;
    onAppearanceApplied.mockClear();

    controller.reapplyTerminalPalette();

    expect(onAppearanceApplied).not.toHaveBeenCalled();
    expect(writes.join('')).toContain('\u001B]11;');
    expect(writes.join('')).toContain('\u001B]4;0;');

    controller.dispose();
  });

  it('applies canvas background and opt-in OSC colors, then resets them on dispose', () => {
    const writes: string[] = [];
    const terminal = {
      write: (chunk: string) => {
        writes.push(chunk);
      },
    } as RendererTerminalHost;

    const controller = new AppearanceController({
      terminal,
      requestRender: vi.fn(),
      setAmbientSchedule: vi.fn(),
      getAppearance: () => ({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        canvasBackground: false,
        terminalBackground: 'session',
        terminalPalette: true,
      }),
    });

    expect(currentTheme.canvasBackgroundEnabled).toBe(false);
    expect(writes.join('')).toContain('\u001B]11;');
    expect(writes.join('')).toContain('\u001B]4;0;');

    controller.dispose();

    expect(writes.at(-1)).toContain('\u001B]111');
    expect(writes.at(-1)).toContain('\u001B]104');
  });

  it('configures renderer ambient schedule at premium interval', () => {
    const setAmbientSchedule = vi.fn();
    const controller = new AppearanceController({
      terminal: { write: vi.fn() } as unknown as RendererTerminalHost,
      requestRender: vi.fn(),
      setAmbientSchedule,
      getAppearance: () => ({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
        animationFps: 30,
      }),
      shouldRenderAnimation: () => true,
    });
    expect(setAmbientSchedule).toHaveBeenCalled();
    const options = setAmbientSchedule.mock.calls.at(-1)?.[0];
    expect(options?.enabled).toBe(true);
    expect(
      options?.resolveIntervalMs({
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    ).toBe(33);
    // animationFps 30 → premium 33ms; soft-degrade is 2× (66ms), not subtle 100ms.
    expect(
      options?.resolveIntervalMs({
        quality: 'full',
        health: 'watch',
        backpressure: false,
      }),
    ).toBe(66);
    // Balanced quality must not pin ambient to the slow subtle cadence.
    expect(
      options?.resolveIntervalMs({
        quality: 'balanced',
        health: 'healthy',
        backpressure: false,
      }),
    ).toBe(33);
    controller.dispose();
    expect(setAmbientSchedule).toHaveBeenLastCalledWith(undefined);
  });

  it('maps animationFps 60 to a 16ms premium ambient interval', () => {
    const setAmbientSchedule = vi.fn();
    const controller = new AppearanceController({
      terminal: { write: vi.fn() } as unknown as RendererTerminalHost,
      requestRender: vi.fn(),
      setAmbientSchedule,
      getAppearance: () => ({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
        animationFps: 60,
      }),
      shouldRenderAnimation: () => true,
    });
    const options = setAmbientSchedule.mock.calls.at(-1)?.[0];
    expect(
      options?.resolveIntervalMs({
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    ).toBe(16);
    controller.dispose();
  });

  it('gates ambient wakes via shouldTick without pausing the interval', () => {
    const setAmbientSchedule = vi.fn();
    let canRender = false;
    let forceAmbient = false;
    const controller = new AppearanceController({
      terminal: { write: vi.fn() } as unknown as RendererTerminalHost,
      requestRender: vi.fn(),
      setAmbientSchedule,
      getAppearance: () => ({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
        animationFps: 30,
      }),
      shouldRenderAnimation: () => canRender,
      forceAmbientSchedule: () => forceAmbient,
    });
    const options = setAmbientSchedule.mock.calls.at(-1)?.[0];
    expect(options?.enabled).toBe(true);
    expect(options?.shouldTick?.()).toBe(false);
    expect(
      options?.resolveIntervalMs({
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    ).toBe(33);
    canRender = true;
    expect(options?.shouldTick?.()).toBe(true);
    canRender = false;
    forceAmbient = true;
    expect(options?.shouldTick?.()).toBe(true);
    expect(
      options?.resolveIntervalMs({
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    ).toBe(33);
    controller.dispose();
  });

  it('publishes active appearance for shared chrome components', () => {
    const terminal = { write: vi.fn() } as unknown as RendererTerminalHost;
    const controller = new AppearanceController({
      terminal,
      requestRender: vi.fn(),
      setAmbientSchedule: vi.fn(),
      getAppearance: () => ({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
      }),
    });

    try {
      expect(getActiveAppearancePreferences().profile).toBe('premium');
      expect(getActiveAppearancePreferences().particles).toBe('premium');
    } finally {
      controller.dispose();
    }
  });

  it('keeps ambient effects stable until the animation clock advances', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:10Z'));
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };

    advanceAppearanceAnimationClock(0);
    const first = renderPulseGlyph(['A', 'B'], 'clock-test', 'A', 'primary', appearance);

    vi.advanceTimersByTime(10_000);
    const unchanged = renderPulseGlyph(['A', 'B'], 'clock-test', 'A', 'primary', appearance);

    advanceAppearanceAnimationClock(280);
    const changed = renderPulseGlyph(['A', 'B'], 'clock-test', 'A', 'primary', appearance);

    expect(strip(unchanged)).toBe(strip(first));
    expect(strip(changed)).not.toBe(strip(first));
  });

  it('keeps premium ambient effects at full quality under renderer pressure', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };

    setAppearanceRenderQuality('balanced');
    expect(getAppearanceRenderQuality()).toBe('balanced');
    expect(resolveQualityAdjustedAmbientEffectMode(appearance, 'balanced', 'healthy')).toBe('premium');
    expect(strip(renderShimmerPrefix(appearance))).toMatch(/[•∙·◦] /);

    setAppearanceRenderQuality('minimal');
    expect(resolveQualityAdjustedAmbientEffectMode(appearance, 'minimal', 'degraded')).toBe('premium');
    expect(strip(renderShimmerPrefix(appearance))).toMatch(/[•∙·◦] /);
    expect(strip(renderParticleDivider(8, 'quality-divider', appearance))).toMatch(/[·∙•◦*]/);
  });

  it('keeps premium ambient effects at full quality under degraded renderer frame health', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };

    setAppearanceRenderHealth('watch');
    expect(getAppearanceRenderHealth()).toBe('watch');
    expect(resolveQualityAdjustedAmbientEffectMode(appearance, 'minimal', 'watch')).toBe('premium');
    expect(strip(renderShimmerPrefix(appearance))).toMatch(/[•∙·◦] /);

    setAppearanceRenderHealth('degraded');
    expect(resolveQualityAdjustedAmbientEffectMode(appearance, 'minimal', 'degraded')).toBe('premium');
    expect(strip(renderShimmerPrefix(appearance))).toMatch(/[•∙·◦] /);
    expect(strip(renderParticleDivider(8, 'health-divider', appearance))).toMatch(/[·∙•◦*]/);
  });

  it('renders premium particle dividers at a stable visible width', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));

    const line = renderParticleDivider(40, 'test-divider', {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });

    expect(visibleWidth(line)).toBe(40);
    expect(strip(line)).toMatch(/[·∙•◦*]/);
  });

  it('cycles spectacular colors across characters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    const rendered = renderSpectacularText('/\\ ABC', 'spectacular-test', appearance, {
      intense: true,
    });
    const codes = new Set(rendered.match(/\u001B\[[0-9;]*m/g) ?? []);
    expect(codes.size).toBeGreaterThan(2);
    expect(strip(rendered)).toContain('/\\ ABC');
  });

  it('paints theme canvas background on spectacular whitespace when canvas background is enabled', () => {
    const previousCanvasBackground = currentTheme.canvasBackgroundEnabled;
    currentTheme.setCanvasBackgroundEnabled(true);
    try {
      const appearance = {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium' as const,
        particles: 'premium' as const,
      };
      const rendered = renderSpectacularText('   A', 'spectacular-space', appearance, {
        intense: true,
      });
      expect(rendered).toContain('48;2;11;15;20');
    } finally {
      currentTheme.setCanvasBackgroundEnabled(previousCanvasBackground);
    }
  });

  it('advances spectacular text colors with the shared animation clock', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    advanceAppearanceAnimationClock(0);
    const first = renderSpectacularText('thinking complete', 'thinking:test', appearance, {
      intense: true,
      pace: 'slow',
    });
    advanceAppearanceAnimationClock(500);
    const second = renderSpectacularText('thinking complete', 'thinking:test', appearance, {
      intense: true,
      pace: 'slow',
    });
    expect(first).not.toBe(second);

    advanceAppearanceAnimationClock(2_000);
    const third = renderSpectacularText(
      'thinking complete',
      'thinking:thinking complete',
      appearance,
      { intense: true, pace: 'slow' },
    );
    advanceAppearanceAnimationClock(0);
    const fourth = renderSpectacularText(
      'thinking complete',
      'thinking:thinking complete',
      appearance,
      { intense: true, pace: 'slow' },
    );
    expect(third).not.toBe(fourth);
  });
});

function setStdoutTty(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value,
  });
}

describe('renderParticleRail soft comets', () => {
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
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps premium rails sparse with soft comet trails', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const line = renderParticleRail(
      48,
      {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
      },
      'rail-soft-comet',
    );
    const plain = strip(line);
    expect(visibleWidth(line)).toBe(48);
    const filled = Array.from(plain).filter((ch) => ch !== ' ').length;
    // Sparse sky: a couple of comets + dust, not a filled marquee.
    expect(filled).toBeGreaterThan(6);
    expect(filled).toBeLessThan(28);
    expect(plain).toMatch(/[·∙•◦*]/);
  });
});
