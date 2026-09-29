import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { atomicWrite, writeFileAtomicDurable } from '../../src/utils/fs';

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

describe('writeFileAtomicDurable staging', () => {
  it('keeps concurrent writers to the same target from colliding', async () => {
    // A fixed `.tmp` suffix let two writers truncate each other's staging
    // file; the loser's rename then failed and the write was silently
    // dropped. Conductor fan-out writing the worktree registry is a real
    // caller that does exactly this.
    const dir = await mkdtemp(join(tmpdir(), 'atomic-concurrent-'));
    temps.push(dir);
    const target = join(dir, 'registry.json');
    await writeFile(target, '{"seed":true}');

    await Promise.all(
      Array.from({ length: 8 }, (_, i) => writeFileAtomicDurable(target, `{"writer":${i}}`)),
    );

    const written = await readFile(target, 'utf8');
    // Whatever wins, the target must hold exactly one complete payload.
    expect(written).toMatch(/^\{"writer":\d\}$/);
    expect((await readdir(dir)).filter((n) => n.includes('.tmp.'))).toEqual([]);
  });

  it('replaces existing content and leaves no staging file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atomic-replace-'));
    temps.push(dir);
    const target = join(dir, 'out.txt');

    await writeFileAtomicDurable(target, 'first');
    await writeFileAtomicDurable(target, 'second');

    expect(await readFile(target, 'utf8')).toBe('second');
    expect((await readdir(dir)).filter((n) => n.includes('.tmp.'))).toEqual([]);
  });
});
