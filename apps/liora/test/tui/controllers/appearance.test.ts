import { visibleWidth, type RendererTerminalHost } from '#/tui/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { AppearanceController, shouldAnimate, terminalMutationAllowed } from '#/tui/controllers/appearance';
import { AnimationScheduler } from '#/tui/controllers/animation-scheduler';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  appearanceAnimationFrameIntervalMs,
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
  getActiveAppearancePreferences,
  renderParticleDivider,
  renderPulseGlyph,
  renderShimmerPrefix,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

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

describe('AnimationScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps render ticks by fps and stops cleanly on dispose', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const scheduler = new AnimationScheduler({
      fps: 10,
      enabled: true,
      requestRender,
    });

    vi.advanceTimersByTime(99);
    expect(requestRender).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestRender).toHaveBeenCalledTimes(1);

    scheduler.update({ enabled: false });
    vi.advanceTimersByTime(300);
    expect(requestRender).toHaveBeenCalledTimes(1);

    scheduler.update({ enabled: true, fps: 30 });
    vi.advanceTimersByTime(34);
    expect(requestRender).toHaveBeenCalledTimes(2);

    scheduler.dispose();
    vi.advanceTimersByTime(100);
    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  it('skips ticks when rendering is gated off', () => {
    vi.useFakeTimers();
    let canRender = false;
    const beforeRender = vi.fn();
    const requestRender = vi.fn();
    const scheduler = new AnimationScheduler({
      fps: 10,
      enabled: true,
      shouldRender: () => canRender,
      beforeRender,
      requestRender,
    });

    vi.advanceTimersByTime(100);
    expect(beforeRender).not.toHaveBeenCalled();
    expect(requestRender).not.toHaveBeenCalled();

    canRender = true;
    vi.advanceTimersByTime(100);
    expect(beforeRender).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });
});

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

  it('paces animation ticks from effect cadence and renderer health', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
      animationFps: 30,
    };
    const terminal = { write: vi.fn() } as unknown as RendererTerminalHost;

    expect(appearanceAnimationFrameIntervalMs(appearance, 'full', 'healthy')).toBe(160);
    expect(appearanceAnimationFrameIntervalMs(appearance, 'full', 'watch')).toBe(420);
    expect(appearanceAnimationFrameIntervalMs(appearance, 'full', 'degraded')).toBe(420);

    setAppearanceRenderHealth('watch');
    const controller = new AppearanceController({
      terminal,
      requestRender,
      getAppearance: () => appearance,
      shouldRenderAnimation: () => true,
    });

    vi.advanceTimersByTime(419);
    expect(requestRender).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestRender).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('publishes active appearance for shared chrome components', () => {
    const terminal = { write: vi.fn() } as unknown as RendererTerminalHost;
    const controller = new AppearanceController({
      terminal,
      requestRender: vi.fn(),
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

    advanceAppearanceAnimationClock(180);
    const changed = renderPulseGlyph(['A', 'B'], 'clock-test', 'A', 'primary', appearance);

    expect(strip(unchanged)).toBe(strip(first));
    expect(strip(changed)).not.toBe(strip(first));
  });

  it('falls back to subtle ambient effects at minimal renderer quality', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };

    setAppearanceRenderQuality('balanced');
    expect(getAppearanceRenderQuality()).toBe('balanced');
    expect(strip(renderPulseGlyph(['A', 'B'], 'quality-test', 'A', 'primary', appearance))).toBe('A');
    expect(strip(renderShimmerPrefix(appearance))).toMatch(/[✦✧∙·] /);

    setAppearanceRenderQuality('minimal');
    expect(strip(renderShimmerPrefix(appearance))).toMatch(/[✦✧∙·] /);
    expect(strip(renderParticleDivider(8, 'quality-divider', appearance))).toMatch(/[✦✧∙·]/);
  });

  it('falls back to subtle ambient effects at degraded renderer frame health', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };

    setAppearanceRenderHealth('watch');
    expect(getAppearanceRenderHealth()).toBe('watch');
    expect(strip(renderPulseGlyph(['A', 'B'], 'health-test', 'A', 'primary', appearance))).toBe('A');
    expect(strip(renderShimmerPrefix(appearance))).toMatch(/[✦✧∙·] /);

    setAppearanceRenderHealth('degraded');
    expect(strip(renderShimmerPrefix(appearance))).toMatch(/[✦✧∙·] /);
    expect(strip(renderParticleDivider(8, 'health-divider', appearance))).toMatch(/[✦✧∙·]/);
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
    expect(strip(line)).toMatch(/[✦✧✺∙•]/);
  });
});

function setStdoutTty(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value,
  });
}
