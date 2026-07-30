import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PluginManager } from '../../src/plugin/manager';

async function writePlugin(root: string, name: string, deps?: Record<string, string>): Promise<void> {
  await mkdir(path.join(root, '.claude-plugin'), { recursive: true });
  await writeFile(
    path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      ...(deps === undefined ? {} : { dependencies: deps }),
    }),
    'utf8',
  );
}

describe('plugin dependency auto-install', () => {
  it('installs missing marketplace deps when resolver is provided', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'liora-home-'));
    const depRoot = await mkdtemp(path.join(tmpdir(), 'dep-plugin-'));
    const mainRoot = await mkdtemp(path.join(tmpdir(), 'main-plugin-'));
    await writePlugin(depRoot, 'base');
    await writePlugin(mainRoot, 'app', { base: '*' });

    const manager = new PluginManager({
      kimiHomeDir: home,
      resolveMarketplaceSource: async (id) => (id === 'base' ? depRoot : undefined),
    });
    await manager.load();
    await manager.install(mainRoot);

    expect(manager.get('app')).toBeDefined();
    expect(manager.get('base')).toBeDefined();
    expect(manager.get('base')?.enabled).toBe(true);
  });

  it('keeps warn diagnostics when resolver cannot find a dep', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'liora-home-'));
    const mainRoot = await mkdtemp(path.join(tmpdir(), 'main-plugin-'));
    await writePlugin(mainRoot, 'lonely', { ghost: '*' });

    const manager = new PluginManager({
      kimiHomeDir: home,
      resolveMarketplaceSource: async () => undefined,
    });
    await manager.load();
    await manager.install(mainRoot);
    expect(manager.get('lonely')?.diagnostics.some((d) => d.message.includes('ghost'))).toBe(true);
  });
});
