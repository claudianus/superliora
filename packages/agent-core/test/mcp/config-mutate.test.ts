import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readMcpJsonFile,
  removeMcpServerInScope,
  setMcpServerEnabledInScope,
  upsertMcpServerInScope,
} from '../../src/mcp/config-mutate';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-mutate-'));
  tempDirs.push(dir);
  return dir;
}

describe('mcp config-mutate', () => {
  it('upserts, toggles, and removes a user-scope stdio server', async () => {
    const home = makeTempDir();
    const cwd = makeTempDir();
    await mkdir(join(cwd, '.git'), { recursive: true });

    const ctx = { cwd, homeDir: home };
    await upsertMcpServerInScope(ctx, 'user', 'fs', {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server'],
      enabled: true,
    });

    const path = join(home, 'mcp.json');
    const written = JSON.parse(await readFile(path, 'utf-8')) as {
      mcpServers: Record<string, { enabled?: boolean; command?: string }>;
    };
    expect(written.mcpServers.fs?.command).toBe('npx');
    expect(written.mcpServers.fs?.enabled).toBe(true);

    const toggled = await setMcpServerEnabledInScope(ctx, 'user', 'fs', false);
    expect(toggled.found).toBe(true);
    const afterToggle = await readMcpJsonFile(path);
    expect(afterToggle.fs?.enabled).toBe(false);

    const removed = await removeMcpServerInScope(ctx, 'user', 'fs');
    expect(removed.found).toBe(true);
    expect(await readMcpJsonFile(path)).toEqual({});
  });
});
