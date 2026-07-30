import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PluginHost } from '../../src/plugin/host';
import { PluginManager } from '../../src/plugin/manager';

async function makeClaudePlugin(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-host-'));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body, 'utf8');
  }
  return realpath(root);
}

describe('PluginHost', () => {
  it('exposes Claude package views for enabled plugins', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'liora-home-'));
    const pluginRoot = await makeClaudePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'demo',
        version: '1.2.0',
        displayName: 'Demo',
      }),
      'skills/hello/SKILL.md': '---\nname: hello\ndescription: Hi\n---\nBody\n',
      'bin/tool.sh': '#!/bin/sh\necho ok\n',
    });

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(pluginRoot);

    const host = new PluginHost(manager);
    const enabled = host.enabledPackages();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({
      id: 'demo',
      scope: 'user',
      enabled: true,
      version: '1.2.0',
      displayName: 'Demo',
      components: expect.objectContaining({
        skills: true,
        bin: true,
        commands: false,
        agents: false,
      }),
    });
    expect(host.binDirs().length).toBe(1);
    expect(host.skillRoots().length).toBeGreaterThan(0);
  });

  it('mirrors manager hooks/mcp for session wiring', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'liora-home-'));
    const pluginRoot = await makeClaudePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'wired' }),
      '.mcp.json': JSON.stringify({
        mcpServers: { data: { command: 'echo', args: ['hi'] } },
      }),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command', command: 'echo start' }],
            },
          ],
        },
      }),
    });

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(pluginRoot);
    const host = new PluginHost(manager);

    expect(Object.keys(host.mcpServers())).toContain('plugin:wired:data');
    expect(host.hooks().some((h) => h.event === 'SessionStart')).toBe(true);
  });
});
