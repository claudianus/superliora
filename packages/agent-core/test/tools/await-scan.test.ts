import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const scriptPath = join(repoRoot, 'scripts', 'check-await-scan.mjs');

describe('await-scan gate (V2-4)', () => {
  it('exits 0, covers job-tools.ts, and prints an intact baseline summary', async () => {
    let exitCode = 0;
    let stdout = '';
    try {
      const result = await promisify(execFile)(process.execPath, [scriptPath], {
        cwd: repoRoot,
      });
      stdout = result.stdout;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string };
      exitCode = typeof failure.code === 'number' ? failure.code : 1;
      stdout = failure.stdout ?? '';
    }

    // (a) the ratchet gate passes on the current tree.
    expect(exitCode).toBe(0);
    // (b) the scan genuinely covers the job tool sources.
    expect(stdout).toContain('job-tools.ts');
    // (c) summary line present with the BASELINE constant unmodified.
    expect(stdout).toMatch(/^await-scan: violations=\d+ baseline=9 status=OK$/m);
  });
});
