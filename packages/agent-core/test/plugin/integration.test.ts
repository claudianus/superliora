import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PluginManager } from '../../src/plugin/manager';

async function makePlugin(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-plugin-'));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body, 'utf8');
  }
  return realpath(root);
}

describe('PluginManager → SkillRegistry integration', () => {
  it('enabled plugin contributes to pluginSkillRoots()', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
    const pluginRoot = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
      'skills/demo-skill/SKILL.md': '---\nname: demo-skill\ndescription: demo\n---\nbody',
    });
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(pluginRoot);
    const cachedRoot = await realpath(path.join(home, 'plugins', 'cache', 'demo', '1.0.0'));

    expect(manager.pluginSkillRoots()).toContainEqual({
      path: path.join(cachedRoot, 'skills'),
      source: 'extra',
      plugin: { id: 'demo' },
    });
  });
});
