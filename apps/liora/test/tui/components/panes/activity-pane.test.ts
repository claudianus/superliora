import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RendererRootUI } from '#/tui/renderer';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { MoonLoader } from '#/tui/components/chrome/moon-loader';
import { ActivityPaneComponent } from '#/tui/components/panes/activity-pane';
import {
  getActiveAppearancePreferences,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

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
    expect(out).toMatch(/[·∙✧✦✺•]/);
  });
});

describe('ActivityPaneComponent ambient rail', () => {
  it('renders one ambient particle rail while waiting', () => {
    setActiveAppearancePreferences({
      ...getActiveAppearancePreferences(),
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
    // spinner line + single particle rail
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect((lines.at(-1) ?? '').length).toBeGreaterThan(0);
    expect(strip(lines.at(-1) ?? '')).toMatch(/[·∙✧✦✺• ]/);
  });
});
