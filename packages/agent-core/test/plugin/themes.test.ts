import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PluginHost } from '../../src/plugin/host';
import { PluginManager } from '../../src/plugin/manager';
import { loadPluginThemes, pluginThemeId } from '../../src/plugin/themes';

describe('plugin themes', () => {
  it('loads Claude overrides and SuperLiora colors', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'plugin-themes-'));
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'dracula.json'),
      JSON.stringify({
        name: 'Dracula',
        base: 'dark',
        overrides: { claude: '#bd93f9', error: '#ff5555' },
      }),
      'utf8',
    );
    await writeFile(
      path.join(dir, 'native.json'),
      JSON.stringify({
        name: 'Native',
        base: 'light',
        colors: { primary: '#112233' },
      }),
      'utf8',
    );

    const themes = await loadPluginThemes({ pluginId: 'skin', themesDir: dir });
    expect(themes).toHaveLength(2);
    expect(themes[0]).toMatchObject({
      id: pluginThemeId('skin', 'dracula'),
      displayName: 'Dracula',
      base: 'dark',
      colors: { claude: '#bd93f9', error: '#ff5555' },
    });
    expect(themes[1]?.colors).toEqual({ primary: '#112233' });
  });

  it('exposes themes through PluginHost for enabled packages', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'liora-home-'));
    const pluginRoot = await mkdtemp(path.join(tmpdir(), 'claude-theme-plugin-'));
    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await mkdir(path.join(pluginRoot, 'themes'), { recursive: true });
    await writeFile(
      path.join(pluginRoot, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'skinpack' }),
      'utf8',
    );
    await writeFile(
      path.join(pluginRoot, 'themes/neon.json'),
      JSON.stringify({ name: 'Neon', base: 'dark', overrides: { success: '#00ff88' } }),
      'utf8',
    );

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(pluginRoot);
    const host = new PluginHost(manager);
    const themes = await host.themes();
    expect(themes).toEqual([
      expect.objectContaining({
        id: 'plugin-skinpack-neon',
        pluginId: 'skinpack',
        displayName: 'Neon',
      }),
    ]);
  });
});
