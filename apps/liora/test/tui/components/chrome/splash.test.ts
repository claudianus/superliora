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
  resolveFadeAlpha,
  resolveMoonRiseProgress,
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

  it('clamps above max to 3200ms', () => {
    expect(clampSplashDurationMs(5000)).toBe(SPLASH_DURATION_MAX_MS);
    expect(clampSplashDurationMs(3201)).toBe(SPLASH_DURATION_MAX_MS);
  });

  it('keeps in-range values and falls back non-finite to default', () => {
    expect(clampSplashDurationMs(1000)).toBe(1000);
    expect(clampSplashDurationMs(2400)).toBe(DEFAULT_SPLASH_DURATION_MS);
    expect(clampSplashDurationMs(2000)).toBe(2000);
    expect(clampSplashDurationMs(3200)).toBe(3200);
    expect(clampSplashDurationMs(Number.NaN)).toBe(DEFAULT_SPLASH_DURATION_MS);
    expect(clampSplashDurationMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPLASH_DURATION_MS);
  });
});

describe('splash phase / reveal', () => {
  const duration = 1000;

  it('maps elapsed fractions into cinematic phases', () => {
    expect(resolveSplashPhase(0, duration)).toBe('void');
    expect(resolveSplashPhase(50, duration)).toBe('void');
    expect(resolveSplashPhase(150, duration)).toBe('rise');
    expect(resolveSplashPhase(350, duration)).toBe('bloom');
    expect(resolveSplashPhase(550, duration)).toBe('brand');
    expect(resolveSplashPhase(800, duration)).toBe('hold');
    expect(resolveSplashPhase(950, duration)).toBe('fade');
    expect(resolveSplashPhase(1000, duration)).toBe('done');
  });

  it('reveals banner lines only during brand+ phases', () => {
    expect(resolveBannerRevealCount(50, duration, 5)).toBe(0);
    expect(resolveBannerRevealCount(200, duration, 5)).toBe(0);
    expect(resolveBannerRevealCount(400, duration, 5)).toBe(0);
    const midBrand = resolveBannerRevealCount(600, duration, 5);
    expect(midBrand).toBeGreaterThan(0);
    expect(midBrand).toBeLessThanOrEqual(5);
    expect(resolveBannerRevealCount(850, duration, 5)).toBe(5);
  });

  it('progresses moon rise and fade alpha', () => {
    expect(resolveMoonRiseProgress(0, duration)).toBe(0);
    expect(resolveMoonRiseProgress(290, duration)).toBeGreaterThan(0);
    expect(resolveMoonRiseProgress(290, duration)).toBeLessThan(1);
    expect(resolveMoonRiseProgress(480, duration)).toBe(1);
    expect(resolveFadeAlpha(100, duration)).toBe(1);
    expect(resolveFadeAlpha(950, duration)).toBeLessThan(1);
    expect(resolveFadeAlpha(1000, duration)).toBe(0);
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

describe('SplashComponent full-screen cinematic', () => {
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
      getRows: () => 24,
    });
    await splash.play();
    expect(splash.isDone).toBe(true);
    expect(splash.phase).toBe('done');
    splash.dispose();
  });

  it('uses the active theme palette primary (not a fixed Blood Moon hex)', () => {
    withSafeTerminalEnv(() => {
      currentTheme.setPalette(darkColors);
      const darkSplash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
        getRows: () => 24,
      });
      expect(darkSplash.activePalettePrimary).toBe(darkColors.primary);
      expect(darkSplash.activePalettePrimary).not.toBe('#8B0000');

      currentTheme.setPalette(lightColors);
      const lightSplash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
        getRows: () => 24,
      });
      expect(lightSplash.activePalettePrimary).toBe(lightColors.primary);
      expect(lightSplash.activePalettePrimary).not.toBe(darkColors.primary);
    });
  });

  it('clamps constructor duration into [1000, 3200]', () => {
    const short = new SplashComponent({
      requestRender: () => {},
      durationMs: 100,
      forcePlay: false,
      getRows: () => 20,
    });
    expect(short.clampedDurationMs).toBe(SPLASH_DURATION_MIN_MS);

    const long = new SplashComponent({
      requestRender: () => {},
      durationMs: 9999,
      forcePlay: false,
      getRows: () => 20,
    });
    expect(long.clampedDurationMs).toBe(SPLASH_DURATION_MAX_MS);
  });

  it('renders exactly getRows() lines (full terminal height)', () => {
    withSafeTerminalEnv(() => {
      const rows = 32;
      const splash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
        durationMs: 1600,
        now: () => 1_000_000,
        getRows: () => rows,
      });
      expect(splash.render(80)).toHaveLength(rows);
      splash.dispose();
    });
  });

  it('plays for the clamped duration then completes via render ticks', async () => {
    await withSafeTerminalEnv(async () => {
      const start = 1_000_000;
      let now = start;
      const requestRender = vi.fn();
      const splash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender,
        forcePlay: true,
        durationMs: 1200,
        now: () => now,
        getRows: () => 24,
      });

      const playPromise = splash.play();
      expect(splash.isDone).toBe(false);
      expect(splash.phase).toBe('void');
      expect(requestRender).toHaveBeenCalled();

      now = start + 200;
      splash.render(80);
      expect(['void', 'rise', 'bloom', 'brand', 'hold', 'fade']).toContain(splash.phase);

      now = start + 1200;
      splash.render(80);
      await playPromise;

      expect(splash.isDone).toBe(true);
      expect(splash.phase).toBe('done');
      splash.dispose();
    });
  });

  it('advances phases from wall clock, not the frozen appearance animation clock', async () => {
    await withSafeTerminalEnv(async () => {
      const start = 1_000_000;
      let now = start;
      // Leave the ambient clock stuck at a stale value to prove splash elapsed ignores it.
      advanceAppearanceAnimationClock(12);
      const splash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
        durationMs: 1000,
        now: () => now,
        getRows: () => 24,
      });
      const playPromise = splash.play();
      expect(splash.phase).toBe('void');

      now = start + 200;
      splash.render(80);
      expect(splash.phase).toBe('rise');
      expect(splash.elapsedMs).toBe(200);

      now = start + 1000;
      splash.render(80);
      await playPromise;
      expect(splash.isDone).toBe(true);
      splash.dispose();
    });
  });

  it('paints moon during rise and brand figlet on full-height canvas', async () => {
    await withSafeTerminalEnv(async () => {
      const start = 1_000_000;
      let clock = start;
      const splash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
        durationMs: 1000,
        now: () => clock,
        getRows: () => 30,
      });
      void splash.play();

      clock = start + 180;
      expect(splash.phase).toBe('rise');
      const riseOut = strip(splash.render(72).join('\n'));
      expect(riseOut).toMatch(/█/);
      expect(splash.render(72)).toHaveLength(30);

      // hold phase: full banner reveal + tagline
      clock = start + 800;
      expect(splash.phase).toBe('hold');
      const holdFrame = splash.render(80);
      expect(holdFrame).toHaveLength(30);
      const holdOut = strip(holdFrame.join('\n'));
      // Figlet banner is dense block art; require substantial non-space density
      // plus the spectacular tagline which spells SUPERLIORA.
      expect(holdOut.replaceAll(/\s/g, '').length).toBeGreaterThan(80);
      expect(holdOut.toUpperCase()).toContain('SUPERLIORA');

      splash.dispose();
    });
  });

  it('notifies host when splash forces ambient on and off', async () => {
    await withSafeTerminalEnv(async () => {
      const start = 1_000_000;
      let now = start;
      const onSplashActiveChange = vi.fn();
      const splash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
        durationMs: 1000,
        now: () => now,
        getRows: () => 24,
        onSplashActiveChange,
      });

      const playPromise = splash.play();
      expect(onSplashActiveChange).toHaveBeenCalledWith(true);

      now = start + 1000;
      splash.render(80);
      await playPromise;

      expect(onSplashActiveChange).toHaveBeenCalledWith(false);
      expect(onSplashActiveChange).toHaveBeenCalledTimes(2);
      splash.dispose();
    });
  });

  it('dispose resolves an in-flight play and clears ambient force', async () => {
    await withSafeTerminalEnv(async () => {
      const onSplashActiveChange = vi.fn();
      const splash = new SplashComponent({
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        requestRender: () => {},
        forcePlay: true,
        durationMs: 2000,
        now: () => Date.now(),
        getRows: () => 20,
        onSplashActiveChange,
      });
      const playPromise = splash.play();
      expect(onSplashActiveChange).toHaveBeenCalledWith(true);
      splash.dispose();
      await expect(playPromise).resolves.toBeUndefined();
      expect(splash.isDone).toBe(true);
      expect(onSplashActiveChange).toHaveBeenLastCalledWith(false);
    });
  });
});

describe('Welcome once after splash', () => {
  it('WelcomeComponent remains constructible independently', () => {
    const welcome = new WelcomeComponent(appState);
    const lines = welcome.render(80);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('start order is splash play then welcome once (sequencing contract)', async () => {
    const order: string[] = [];
    const splash = new SplashComponent({
      requestRender: () => {},
      forcePlay: false,
      getRows: () => 20,
    });
    order.push('splash-start');
    await splash.play();
    order.push('splash-done');
    const welcome = new WelcomeComponent(appState);
    welcome.render(40);
    order.push('welcome');
    expect(order).toEqual(['splash-start', 'splash-done', 'welcome']);
  });
});
