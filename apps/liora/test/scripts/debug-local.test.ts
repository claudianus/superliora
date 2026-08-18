import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FALLBACK_TERM,
  buildDebugEnv,
  formatDebugEnvReport,
} from '../../../../scripts/debug-local-env.mjs';

const repoRoot = resolve(import.meta.dirname, '../../../..');

describe('debug-local env', () => {
  it('strips CI leftovers, upgrades TERM=dumb, and isolates home', () => {
    const built = buildDebugEnv(
      {
        CI: 'true',
        NO_COLOR: '1',
        TERM: 'dumb',
        OPENAI_API_KEY: 'sk-test',
      },
      { repoRoot: '/tmp/superliora-repo' },
    );
    expect(built.env['CI']).toBeUndefined();
    expect(built.env['NO_COLOR']).toBeUndefined();
    expect(built.env['TERM']).toBe(FALLBACK_TERM);
    expect(built.env['SUPERLIORA_DEBUG']).toBe('1');
    expect(built.env['SUPERLIORA_LOG_LEVEL']).toBe('info');
    expect(built.home.replaceAll('\\', '/')).toBe('/tmp/superliora-repo/.superliora-debug');
    expect(built.env['OPENAI_API_KEY']).toBe('sk-test');
    expect(formatDebugEnvReport(built).some((line) => line === 'CI (unset)')).toBe(true);
  });

  it('self-check exits 0', () => {
    const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/debug-local.mjs'), '--self-check'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('self-check OK');
  });
});
