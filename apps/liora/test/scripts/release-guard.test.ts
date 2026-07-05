import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const workspaceImportScript = resolve(repoRoot, 'scripts/check-workspace-imports.mjs');

describe('release guard — workspace imports', () => {
  it('rejects unknown or mistyped @superliora package imports', () => {
    expect(() => {
      execFileSync(process.execPath, [workspaceImportScript], {
        cwd: repoRoot,
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).not.toThrow();
  });

  it('keeps meta/upstream.lock.yaml in sync with the generated CLI baseline', () => {
    const syncScript = resolve(repoRoot, 'apps/liora/scripts/sync-upstream-baseline.mjs');
    const generatedPath = resolve(
      repoRoot,
      'apps/liora/src/generated/upstream-baseline.generated.ts',
    );
    const before = readFileSync(generatedPath, 'utf8');

    execFileSync(process.execPath, [syncScript], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    expect(readFileSync(generatedPath, 'utf8')).toBe(before);
  });
});
