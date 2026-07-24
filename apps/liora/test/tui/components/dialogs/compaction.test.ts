import chalk from 'chalk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { CompactionComponent } from '#/tui/components/dialogs/compaction';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

// Force CI mode to disable ambient effects for deterministic rendering.
process.env['CI'] = '1';

const previousEnv = {
  TERM: process.env['TERM'],
  CI: process.env['CI'],
  NO_COLOR: process.env['NO_COLOR'],
};

afterEach(() => {
  currentTheme.setPalette(darkColors);
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.useRealTimers();
});

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function enablePremiumAmbient(): void {
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  setAppearanceRenderHealth('healthy');
  setAppearanceRenderQuality('full');
  setActiveAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium',
    particles: 'premium',
  });
}

describe('CompactionComponent', () => {
  it('renders the custom instruction below the compacting label', () => {
    const component = new CompactionComponent(undefined, 'keep the recent files only');

    try {
      const lines = component.render(120).map(strip);
      const text = lines.join('\n');

      expect(text).toContain('Compacting context...');
      expect(text).toContain('  keep the recent files only');
    } finally {
      component.dispose();
    }
  });

  it('renders a tip suffix while compacting', () => {
    const component = new CompactionComponent(undefined, undefined, 'ctrl+s: steer mid-turn');

    try {
      const lines = component.render(120).map(strip);
      const text = lines.join('\n');

      expect(text).toContain('Compacting context... · Tip: ctrl+s: steer mid-turn');
    } finally {
      component.dispose();
    }
  });

  it('renders the background compaction label', () => {
    const component = new CompactionComponent(undefined, undefined, undefined, {
      background: true,
    });

    try {
      const lines = component.render(120).map(strip);
      const text = lines.join('\n');

      expect(text).toContain('Compacting in background...');
      expect(text).not.toContain('Compacting context...');
    } finally {
      component.dispose();
    }
  });

  it('promotes a background compaction label to blocking', () => {
    const component = new CompactionComponent(undefined, undefined, undefined, {
      background: true,
    });

    try {
      component.promoteToBlocking();
      const text = component.render(120).map(strip).join('\n');
      expect(text).toContain('Compacting context...');
      expect(text).not.toContain('Compacting in background...');
    } finally {
      component.dispose();
    }
  });

  it('does not render a tip after compaction completes', () => {
    const component = new CompactionComponent(undefined, undefined, 'ctrl+s: steer mid-turn');

    try {
      component.markDone(1000, 500);
      const lines = component.render(120).map(strip);
      const text = lines.join('\n');

      expect(text).toContain('Compaction complete');
      expect(text).not.toContain('Tip:');
    } finally {
      component.dispose();
    }
  });

  it('renders a cancelled terminal state', () => {
    const component = new CompactionComponent();

    try {
      component.markCanceled();
      const lines = component.render(120).map(strip);
      const text = lines.join('\n');

      expect(text).toContain('Compaction cancelled');
      expect(text).not.toContain('Compacting context...');
    } finally {
      component.dispose();
    }
  });

  it('renders particle/rail enter-beat content while compacting under premium', () => {
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const component = new CompactionComponent();
    try {
      // Mid enter-beat window so the particle rail is visible.
      advanceAppearanceAnimationClock(Date.now() + 200);
      const lines = component.render(48).map(strip);
      const text = lines.join('\n');
      expect(text).toMatch(/Compacting context/);
      expect(lines.some((line) => /[·∙•◦*]/.test(line))).toBe(true);
    } finally {
      component.dispose();
      vi.useRealTimers();
    }
  });

  it('keeps token delta copy after compaction completes under premium', () => {
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const component = new CompactionComponent();
    try {
      component.markDone(1000, 500);
      // Still inside the exit-beat window — title carries token delta.
      advanceAppearanceAnimationClock(Date.now() + 100);
      const text = component.render(64).map(strip).join('\n');
      expect(text).toContain('Compaction complete');
      expect(text).toContain('1000');
      expect(text).toContain('500');
      expect(text).toMatch(/tokens/);
      expect(text).not.toMatch(/Compacting context/);
    } finally {
      component.dispose();
    }
  });

  it('settles on the completion header with token delta after exit beat', () => {
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const component = new CompactionComponent();
    try {
      component.markDone(1000, 500);
      // Well past EXIT_BEAT_MS (640) — must settle on buildHeader(), not a
      // muted stale compacting label or a never-ending exit/crossfade path.
      advanceAppearanceAnimationClock(Date.now() + 800);
      const text = component.render(64).map(strip).join('\n');
      expect(text).toContain('Compaction complete');
      expect(text).toContain('1000 → 500 tokens');
      expect(text).toMatch(/●/);
      expect(text).not.toMatch(/Compacting context/);
    } finally {
      component.dispose();
    }
  });

  it('repaints the header with the active palette on invalidate', () => {
    // Force truecolor so palette differences surface as ANSI codes even when
    // the test runner has no TTY.
    const previousLevel = chalk.level;
    chalk.level = 3;
    const component = new CompactionComponent();

    try {
      const headerOf = (): string => {
        const line = component.render(120).find((l) => strip(l).includes('Compacting context...'));
        if (line === undefined) throw new Error('header line not found');
        return line;
      };
      const before = headerOf();

      currentTheme.setPalette(lightColors);
      component.invalidate();
      const after = headerOf();

      // Same visible text, different ANSI colour codes.
      expect(strip(after)).toBe(strip(before));
      expect(after).not.toBe(before);
    } finally {
      chalk.level = previousLevel;
      component.dispose();
    }
  });

  it('renders a phase-driven progress bar while compacting', () => {
    const component = new CompactionComponent();

    try {
      const text = component.render(120).map(strip).join('\n');

      expect(text).toContain('12%');
      expect(text).toContain('Preparing');
      expect(text).toMatch(/█/);
      expect(text).toMatch(/░/);
    } finally {
      component.dispose();
    }
  });

  it('advances the progress bar as phases arrive', () => {
    const component = new CompactionComponent();

    try {
      component.setPhase('summarizing');
      let text = component.render(120).map(strip).join('\n');
      expect(text).toContain('30%');
      expect(text).toContain('Summarizing conversation');

      component.setPhase('repairing');
      text = component.render(120).map(strip).join('\n');
      expect(text).toContain('78%');
      expect(text).toContain('Verifying summary');

      component.setPhase('finalizing');
      text = component.render(120).map(strip).join('\n');
      expect(text).toContain('92%');
      expect(text).toContain('Rebuilding context');
    } finally {
      component.dispose();
    }
  });

  it('hides the progress bar once compaction settles', () => {
    const component = new CompactionComponent();

    try {
      component.setPhase('finalizing');
      component.markDone(1000, 500);
      const text = component.render(120).map(strip).join('\n');

      expect(text).toContain('Compaction complete');
      expect(text).not.toContain('Rebuilding context');
      expect(text).not.toMatch(/░/);
    } finally {
      component.dispose();
    }
  });

  it('keeps the progress bar visible under the premium enter beat', () => {
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const component = new CompactionComponent();

    try {
      component.setPhase('summarizing');
      // Mid enter-beat window: the particle rail and the bar coexist.
      advanceAppearanceAnimationClock(Date.now() + 200);
      const text = component.render(64).map(strip).join('\n');

      expect(text).toContain('Summarizing conversation');
      expect(text).toMatch(/█/);
    } finally {
      component.dispose();
      vi.useRealTimers();
    }
  });
});
