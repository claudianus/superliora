import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PluginHost } from '../../src/plugin/host';
import { PluginManager } from '../../src/plugin/manager';
import { loadPluginChannels } from '../../src/plugin/channels';
import { loadPluginWorkflows } from '../../src/plugin/workflows';
import type { PluginDiagnostic } from '../../src/plugin/types';

describe('plugin channels + workflows hosts', () => {
  it('validates channel servers against mcp names', async () => {
    const diagnostics: PluginDiagnostic[] = [];
    const channels = await loadPluginChannels({
      channelsPath: '/tmp',
      inline: [{ server: 'chat' }, { server: 'missing' }],
      mcpServerNames: new Set(['chat']),
      diagnostics,
    });
    expect(channels.map((c) => c.server)).toEqual(['chat', 'missing']);
    expect(diagnostics.some((d) => d.message.includes('missing'))).toBe(true);
  });

  it('loads markdown workflows as commands and notes JS scripts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'workflows-'));
    await writeFile(path.join(dir, 'ship.md'), '---\nname: ship\n---\nShip it\n', 'utf8');
    await writeFile(path.join(dir, 'orchestrate.js'), 'export default {}\n', 'utf8');

    const loaded = await loadPluginWorkflows({ pluginId: 'demo', workflowsDir: dir });
    expect(loaded.commands.some((c) => c.name === 'workflow:ship')).toBe(true);
    expect(loaded.scriptNames).toContain('orchestrate');
    expect(loaded.scriptPaths.some((p) => p.name === 'orchestrate')).toBe(true);
  });

  it('surfaces channels through PluginHost', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'liora-home-'));
    const pluginRoot = await mkdtemp(path.join(tmpdir(), 'claude-channels-'));
    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(
      path.join(pluginRoot, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'relay',
        channels: [{ server: 'inbox' }],
      }),
      'utf8',
    );
    await writeFile(
      path.join(pluginRoot, '.mcp.json'),
      JSON.stringify({
        mcpServers: { inbox: { command: 'echo', args: ['hi'] } },
      }),
      'utf8',
    );

    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(pluginRoot);
    const host = new PluginHost(manager);
    expect(host.channels()).toEqual([
      { pluginId: 'relay', channels: [{ server: 'inbox', userConfig: undefined }] },
    ]);
  });
});
