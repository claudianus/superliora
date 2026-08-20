import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { atomicWrite } from '../../src/utils/fs';

const temps: string[] = [];

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('atomicWrite ENOSPC cleanup', () => {
  it('unlinks the temp file when fsync fails with ENOSPC', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atomic-enospc-'));
    temps.push(dir);
    const target = join(dir, 'out.txt');
    const enospc = Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
    await expect(
      atomicWrite(target, 'hello', async () => {
        throw enospc;
      }),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    const leftover = (await readdir(dir)).filter((name) => name.includes('.tmp.'));
    expect(leftover).toEqual([]);
  });
});
