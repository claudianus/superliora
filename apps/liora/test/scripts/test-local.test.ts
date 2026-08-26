import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');

describe('test-local scope', () => {
  it('self-check exits 0', () => {
    const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/test-local.mjs'), '--self-check'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('self-check OK');
  });
});
