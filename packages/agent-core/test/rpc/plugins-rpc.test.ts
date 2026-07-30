import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LioraCore } from '../../src/rpc/core-impl';

async function writeClaudePlugin(
  pluginRoot: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  await writeFile(
    path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, ...extra }),
    'utf8',
  );
}

async function writeClaudeMcp(
  pluginRoot: string,
  mcpServers: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    path.join(pluginRoot, '.mcp.json'),
    JSON.stringify({ mcpServers }),
    'utf8',
  );
}

describe('LioraCore plugin RPCs', () => {
  it('install → list → setEnabled → remove round trip', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
    const pluginRoot = await mkdtemp(path.join(tmpdir(), 'plugin-'));
    await writeClaudePlugin(pluginRoot, 'demo', { version: '1.0.0' });

    const core = new LioraCore(async () => ({}) as never, { homeDir: home });
    await new Promise((r) => setImmediate(r));

    const installed = await core.installPlugin({ source: pluginRoot });
    expect(installed.id).toBe('demo');
    expect(installed.version).toBe('1.0.0');

    const list = await core.listPlugins({});
    expect(list).toHaveLength(1);

    await core.setPluginEnabled({ id: 'demo', enabled: false });
    const after = await core.listPlugins({});
    expect(after[0]?.enabled).toBe(false);

    await core.removePlugin({ id: 'demo' });
    await expect(core.listPlugins({})).resolves.toEqual([]);
  });

  it('installPlugin ignores forged marketplace context from public RPC callers', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
    const pluginRoot = await mkdtemp(path.join(tmpdir(), 'plugin-'));
    await writeClaudePlugin(pluginRoot, 'demo', { version: '1.0.0' });

    const core = new LioraCore(async () => ({}) as never, { homeDir: home });
    await new Promise((r) => setImmediate(r));

    const installed = await core.installPlugin({
      source: pluginRoot,
      marketplace: { id: 'demo', tier: 'official' },
    } as never);

    expect((installed as { marketplace?: unknown }).marketplace).toBeUndefined();
  });

  it('setPluginMcpServerEnabled toggles plugin MCP state', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
    const pluginRoot = await mkdtemp(path.join(tmpdir(), 'plugin-'));
    await writeClaudePlugin(pluginRoot, 'demo');
    await writeClaudeMcp(pluginRoot, {
      finance: { command: 'finance-mcp' },
    });

    const core = new LioraCore(async () => ({}) as never, { homeDir: home });
    await new Promise((r) => setImmediate(r));

    await core.installPlugin({ source: pluginRoot });
    await core.setPluginMcpServerEnabled({ id: 'demo', server: 'finance', enabled: true });

    await expect(core.getPluginInfo({ id: 'demo' })).resolves.toEqual(
      expect.objectContaining({
        mcpServers: expect.arrayContaining([
          expect.objectContaining({ name: 'finance', enabled: true }),
        ]),
      }),
    );
  });

  it('injects persisted managed SuperLiora environment into the datasource plugin MCP server', async () => {
    const previousBaseUrl = process.env['SUPERLIORA_BASE_URL'];
    const previousCodeOAuthHost = process.env['SUPERLIORA_OAUTH_HOST'];
    const previousOAuthHost = process.env['KIMI_OAUTH_HOST'];
    delete process.env['SUPERLIORA_BASE_URL'];
    delete process.env['SUPERLIORA_OAUTH_HOST'];
    delete process.env['KIMI_OAUTH_HOST'];

    const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
    const pluginRoot = await mkdtemp(path.join(tmpdir(), 'plugin-'));
    try {
      await writeFile(
        path.join(home, 'config.toml'),
        `
[providers."managed:kimi-api"]
type = "kimi"
base_url = "https://api.dev.example.test/coding/v1"
api_key = ""
oauth = { storage = "file", key = "oauth/kimi-code-env-1234", oauth_host = "https://auth.dev.example.test" }
`,
        'utf8',
      );
      await writeClaudePlugin(pluginRoot, 'kimi-datasource');
      await writeClaudeMcp(pluginRoot, {
        data: { command: 'node', args: ['./bin/kimi-datasource.mjs'] },
      });

      const core = new LioraCore(async () => ({}) as never, { homeDir: home });
      await new Promise((r) => setImmediate(r));
      await core.installPlugin({ source: pluginRoot });

      const mcpConfig = (
        core as unknown as {
          mergePluginMcpConfig(base: undefined): {
            servers: Record<string, { env?: Record<string, string> }>;
          };
        }
      ).mergePluginMcpConfig(undefined);

      expect(mcpConfig.servers['plugin:kimi-datasource:data']?.env).toEqual(
        expect.objectContaining({
          SUPERLIORA_BASE_URL: 'https://api.dev.example.test/coding/v1',
          SUPERLIORA_OAUTH_HOST: 'https://auth.dev.example.test',
        }),
      );
    } finally {
      restoreEnv('SUPERLIORA_BASE_URL', previousBaseUrl);
      restoreEnv('SUPERLIORA_OAUTH_HOST', previousCodeOAuthHost);
      restoreEnv('KIMI_OAUTH_HOST', previousOAuthHost);
    }
  });

  it('throws PLUGIN_LOAD_FAILED on every RPC when installed.json is corrupt', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
    await mkdir(path.join(home, 'plugins'), { recursive: true });
    await writeFile(path.join(home, 'plugins', 'installed.json'), '{ not json', 'utf8');

    const core = new LioraCore(async () => ({}) as never, { homeDir: home });

    await expect(core.installPlugin({ source: '/tmp/nonexistent' })).rejects.toThrow(/load/i);
    await expect(core.listPlugins({})).rejects.toThrow(/load/i);
    await expect(core.getPluginInfo({ id: 'demo' })).rejects.toThrow(/load/i);
    await expect(core.setPluginEnabled({ id: 'demo', enabled: false })).rejects.toThrow(/load/i);
    await expect(
      core.setPluginMcpServerEnabled({ id: 'demo', server: 'finance', enabled: true }),
    ).rejects.toThrow(/load/i);
    await expect(core.removePlugin({ id: 'demo' })).rejects.toThrow(/load/i);

    const { readFile } = await import('node:fs/promises');
    const onDisk = await readFile(path.join(home, 'plugins', 'installed.json'), 'utf8');
    expect(onDisk).toBe('{ not json');

    await writeFile(
      path.join(home, 'plugins', 'installed.json'),
      JSON.stringify({ version: 2, plugins: [] }),
      'utf8',
    );
    await core.reloadPlugins({});
    await expect(core.listPlugins({})).resolves.toEqual([]);
  });

  it('listPlugins waits for initial plugin load', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
    const pluginRoot = await mkdtemp(path.join(tmpdir(), 'plugin-'));
    await writeClaudePlugin(pluginRoot, 'demo');

    await mkdir(path.join(home, 'plugins'), { recursive: true });
    await writeFile(
      path.join(home, 'plugins', 'installed.json'),
      JSON.stringify({
        version: 2,
        plugins: [
          {
            id: 'demo',
            root: pluginRoot,
            source: 'local-path',
            enabled: true,
            installedAt: '2026-05-25T09:00:00Z',
          },
        ],
      }),
      'utf8',
    );

    const core = new LioraCore(async () => ({}) as never, { homeDir: home });

    await expect(core.listPlugins({})).resolves.toContainEqual(
      expect.objectContaining({ id: 'demo' }),
    );
  });

  it('listPluginThemes returns Claude themes from enabled plugins', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'kimi-home-'));
    const pluginRoot = await mkdtemp(path.join(tmpdir(), 'plugin-'));
    await writeClaudePlugin(pluginRoot, 'skin');
    await mkdir(path.join(pluginRoot, 'themes'), { recursive: true });
    await writeFile(
      path.join(pluginRoot, 'themes', 'neon.json'),
      JSON.stringify({ name: 'Neon', base: 'dark', overrides: { error: '#ff0000' } }),
      'utf8',
    );

    const core = new LioraCore(async () => ({}) as never, { homeDir: home });
    await new Promise((r) => setImmediate(r));
    await core.installPlugin({ source: pluginRoot });

    await expect(core.listPluginThemes({})).resolves.toEqual([
      expect.objectContaining({
        id: 'plugin-skin-neon',
        pluginId: 'skin',
        displayName: 'Neon',
        colors: { error: '#ff0000' },
      }),
    ]);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
