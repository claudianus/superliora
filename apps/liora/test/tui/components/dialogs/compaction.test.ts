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

  it('streams a dimmed tail preview of the summary and clears it on settle', () => {
    const component = new CompactionComponent();

    try {
      component.setPhase('summarizing');
      component.appendSummaryDelta('line0\nline1\nline2\nline3\n');
      component.appendSummaryDelta('line4\nline5\nline6\n');
      const text = component.render(120).map(strip).join('\n');

      // Last SUMMARY_PREVIEW_LINES (5) non-empty lines are previewed.
      expect(text).toContain('  line2');
      expect(text).toContain('  line3');
      expect(text).toContain('  line4');
      expect(text).toContain('  line5');
      expect(text).toContain('  line6');
      expect(text).not.toContain('line0');
      expect(text).not.toContain('line1');

      component.markDone(1000, 500);
      const settled = component.render(120).map(strip).join('\n');
      expect(settled).not.toContain('line6');
    } finally {
      component.dispose();
    }
  });

  it('shows stream kind, block index, and char count in the progress label', () => {
    const component = new CompactionComponent();

    try {
      component.setPhase('summarizing');
      component.setStreamMeta({ streamKind: 'block', blockIndex: 2, blockCount: 4 });
      component.appendSummaryDelta('alpha beta gamma');
      const text = component.render(120).map(strip).join('\n');

      expect(text).toContain('block 2/4');
      expect(text).toMatch(/chars/);
      expect(text).toContain('alpha beta gamma');
    } finally {
      component.dispose();
    }
  });

  it('advances the bar from blocksCompleted / blockCount instead of time creep', () => {
    const component = new CompactionComponent();

    try {
      component.setPhase('summarizing');
      // 0/4 completed — still near summarizing base (30%).
      component.setStreamMeta({
        streamKind: 'block',
        blockIndex: 1,
        blockCount: 4,
        blocksCompleted: 0,
      });
      let text = component.render(120).map(strip).join('\n');
      expect(text).toContain('block 0/4');
      expect(text).toContain('30%');

      // Half the blocks done → midpoint of summarizing band (30% → 70%).
      component.setStreamMeta({
        streamKind: 'block',
        blockIndex: 2,
        blockCount: 4,
        blocksCompleted: 2,
      });
      text = component.render(120).map(strip).join('\n');
      expect(text).toContain('block 2/4');
      expect(text).toContain('50%');

      // All blocks done → ceiling of summarizing band (70%).
      component.setStreamMeta({
        streamKind: 'block',
        blockIndex: 4,
        blockCount: 4,
        blocksCompleted: 4,
      });
      text = component.render(120).map(strip).join('\n');
      expect(text).toContain('block 4/4');
      expect(text).toContain('70%');
    } finally {
      component.dispose();
    }
  });

  it('prefers engine fraction over phase base and never rewinds', () => {
    const component = new CompactionComponent();

    try {
      component.setPhase('summarizing');
      component.setStreamMeta({
        streamKind: 'block',
        blockCount: 5,
        blocksCompleted: 3,
        fraction: 0.42,
      });
      let text = component.render(120).map(strip).join('\n');
      expect(text).toContain('42%');

      // Later tick with lower fraction must not rewind the floor.
      component.setStreamMeta({
        streamKind: 'block',
        blockCount: 5,
        blocksCompleted: 2,
        fraction: 0.2,
      });
      text = component.render(120).map(strip).join('\n');
      expect(text).toContain('42%');

      component.setStreamMeta({
        streamKind: 'merge',
        blockCount: 5,
        blocksCompleted: 5,
        fraction: 0.75,
      });
      text = component.render(120).map(strip).join('\n');
      expect(text).toContain('75%');
      expect(text).toContain('merging blocks');
    } finally {
      component.dispose();
    }
  });
});
