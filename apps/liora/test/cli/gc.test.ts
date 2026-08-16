import { mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { registerGcCommand } from '#/cli/sub/gc';

const temps: string[] = [];
afterEach(async () => {
  while (temps.length) {
    const d = temps.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

describe('liora gc', () => {
  it('dry-run lists candidates without deleting active session wire', async () => {
    const home = await mkdtemp(join(tmpdir(), 'liora-gc-'));
    temps.push(home);
    const sessionDir = join(home, 'sessions', 'wd_x', 'session_live');
    const agentDir = join(sessionDir, 'agents', 'a1');
    await mkdir(agentDir, { recursive: true });
    const wire = join(agentDir, 'wire.jsonl');
    await writeFile(wire, '{}\n', 'utf-8');
    await writeFile(join(sessionDir, 'state.json'), '{}', 'utf-8');
    const now = Date.now();
    await utimes(wire, now / 1000, now / 1000);

    const cache = join(home, 'cache', 'stale');
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'x'), 'data', 'utf-8');
    const old = (now - 30 * 24 * 60 * 60 * 1000) / 1000;
    await utimes(cache, old, old);

    const lines: string[] = [];
    const program = new Command();
    registerGcCommand(program, {
      homeDir: () => home,
      stdout: (l) => lines.push(l),
      stderr: (l) => lines.push(`ERR:${l}`),
    });
    await program.parseAsync(['gc', '--dry-run'], { from: 'user' });
    const out = lines.join('\n');
    expect(out).toContain('dry-run');
    expect(out).toContain(home);
    // active wire file still exists
    const { stat } = await import('node:fs/promises');
    await expect(stat(wire)).resolves.toBeTruthy();
  });
});
