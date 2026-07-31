import { mkdtempSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findMcpServerScope,
  readMcpJsonFile,
  removeMcpServer,
  setMcpServerEnabled,
  stdioConfig,
  upsertMcpServer,
} from '../../src/utils/mcp/mcp-config-file';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liora-mcp-cfg-'));
  tempDirs.push(dir);
  return dir;
}

describe('mcp-config-file', () => {
  it('writes user mcp.json and finds scope', async () => {
    const home = makeTempDir();
    const cwd = makeTempDir();
    await mkdir(join(cwd, '.git'), { recursive: true });

    const path = await upsertMcpServer(cwd, 'user', 'demo', stdioConfig('echo', ['hi']), home);
    expect(path.endsWith('mcp.json')).toBe(true);
    const servers = await readMcpJsonFile(path);
    expect(servers['demo']?.command).toBe('echo');

    expect(await findMcpServerScope(cwd, 'demo', home)).toBe('user');
    await setMcpServerEnabled(cwd, 'user', 'demo', false, home);
    expect((await readMcpJsonFile(path))['demo']?.enabled).toBe(false);
    await removeMcpServer(cwd, 'user', 'demo', home);
    expect(await readMcpJsonFile(path)).toEqual({});
  });
});
