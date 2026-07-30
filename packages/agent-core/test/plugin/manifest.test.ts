import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseManifest } from '../../src/plugin/manifest';

async function makePlugin(
  files: Record<string, string>,
  options: { dirs?: readonly string[] } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-plugin-test-'));
  for (const dir of options.dirs ?? []) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body, 'utf8');
  }
  return realpath(root);
}

describe('parseManifest (Claude Code format)', () => {
  it('reads .claude-plugin/plugin.json', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        displayName: 'Demo Plugin',
      }),
    });
    const result = await parseManifest(root);
    expect(result.manifest?.name).toBe('demo');
    expect(result.manifest?.version).toBe('1.0.0');
    expect(result.manifest?.displayName).toBe('Demo Plugin');
    expect(result.manifestKind).toBe('claude-plugin');
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('autodiscovers without a manifest from skills/ and directory name', async () => {
    const root = await makePlugin(
      {
        'skills/hello/SKILL.md': '---\nname: hello\ndescription: Hi\n---\nHello\n',
      },
      { dirs: ['skills/hello'] },
    );
    const result = await parseManifest(root);
    expect(result.manifestKind).toBe('claude-autodiscover');
    expect(result.manifest?.skills).toEqual([path.join(root, 'skills')]);
    expect(result.manifest?.name).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
  });

  it('rejects legacy kimi.plugin.json', async () => {
    const root = await makePlugin({
      'kimi.plugin.json': JSON.stringify({ name: 'legacy' }),
    });
    const result = await parseManifest(root);
    expect(result.manifest).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('Legacy kimi.plugin.json'),
      }),
    );
  });

  it('loads nested hooks from hooks/hooks.json with CLAUDE_PLUGIN_ROOT expand', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'hooky' }),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                {
                  type: 'command',
                  command: '"${CLAUDE_PLUGIN_ROOT}/scripts/check.sh"',
                },
                {
                  type: 'http',
                  url: '${CLAUDE_PLUGIN_ROOT}/hooks/endpoint',
                },
                {
                  type: 'mcp_tool',
                  server: 'audit',
                  tool: 'check',
                },
              ],
            },
          ],
        },
      }),
      'scripts/check.sh': '#!/bin/sh\nexit 0\n',
    });
    const result = await parseManifest(root);
    expect(result.manifest?.hooks).toHaveLength(3);
    expect(result.manifest?.hooks[0]).toMatchObject({
      event: 'PreToolUse',
      type: 'command',
      command: `"${root}/scripts/check.sh"`,
    });
    expect(result.manifest?.hooks[1]).toMatchObject({
      type: 'http',
      url: `${root}/hooks/endpoint`,
    });
    expect(result.manifest?.hooks[2]).toMatchObject({
      type: 'mcp_tool',
      server: 'audit',
      tool: 'check',
    });
  });

  it('loads .mcp.json and expands placeholders', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'mcp-demo' }),
      '.mcp.json': JSON.stringify({
        mcpServers: {
          data: {
            command: 'node',
            args: ['${CLAUDE_PLUGIN_ROOT}/bin/server.mjs'],
            cwd: '${CLAUDE_PLUGIN_ROOT}',
          },
        },
      }),
      'bin/server.mjs': 'console.log("ok")\n',
    });
    const result = await parseManifest(root);
    expect(result.manifest?.mcpServers?.['data']).toMatchObject({
      command: 'node',
      args: [`${root}/bin/server.mjs`],
      cwd: root,
    });
  });

  it('discovers agents/*.md', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'with-agents' }),
      'agents/reviewer.md':
        '---\nname: reviewer\ndescription: Reviews code\n---\nBe thorough.\n',
    });
    const result = await parseManifest(root);
    expect(result.manifest?.agents).toHaveLength(1);
    expect(result.manifest?.agents[0]?.name).toBe('reviewer');
  });

  it('discovers commands/*.md', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'with-cmds' }),
      'commands/ship.md': '---\nname: ship\ndescription: Ship it\n---\nShip $ARGUMENTS\n',
    });
    const result = await parseManifest(root);
    expect(result.manifest?.commands).toHaveLength(1);
    expect(result.manifest?.commands[0]?.name).toBe('ship');
  });

  it('discovers Claude extras with info diagnostics until hosts land', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'extras',
        experimental: { monitors: true },
        dependencies: { 'other-plugin': '^1.0.0' },
      }),
      'settings.json': '{}\n',
      'themes/dark.json': '{}\n',
      '.lsp.json': '{}\n',
      'workflows/ship.md': '# ship\n',
    });
    const result = await parseManifest(root);
    expect(result.manifest?.settingsPath).toBeDefined();
    expect(result.manifest?.themesDir).toBeDefined();
    expect(result.manifest?.lspServersPath).toBeDefined();
    expect(result.manifest?.workflowsDir).toBeDefined();
    expect(result.manifest?.dependencies).toEqual({ 'other-plugin': '^1.0.0' });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        message: expect.stringContaining('experimental'),
      }),
    );
  });

  it('loads monitors and userConfig from Claude layout', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'watchy',
        userConfig: {
          region: { type: 'string', default: 'us' },
        },
      }),
      'monitors/monitors.json': JSON.stringify([
        {
          name: 'tick',
          command: 'echo ${CLAUDE_PLUGIN_ROOT}/ok',
          description: 'ticks',
        },
      ]),
    });
    const result = await parseManifest(root);
    expect(result.manifest?.monitors).toHaveLength(1);
    expect(result.manifest?.monitors[0]).toMatchObject({
      name: 'tick',
      command: `echo ${root}/ok`,
    });
    expect(result.manifest?.userConfig?.['region']).toMatchObject({
      type: 'string',
      default: 'us',
    });
  });

  it('rejects skills paths that escape the plugin root via symlink', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'escape',
        skills: './link',
      }),
    });
    const outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
    await symlink(outside, path.join(root, 'link'));
    const result = await parseManifest(root);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('outside the plugin'),
      }),
    );
  });

  it('falls back to root SKILL.md when skills/ is absent', async () => {
    const root = await makePlugin({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'root-skill' }),
      'SKILL.md': '---\nname: root-skill\ndescription: Root\n---\nBody\n',
    });
    const result = await parseManifest(root);
    expect(result.manifest?.skills).toEqual([root]);
  });
});
