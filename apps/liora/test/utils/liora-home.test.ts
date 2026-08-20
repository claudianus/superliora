import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { relocateLioraHome } from '#/utils/liora-home';

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liora-relocate-'));
  temps.push(dir);
  return dir;
}

const previousHome = process.env['SUPERLIORA_HOME'];

afterEach(async () => {
  if (previousHome === undefined) delete process.env['SUPERLIORA_HOME'];
  else process.env['SUPERLIORA_HOME'] = previousHome;
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('relocateLioraHome', () => {
  it('copies the tree and writes home.redirect under the OS pointer dir', async () => {
    const osHome = await tempDir();
    const from = join(osHome, '.superliora');
    const to = join(osHome, 'D-drive', 'SuperLiora');
    await mkdir(join(from, 'sessions'), { recursive: true });
    await writeFile(join(from, 'config.toml'), 'x = 1\n', 'utf8');
    await writeFile(join(from, 'sessions', 'a.jsonl'), 'a\n', 'utf8');

    const result = await relocateLioraHome({ from, to, osHome });
    expect(result.to).toBe(to);
    expect(await readFile(join(to, 'config.toml'), 'utf8')).toBe('x = 1\n');
    const redirect = await readFile(join(from, 'home.redirect'), 'utf8');
    expect(redirect).toContain(to);
    expect(process.env['SUPERLIORA_HOME']).toBe(to);
  });
});
