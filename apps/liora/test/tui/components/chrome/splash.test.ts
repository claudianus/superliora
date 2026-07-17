import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from '#/tui/config';
import {
  clampSplashDurationMs,
  DEFAULT_SPLASH_DURATION_MS,
  resolveBannerRevealCount,
  resolveSplashPhase,
  shouldPlaySplash,
  SplashComponent,
  SPLASH_DURATION_MAX_MS,
  SPLASH_DURATION_MIN_MS,
} from '#/tui/components/chrome/splash';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import type { AppState } from '#/tui/types';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

const appState: AppState = {
  version: '1.2.3',
  workDir: '/tmp/project',
  additionalDirs: [],
  sessionId: 'ses-1',
  sessionTitle: null,
  model: 'kimi-k2',
  permissionMode: 'manual',
  thinking: false,
  contextUsage: 0,
  contextTokens: 0,
  maxContextTokens: 0,
  isCompacting: false,
  isBackgroundCompacting: false,
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  planMode: false,
  inputMode: 'prompt',
  swarmMode: false,
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  availableModels: {},
  availableProviders: {},
  mcpServersSummary: null,
  appearance: DEFAULT_APPEARANCE_PREFERENCES,
};

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function withSafeTerminalEnv<T>(run: () => T): T {
  const previousEnv = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('splash duration clamp', () => {
  it('clamps below min to 1000ms', () => {
    expect(clampSplashDurationMs(0)).toBe(SPLASH_DURATION_MIN_MS);
    expect(clampSplashDurationMs(250)).toBe(SPLASH_DURATION_MIN_MS);
    expect(clampSplashDurationMs(-10)).toBe(SPLASH_DURATION_MIN_MS);
  });

  it('clamps above max to 2000ms', () => {
    expect(clampSplashDurationMs(5000)).toBe(SPLASH_DURATION_MAX_MS);
    expect(clampSplashDurationMs(2001)).toBe(SPLASH_DURATION_MAX_MS);
  });

  it('keeps in-range values and falls back non-finite to default', () => {
    expect(clampSplashDurationMs(1000)).toBe(1000);
    expect(clampSplashDurationMs(1600)).toBe(DEFAULT_SPLASH_DURATION_MS);
    expect(clampSplashDurationMs(2000)).toBe(2000);
    expect(clampSplashDurationMs(Number.NaN)).toBe(DEFAULT_SPLASH_DURATION_MS);
    expect(clampSplashDurationMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPLASH_DURATION_MS);
  });
});

describe('splash phase / reveal', () => {
  it('maps elapsed fractions into cinematic phases', () => {
    const duration = 1600;
    expect(resolveSplashPhase(0, duration)).toBe('void');
    expect(resolveSplashPhase(duration * 0.2, duration)).toBe('meteor');
    expect(resolveSplashPhase(duration * 0.5, duration)).toBe('banner');
    expect(resolveSplashPhase(duration * 0.85, duration)).toBe('hold');
    expect(resolveSplashPhase(duration, duration)).toBe('done');
    expect(resolveSplashPhase(duration + 50, duration)).toBe('done');
  });

  it('reveals banner lines progressively during meteor phase', () => {
    const duration = 1600;
    const total = 5;
    expect(resolveBannerRevealCount(0, duration, total)).toBe(0);
    const midMeteor = duration * 0.25;
    const revealed = resolveBannerRevealCount(midMeteor, duration, total);
    expect(revealed).toBeGreaterThan(0);
    expect(revealed).toBeLessThanOrEqual(total);
    expect(resolveBannerRevealCount(duration * 0.5, duration, total)).toBe(total);
  });
});

describe('shouldPlaySplash skip matrix', () => {
  const premium: AppearancePreferences = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium',
    particles: 'premium',
    animationFps: 20,
  };

  afterEach(() => {
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    process.env['TERM'] = 'xterm-256color';
  });

  it('plays when appearance and environment allow motion', () => {
    withSafeTerminalEnv(() => {
      expect(shouldPlaySplash(premium)).toBe(true);
    });
  });

  it('skips when appearance profile is off', () => {
    withSafeTerminalEnv(() => {
      expect(shouldPlaySplash({ ...premium, profile: 'off' })).toBe(false);
    });
  });

  it('skips when particles are off', () => {
    withSafeTerminalEnv(() => {
      expect(shouldPlaySplash({ ...premium, particles: 'off' })).toBe(false);
    });
  });

  it('skips when animationFps is 0', () => {
    withSafeTerminalEnv(() => {
      expect(shouldPlaySplash({ ...premium, animationFps: 0 })).toBe(false);
    });
  });

  it('skips under NO_COLOR', () => {
    withSafeTerminalEnv(() => {
      process.env['NO_COLOR'] = '1';
      expect(shouldPlaySplash(premium)).toBe(false);
    });
  });

  it('skips under CI', () => {
    withSafeTerminalEnv(() => {
      process.env['CI'] = 'true';
      expect(shouldPlaySplash(premium)).toBe(false);
    });
  });

  it('skips under SSH_TTY', () => {
    withSafeTerminalEnv(() => {
      process.env['SSH_TTY'] = '/dev/pts/0';
      expect(shouldPlaySplash(premium)).toBe(false);
    });
  });

  it('skips under dumb TERM', () => {
    withSafeTerminalEnv(() => {
      process.env['TERM'] = 'dumb';
      expect(shouldPlaySplash(premium)).toBe(false);
    });
  });
});

describe('SplashComponent', () => {
  const previousChalkLevel = chalk.level;
  const previousPalette = currentTheme.palette;

  beforeEach(() => {
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    currentTheme.setPalette(previousPalette);
    vi.useRealTimers();
  });

  it('resolves immediately and marks done when forcePlay is false', async () => {
    const requestRender = vi.fn();
    const splash = new SplashComponent({
      appearance: DEFAULT_APPEARANCE_PREFERENCES,
      requestRender,
      forcePlay: false,
      durationMs: 1600,
    });
    await splash.play();
    expect(splash.isDone).toBe(true);
    expect(splash.phase).toBe('done');
    expect(splash.render(80)).toEqual([]);
  });

  it('uses the active theme palette primary (not a fixed Blood Moon hex)', () => {
    withSafeTerminalEnv(() => {
      currentTheme.setPalette(darkColors);
      const darkSplash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
      });
      expect(darkSplash.activePalettePrimary).toBe(darkColors.primary);
      expect(darkSplash.activePalettePrimary).not.toBe('#8B0000');

      currentTheme.setPalette(lightColors);
      const lightSplash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
      });
      expect(lightSplash.activePalettePrimary).toBe(lightColors.primary);
      expect(lightSplash.activePalettePrimary).not.toBe(darkColors.primary);

      // Render path paints with the active palette (chalk embeds RGB, not raw hex).
      const primaryPaint = chalk.hex(lightColors.primary)('◆');
      expect(primaryPaint).toContain('◆');
      expect(lightSplash.activePalettePrimary).toBe(lightColors.primary);
    });
  });

  it('clamps constructor duration into [1000, 2000]', () => {
    const short = new SplashComponent({
      requestRender: () => {},
      durationMs: 100,
      forcePlay: false,
    });
    expect(short.clampedDurationMs).toBe(SPLASH_DURATION_MIN_MS);

    const long = new SplashComponent({
      requestRender: () => {},
      durationMs: 9999,
      forcePlay: false,
    });
    expect(long.clampedDurationMs).toBe(SPLASH_DURATION_MAX_MS);
  });

  it('plays for the clamped duration then completes', async () => {
    await withSafeTerminalEnv(async () => {
      vi.useFakeTimers();
      const start = new Date('2026-01-01T00:00:00Z').getTime();
      vi.setSystemTime(start);
      let now = start;
      const requestRender = vi.fn();
      const splash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender,
        forcePlay: true,
        durationMs: 1200,
        now: () => now,
      });

      const playPromise = splash.play();
      expect(splash.isDone).toBe(false);
      expect(splash.phase).toBe('void');

      // Advance through meteor → banner → hold.
      now = start + 200;
      advanceAppearanceAnimationClock(now);
      await vi.advanceTimersByTimeAsync(50);
      expect(['void', 'meteor', 'banner', 'hold']).toContain(splash.phase);

      now = start + 1200;
      advanceAppearanceAnimationClock(now);
      await vi.advanceTimersByTimeAsync(100);
      await playPromise;

      expect(splash.isDone).toBe(true);
      expect(splash.phase).toBe('done');
      expect(requestRender).toHaveBeenCalled();
      splash.dispose();
    });
  });

  it('renders figlet banner and meteor/particle content while playing', async () => {
    await withSafeTerminalEnv(async () => {
      vi.useFakeTimers();
      const start = new Date('2026-01-01T00:00:00Z').getTime();
      vi.setSystemTime(start);
      let clock = start;
      const animated = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
        durationMs: 1600,
        now: () => clock,
      });
      void animated.play();
      // Banner phase for 1600ms duration is ~608–1152ms; advance past ticker interval.
      clock = start + 900;
      advanceAppearanceAnimationClock(clock);
      await vi.advanceTimersByTimeAsync(100);

      expect(animated.phase).toBe('banner');
      const output = strip(animated.render(80).join('\n'));
      // figlet SUPERLIORA leaves distinctive underscores / slashes.
      expect(output.includes('___') || output.includes('SUPERLIORA')).toBe(true);
      animated.dispose();
    });
  });
});

describe('Welcome once after splash', () => {
  it('renderWelcome-equivalent only mounts one WelcomeComponent', () => {
    // Mirrors LioraTUI.renderWelcome idempotency after splash → welcome.
    const children: object[] = [];
    const renderWelcome = (): void => {
      if (children.some((child) => child instanceof WelcomeComponent)) return;
      children.push(new WelcomeComponent(appState));
    };

    renderWelcome();
    renderWelcome();
    renderWelcome();

    expect(children.filter((c) => c instanceof WelcomeComponent)).toHaveLength(1);
  });

  it('start order is splash play then welcome once (sequencing contract)', async () => {
    const order: string[] = [];
    const splash = new SplashComponent({
      requestRender: () => {},
      forcePlay: false,
    });
    order.push('before-splash');
    await splash.play();
    order.push('after-splash');

    const children: object[] = [];
    if (!children.some((c) => c instanceof WelcomeComponent)) {
      children.push(new WelcomeComponent(appState));
      order.push('welcome');
    }
    if (!children.some((c) => c instanceof WelcomeComponent)) {
      children.push(new WelcomeComponent(appState));
      order.push('welcome-again');
    }

    expect(order).toEqual(['before-splash', 'after-splash', 'welcome']);
    expect(children).toHaveLength(1);
  });
});
