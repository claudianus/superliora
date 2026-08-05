import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PROVIDER_MCP_AUTO_DISABLE_ENV,
  resolveProviderMcpServers,
} from '../../src/mcp/provider-servers';
import { resolveSessionMcpConfig } from '../../src/mcp/session-config';
import type { LioraConfig } from '../../src/config/schema';

const EMPTY_ENV: NodeJS.ProcessEnv = {};

const zaiConfig = {
  providers: {
    'zai-coding-plan': {
      type: 'openai',
      apiKey: 'zai-config-key',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    },
  },
} satisfies Pick<LioraConfig, 'providers'>;

describe('resolveProviderMcpServers', () => {
  it('injects the four Z.AI servers from an env key using bearerTokenEnvVar', () => {
    const servers = resolveProviderMcpServers({ providers: {} }, { Z_AI_API_KEY: 'env-key' });

    expect(Object.keys(servers).sort()).toEqual([
      'zai-vision',
      'zai-web-reader',
      'zai-web-search',
      'zai-zread',
    ]);
    expect(servers['zai-web-search']).toMatchObject({
      transport: 'http',
      url: 'https://api.z.ai/api/mcp/web_search_prime/mcp',
      bearerTokenEnvVar: 'Z_AI_API_KEY',
    });
    expect(servers['zai-web-reader']).toMatchObject({
      transport: 'http',
      url: 'https://api.z.ai/api/mcp/web_reader/mcp',
    });
    expect(servers['zai-zread']).toMatchObject({
      transport: 'http',
      url: 'https://api.z.ai/api/mcp/zread/mcp',
    });
    expect(servers['zai-vision']).toMatchObject({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@z_ai/mcp-server'],
      env: { Z_AI_API_KEY: 'env-key', Z_AI_MODE: 'ZAI' },
    });
  });

  it('embeds a literal Authorization header when the key comes from config', () => {
    const servers = resolveProviderMcpServers(zaiConfig, EMPTY_ENV);
    expect(servers['zai-web-search']).toMatchObject({
      transport: 'http',
      headers: { Authorization: 'Bearer zai-config-key' },
    });
    expect(servers['zai-vision']).toMatchObject({
      env: { Z_AI_API_KEY: 'zai-config-key', Z_AI_MODE: 'ZAI' },
    });
  });

  it('injects nothing without a Z.AI credential', () => {
    expect(resolveProviderMcpServers({ providers: {} }, EMPTY_ENV)).toEqual({});
    expect(
      resolveProviderMcpServers(
        { providers: { 'qwen-token-plan': { type: 'openai', apiKey: 'sk-sp-x' } } },
        EMPTY_ENV,
      ),
    ).toEqual({});
  });

  it('honors the env kill switch', () => {
    expect(
      resolveProviderMcpServers(zaiConfig, {
        Z_AI_API_KEY: 'env-key',
        [PROVIDER_MCP_AUTO_DISABLE_ENV]: '1',
      }),
    ).toEqual({});
  });

  it('honors [mcp] autoProviderServers = false', () => {
    expect(
      resolveProviderMcpServers(
        { ...zaiConfig, mcp: { autoProviderServers: false } },
        { Z_AI_API_KEY: 'env-key' },
      ),
    ).toEqual({});
  });
});

describe('resolveSessionMcpConfig auto-injection precedence', () => {
  const dirs: string[] = [];
  let savedZaiEnv: string | undefined;
  let savedZaiAltEnv: string | undefined;

  afterEach(async () => {
    if (savedZaiEnv === undefined) delete process.env['Z_AI_API_KEY'];
    else process.env['Z_AI_API_KEY'] = savedZaiEnv;
    if (savedZaiAltEnv === undefined) delete process.env['ZAI_API_KEY'];
    else process.env['ZAI_API_KEY'] = savedZaiAltEnv;
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeTempTree(): Promise<{ cwd: string; homeDir: string }> {
    const cwd = await mkdtemp(join(tmpdir(), 'liora-mcp-cwd-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'liora-mcp-home-'));
    dirs.push(cwd, homeDir);
    // Anchor project-root discovery at the temp cwd.
    await mkdir(join(cwd, '.git'));
    return { cwd, homeDir };
  }

  it('adds provider servers when no mcp.json files exist', async () => {
    savedZaiEnv = process.env['Z_AI_API_KEY'];
    savedZaiAltEnv = process.env['ZAI_API_KEY'];
    delete process.env['Z_AI_API_KEY'];
    delete process.env['ZAI_API_KEY'];
    const { cwd, homeDir } = await makeTempTree();
    const resolved = await resolveSessionMcpConfig({
      cwd,
      homeDir,
      config: { providers: {} },
    });
    expect(resolved).toBeUndefined();

    const withKey = await resolveSessionMcpConfig({
      cwd,
      homeDir,
      config: zaiConfig,
    });
    expect(withKey?.servers['zai-web-search']).toBeDefined();
  });

  it('lets user mcp.json override an auto-injected server with the same name', async () => {
    const { cwd, homeDir } = await makeTempTree();
    await writeFile(
      join(cwd, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'zai-web-search': { transport: 'http', url: 'https://proxy.example.test/custom' },
        },
      }),
    );

    const resolved = await resolveSessionMcpConfig({ cwd, homeDir, config: zaiConfig });

    expect(resolved?.servers['zai-web-search']).toMatchObject({
      transport: 'http',
      url: 'https://proxy.example.test/custom',
    });
    // Other auto-injected servers are still present.
    expect(resolved?.servers['zai-vision']).toBeDefined();
  });
});
