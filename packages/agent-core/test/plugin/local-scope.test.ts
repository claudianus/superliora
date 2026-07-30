import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PluginManager } from '../../src/plugin/manager';
import { writeLocalInstalled } from '../../src/plugin/store';

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('plugin local scope', () => {
  it('loads local overlay over project/user', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'local-scope-home-'));
    const project = await mkdtemp(path.join(tmpdir(), 'local-scope-proj-'));
    tempDirs.push(home, project);

    const localPlugin = path.join(project, 'src', 'local-plug');
    await mkdir(path.join(localPlugin, '.claude-plugin'), { recursive: true });
    await writeFile(
      path.join(localPlugin, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'shared', version: '9.0.0' }),
      'utf8',
    );

    await writeLocalInstalled(project, {
      version: 2,
      plugins: [
        {
          id: 'shared',
          root: localPlugin,
          source: 'local-path',
          enabled: true,
          installedAt: new Date().toISOString(),
          originalSource: localPlugin,
          scope: 'local',
        },
      ],
    });

    const manager = new PluginManager({ kimiHomeDir: home, projectDir: project });
    await manager.load();
    expect(manager.get('shared')?.scope).toBe('local');
    expect(manager.get('shared')?.manifest?.version).toBe('9.0.0');
    await manager.setEnabled('shared', false);
    expect(manager.get('shared')?.enabled).toBe(false);
  });
});
