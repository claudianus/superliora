import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Windows tree-kill has been implemented four times, and the copy that
 * mattered most — the one for an aborted search — was missing entirely, so an
 * aborted scan kept holding the workspace directory. These assertions keep the
 * service paths pointed at the single shared helper.
 */
const SERVICES_DIR = join(import.meta.dirname, '..', '..', 'src', 'services');

const SPAWN_SERVICES = ['fs/fsSearchService.ts', 'fs/fsGitService.ts', 'fs/fsService.ts'];

describe('process tree kill', () => {
  it('is exported from one shared module', async () => {
    const mod = await import('../../src/services/fs/process-kill');
    expect(typeof mod.killProcessTree).toBe('function');
  });

  it('falls back to a direct kill on POSIX without touching taskkill', async () => {
    if (process.platform === 'win32') return; // asserted on the Windows shard
    const killed: string[] = [];
    const fake = {
      pid: undefined,
      kill: (): boolean => {
        killed.push('kill');
        return true;
      },
    } as never;
    const { killProcessTree } = await import('../../src/services/fs/process-kill');
    killProcessTree(fake);
    expect(killed).toEqual(['kill']);
  });

  it('is the kill strategy used by every spawning service', () => {
    for (const relative of SPAWN_SERVICES) {
      const source = readFileSync(join(SERVICES_DIR, relative), 'utf-8');
      // A service that spawns a process must not hand-roll `child.kill()`;
      // the shared helper is the only place allowed to know about taskkill.
      expect(source.includes('child.kill('), `${relative} calls child.kill directly`).toBe(
        false,
      );
      expect(source.includes('taskkill'), `${relative} reimplements the tree kill`).toBe(false);
    }
  });

  it('keeps the Windows tree kill in exactly one place', () => {
    const git = readFileSync(join(SERVICES_DIR, 'fs/fsGitService.ts'), 'utf-8');
    const search = readFileSync(join(SERVICES_DIR, 'fs/fsSearchService.ts'), 'utf-8');
    const shared = readFileSync(join(SERVICES_DIR, 'fs/process-kill.ts'), 'utf-8');
    expect(shared).toContain('taskkill');
    expect(git).not.toContain('taskkill');
    expect(search).not.toContain('taskkill');
  });
});
