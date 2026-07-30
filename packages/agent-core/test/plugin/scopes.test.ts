import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PluginManager } from '../../src/plugin/manager';
import { readInstalled, writeProjectInstalled } from '../../src/plugin/store';

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'plugin-scope-home-'));
  tempDirs.push(dir);
  return dir;
}

async function writePlugin(root: string, name: string): Promise<void> {
  await mkdir(path.join(root, '.claude-plugin'), { recursive: true });
  await writeFile(
    path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0' }),
    'utf8',
  );
}

describe('plugin scopes', () => {
  it('merges project installed over user and keeps session ephemeral', async () => {
    const home = await makeHome();
    const project = await mkdtemp(path.join(tmpdir(), 'plugin-scope-proj-'));
    tempDirs.push(project);

    const userPlugin = path.join(home, 'src', 'user-plug');
    const projectPlugin = path.join(project, 'src', 'proj-plug');
    const sessionPlugin = path.join(project, 'src', 'sess-plug');
    await writePlugin(userPlugin, 'shared');
    await writePlugin(projectPlugin, 'shared');
    await writePlugin(sessionPlugin, 'session-only');

    const managerUser = new PluginManager({ kimiHomeDir: home, projectDir: project });
    await managerUser.load();
    await managerUser.install(userPlugin);
    expect(managerUser.get('shared')?.scope).toBe('user');

    await writeProjectInstalled(project, {
      version: 2,
      plugins: [
        {
          id: 'shared',
          root: projectPlugin,
          source: 'local-path',
          enabled: true,
          installedAt: new Date().toISOString(),
          originalSource: projectPlugin,
          scope: 'project',
        },
      ],
    });

    const manager = new PluginManager({
      kimiHomeDir: home,
      projectDir: project,
      sessionPluginDirs: [sessionPlugin],
    });
    await manager.load();

    expect(manager.get('shared')?.scope).toBe('project');
    expect(manager.get('shared')?.root).toBe(await realpath(projectPlugin));
    expect(manager.get('session-only')?.scope).toBe('session');
    expect(manager.get('session-only')?.enabled).toBe(true);

    await expect(manager.setEnabled('session-only', false)).rejects.toThrow(/session-scoped/);

    const extra = path.join(home, 'src', 'extra');
    await writePlugin(extra, 'extra');
    await manager.install(extra);
    const userFile = await readInstalled(home);
    expect(userFile.plugins.every((p) => p.id !== 'session-only')).toBe(true);
    expect(userFile.plugins.some((p) => p.id === 'extra')).toBe(true);
    expect(userFile.plugins.every((p) => (p.scope ?? 'user') === 'user')).toBe(true);
  });
});
