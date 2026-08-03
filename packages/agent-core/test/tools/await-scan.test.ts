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
    // (c) summary line present with the LEGACY_BASELINE constant unmodified.
    expect(stdout).toMatch(/^await-scan: violations=\d+ baseline=9 status=OK$/m);
    // (d) both scan roots are covered (tool family + session offload lane).
    expect(stdout).toMatch(/^await-scan: roots=.*session\/job/m);
    // (e) worker lane ratcheted to zero: the interactive lane never awaits
    // worker spawn/schedule results (V2-1 ACK offload + V2-2 WorkerSpawner).
    expect(stdout).toMatch(/^await-scan: worker-lane violations=0 cap=0 status=OK$/m);
    // (f) the designated offload sink keeps its (exempt) scheduler await.
    expect(stdout).toMatch(/^await-scan: offload-sink violations=\d+ min=1 .* status=OK$/m);
    // (g) merge lane tracked separately until V2-5 offloads landJobToMain.
    expect(stdout).toMatch(/^await-scan: merge-lane violations=\d+ baseline=1 status=OK$/m);
  });
});
