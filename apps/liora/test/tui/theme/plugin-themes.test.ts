import { afterEach, describe, expect, it } from 'vitest';

import {
  getPluginThemeCatalog,
  listAvailableThemeEntriesSync,
  loadCustomThemeMergedSync,
  setPluginThemeCatalog,
} from '#/tui/theme/custom-theme-loader';
import { applyPluginThemeCatalog } from '#/tui/theme/plugin-themes';
import { darkColors } from '#/tui/theme/colors';

afterEach(() => {
  setPluginThemeCatalog([]);
});

describe('plugin theme catalog', () => {
  it('maps Claude aliases into the SuperLiora palette and lists them', () => {
    applyPluginThemeCatalog([
      {
        id: 'plugin-demo-dracula',
        pluginId: 'demo',
        slug: 'dracula',
        displayName: 'Dracula',
        path: '/tmp/dracula.json',
        base: 'dark',
        colors: { claude: '#bd93f9', error: '#ff5555', primary: '#111111' },
      },
    ]);

    expect(getPluginThemeCatalog()).toHaveLength(1);
    const entries = listAvailableThemeEntriesSync();
    expect(entries.some((e) => e.source === 'plugin' && e.name === 'plugin-demo-dracula')).toBe(
      true,
    );

    const palette = loadCustomThemeMergedSync('plugin-demo-dracula');
    expect(palette?.primary).toBe('#111111');
    expect(palette?.error).toBe('#ff5555');
    // claude alias fills primary only when primary is absent; primary wins here
    expect(palette?.text).toBe(darkColors.text);
  });

  it('prefers Claude claude→primary when primary is absent', () => {
    applyPluginThemeCatalog([
      {
        id: 'plugin-demo-soft',
        pluginId: 'demo',
        slug: 'soft',
        displayName: 'Soft',
        path: '/tmp/soft.json',
        base: 'dark',
        colors: { claude: '#bd93f9' },
      },
    ]);
    expect(loadCustomThemeMergedSync('plugin-demo-soft')?.primary).toBe('#bd93f9');
  });
});
