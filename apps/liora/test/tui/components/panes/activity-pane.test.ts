import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RendererRootUI } from '#/tui/renderer';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { MoonLoader } from '#/tui/components/chrome/moon-loader';
import { ActivityPaneComponent } from '#/tui/components/panes/activity-pane';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('ActivityPaneComponent', () => {
  const previousChalkLevel = chalk.level;
  const loaders: MoonLoader[] = [];

  beforeEach(() => {
    chalk.level = 3;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    for (const loader of loaders) loader.stop();
    loaders.length = 0;
  });

  it('renders a particle rail under a composing spinner on ambient terminals', () => {
    const spinner = new MoonLoader(
      { requestRender: vi.fn() } as unknown as RendererRootUI,
      'comet',
      undefined,
      'working...',
    );
    loaders.push(spinner);
    const pane = new ActivityPaneComponent({
      mode: 'composing',
      spinner,
      tip: 'ctrl+s: steer mid-turn',
    });
    const out = strip(pane.render(80).join('\n'));
    expect(out).toContain('working...');
    expect(out).toMatch(/[·∙•◦*]/);
  });

  it('renders a single ambient particle rail while waiting', () => {
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    const pane = new ActivityPaneComponent({
      mode: 'waiting',
      spinner: {
        setTip() {},
        setAvailableWidth() {},
        render: () => ['loading'],
        invalidate() {},
      } as never,
    });
    const lines = pane.render(48).map(strip);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect((lines.at(-1) ?? '').length).toBeGreaterThan(0);
    const particleish = lines.filter((line) => /[·∙•◦*]/.test(line));
    expect(particleish.length).toBe(1);
  });

  it('paints a live turn-status row when resolveStatus is set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:12Z'));
    try {
      const pane = new ActivityPaneComponent({
        mode: 'tool',
        spinner: {
          renderGlyph: () => '◐',
          setTip() {},
          setAvailableWidth() {},
          render: () => ['loading'],
          invalidate() {},
        } as never,
        resolveStatus: () => ({
          phase: 'tool',
          tools: [
            { name: 'Read', running: true },
            { name: 'Read', running: true },
          ],
          startedAt: Date.parse('2026-07-01T00:00:00Z'),
          now: Date.now(),
          contextTokens: 42_000,
          queued: 2,
        }),
      });
      const out = strip(pane.render(80).join('\n'));
      expect(out).toContain('Reading 2 files');
      expect(out).toContain('12s');
      expect(out).toContain('⇣42k');
      expect(out).toContain('2 queued');
      expect(out).not.toContain('[stop]');
    } finally {
      vi.useRealTimers();
    }
  });

  it('paints a dim still-running cue for leftover watchers', () => {
    const pane = new ActivityPaneComponent({
      mode: 'watching',
      resolveStatus: () => ({
        phase: 'watching',
        tools: [],
        startedAt: Date.now(),
        now: Date.now(),
        watchers: { commands: 1, questions: 0, subagents: 2 },
      }),
    });
    const out = strip(pane.render(80).join('\n'));
    expect(out).toContain('1 command · 2 subagents still running');
    expect(out).not.toContain('Waiting');
    expect(out).not.toContain('Thinking');
  });

  it('paints a parked wait as a calm cue without elapsed or tokens', () => {
    const pane = new ActivityPaneComponent({
      mode: 'watching',
      resolveStatus: () => ({
        phase: 'watching',
        tools: [{ name: 'TaskOutput', running: true }],
        startedAt: Date.now() - 12_000,
        now: Date.now(),
        contextTokens: 12_000,
        parked: true,
        watchers: { commands: 1, questions: 0, subagents: 0 },
      }),
    });
    const out = strip(pane.render(80).join('\n'));
    expect(out).toContain('1 command still running · ctrl+s: steer');
    expect(out).not.toContain('Waiting');
    expect(out).not.toContain('12s');
    expect(out).not.toContain('12k');
    expect(out).not.toContain('[stop]');
    expect(out).not.toContain('[↓]');
  });

  it('paints [stop] and [↓] on a busy turn', () => {
    const pane = new ActivityPaneComponent({
      mode: 'tool',
      spinner: {
        renderGlyph: () => '◐',
        setTip() {},
        setAvailableWidth() {},
        render: () => ['loading'],
        invalidate() {},
      } as never,
      resolveStatus: () => ({
        phase: 'tool',
        tools: [{ name: 'Read', running: true }],
        startedAt: Date.now(),
        now: Date.now(),
        showStop: true,
        showBg: true,
      }),
    });
    const out = strip(pane.render(80).join('\n'));
    expect(out).toContain('[stop]');
    expect(out).toContain('[↓]');
  });
});

describe('ActivityPaneComponent thinking ambient', () => {
  beforeEach(() => {
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
  });
  afterEach(() => vi.useRealTimers());

  it('appends ambient drift rail in thinking mode', () => {
    const pane = new ActivityPaneComponent({ mode: 'thinking' });
    const lines = pane.render(48).map(strip);
    expect(lines.length).toBeGreaterThan(0);
    expect((lines.at(-1) ?? '').length).toBeGreaterThan(0);
    expect(lines.some((line) => /[·∙•◦*─]/.test(line))).toBe(true);
  });
});
