import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  handleAsideCommand,
  handleBrowserUseCommand,
} from '#/cli/sub/browser-use';
import {
  ASIDE_MCP_SERVER_NAME,
  AsideCliMissingError,
  buildAsideMcpServerConfig,
  disableAsideSidecar,
  enableAsideSidecar,
  formatAsideSidecarStatus,
  loadAsideSidecarStatus,
  resolveAsideCliPath,
} from '#/utils/aside/aside-sidecar';

async function tempWorkspace(): Promise<{
  readonly root: string;
  readonly cwd: string;
  readonly dataDir: string;
  readonly cli: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'aside-sidecar-'));
  const cwd = join(root, 'cwd');
  const dataDir = join(root, 'data');
  const cli = join(root, 'aside');
  await mkdir(cwd, { recursive: true });
  await writeFile(cli, '#!/bin/sh\n', 'utf8');
  return { root, cwd, dataDir, cli };
}

describe('aside-sidecar', () => {
  it('resolves ASIDE_CLI before PATH and known locations', () => {
    const envPath = join('/tmp', 'aside-from-env');
    const known = join('/tmp', 'home', '.local', 'bin', 'aside');

    expect(
      resolveAsideCliPath({
        env: { ASIDE_CLI: envPath, PATH: join('/tmp', 'bin') },
        pathExists: (p) => p === envPath || p === known || p === join('/tmp', 'bin', 'aside'),
        homeDir: join('/tmp', 'home'),
      }),
    ).toBe(envPath);

    expect(
      resolveAsideCliPath({
        env: { PATH: join('/tmp', 'bin') },
        pathExists: (p) => p === join('/tmp', 'bin', 'aside'),
        homeDir: join('/tmp', 'home'),
      }),
    ).toBe(join('/tmp', 'bin', 'aside'));

    expect(
      resolveAsideCliPath({
        env: { PATH: '' },
        pathExists: (p) => p === known,
        homeDir: join('/tmp', 'home'),
      }),
    ).toBe(known);

    expect(
      resolveAsideCliPath({
        env: { PATH: '' },
        pathExists: () => false,
        homeDir: join('/tmp', 'home'),
      }),
    ).toBeUndefined();
  });

  it('builds stdio mcp config for aside mcp', () => {
    expect(buildAsideMcpServerConfig('/opt/aside')).toEqual({
      transport: 'stdio',
      command: '/opt/aside',
      args: ['mcp'],
      enabled: true,
    });
  });

  it('enable writes user mcp.json and disable removes it', async () => {
    const { cwd, dataDir, cli } = await tempWorkspace();
    const pathExists = (p: string) => p === cli;

    const enabled = await enableAsideSidecar({
      cwd,
      dataDir,
      env: { ASIDE_CLI: cli, PATH: '' },
      pathExists,
    });
    expect(enabled.command).toBe(cli);

    const raw = JSON.parse(await readFile(enabled.path, 'utf8')) as {
      mcpServers: Record<string, { command?: string; args?: string[] }>;
    };
    expect(raw.mcpServers[ASIDE_MCP_SERVER_NAME]).toMatchObject({
      command: cli,
      args: ['mcp'],
    });

    const status = await loadAsideSidecarStatus({
      cwd,
      dataDir,
      env: { ASIDE_CLI: cli, PATH: '' },
      pathExists,
    });
    expect(status.ready).toBe(true);
    expect(formatAsideSidecarStatus(status)).toContain('Ready: yes');

    const disabled = await disableAsideSidecar({ cwd, dataDir });
    expect(disabled.found).toBe(true);
    const after = JSON.parse(await readFile(disabled.path, 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(after.mcpServers[ASIDE_MCP_SERVER_NAME]).toBeUndefined();
  });

  it('enable throws when CLI is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aside-sidecar-missing-'));
    await expect(
      enableAsideSidecar({
        cwd: root,
        dataDir: join(root, 'data'),
        env: { PATH: '' },
        pathExists: () => false,
      }),
    ).rejects.toBeInstanceOf(AsideCliMissingError);
  });

  it('CLI aside enable/status/disable and doctor append sidecar without failing', async () => {
    const { root, cwd, dataDir, cli } = await tempWorkspace();
    const chunks: string[] = [];
    const err: string[] = [];
    const asideContext = () => ({
      cwd,
      dataDir,
      env: { ASIDE_CLI: cli, PATH: '' },
      pathExists: (p: string) => p === cli,
    });
    const io = {
      packageRoot: () => root,
      stdout: {
        write: (c: string) => {
          chunks.push(c);
          return true;
        },
      },
      stderr: {
        write: (c: string) => {
          err.push(c);
          return true;
        },
      },
      exit: ((code: number) => {
        throw new Error(`exit ${code}`);
      }) as (code: number) => never,
      install: async () => ({ ok: true, code: 0, stdout: '', stderr: '', command: [] as string[] }),
      update: async () => ({ ok: true, code: 0, stdout: '', stderr: '', command: [] as string[] }),
      info: async () => ({
        ok: true,
        code: 0,
        stdout: 'cloak ready\n',
        stderr: '',
        command: ['info'],
      }),
      cwd: () => cwd,
      asideContext,
    };

    expect(await handleAsideCommand('enable', io)).toBe(0);
    expect(chunks.join('')).toContain('Aside MCP registered');

    chunks.length = 0;
    expect(await handleAsideCommand('status', io)).toBe(0);
    expect(chunks.join('')).toContain('Ready: yes');

    chunks.length = 0;
    expect(await handleBrowserUseCommand('doctor', io)).toBe(0);
    expect(chunks.join('')).toContain('Aside MCP sidecar');
    expect(chunks.join('')).toContain('Browser-use doctor passed');

    chunks.length = 0;
    expect(await handleAsideCommand('disable', io)).toBe(0);
    expect(chunks.join('')).toContain('Aside MCP removed');

    err.length = 0;
    expect(
      await handleAsideCommand('enable', {
        ...io,
        asideContext: () => ({
          cwd,
          dataDir,
          env: { PATH: '' },
          pathExists: () => false,
        }),
      }),
    ).toBe(1);
    expect(err.join('')).toContain('Aside CLI not found');
  });
});
