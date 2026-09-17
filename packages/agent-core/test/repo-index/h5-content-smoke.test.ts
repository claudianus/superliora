/**
 * H5 smoke: `RepoQuery mode=content` must return real matches and must never
 * surface the bundled-`require` TDZ failure.
 *
 * Observed failure: every content query against a real repo returned
 * `results: 0` with `hint: Cannot access 'require' before initialization`.
 * Root cause: several modules bound `const require = createRequire(...)`, and
 * esbuild's CJS/SEA bundle rewrites the inner `require("url")` of
 * `createRequire(import.meta.url)` into a self-referential call, so the binding
 * was read inside its own temporal dead zone (see the H5 notes in
 * `repo-index/engine.ts` and `repo-index/content-indexer.ts`). Workers then
 * fell back to Bash `grep`, which itself fed the finishing stalls (H8).
 *
 * The assertions below run the real content path end to end (index → query →
 * result) and pin the failure string that used to replace the results.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  probeSqliteDriver,
  queryRepoIndexContent,
  queryRepoIndexContentAsync,
  resetContentIndexForTests,
  resetRepoIndexSyntheticFtsForTests,
  resetSqliteDriverProbeOverride,
  setContentIndexDbPathOverrideForTests,
} from '#/repo-index/engine';

/** The exact string that used to swallow every content result. */
const TDZ_FAILURE = "Cannot access 'require' before initialization";

describe('H5 RepoQuery mode=content smoke', () => {
  let dir: string;
  const probeToken = 'H5ContentSmokeProbeToken';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'h5-content-smoke-'));
    writeFileSync(join(dir, 'probe.ts'), `export const marker = '${probeToken}';\n`);
    writeFileSync(join(dir, 'notes.md'), `# docs\n${probeToken} also appears here.\n`);
    resetContentIndexForTests();
    setContentIndexDbPathOverrideForTests(() => ':memory:');
  });

  afterEach(() => {
    resetContentIndexForTests();
    resetRepoIndexSyntheticFtsForTests();
    resetSqliteDriverProbeOverride();
    setContentIndexDbPathOverrideForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a sqlite driver without dying on the bundled-require TDZ', () => {
    // The crash lived in the driver probe: `const require = createRequire(…)`
    // was rewritten self-referentially in the SEA bundle. A probe that reports
    // a driver (or a clean "no driver" reason) proves the binding is intact.
    const probe = probeSqliteDriver();
    expect(probe.reason ?? '').not.toContain(TDZ_FAILURE);
    expect(probe.available).toBe(true);
  });

  it('returns real content matches instead of results: 0 + the TDZ hint', () => {
    const result = queryRepoIndexContent(
      { query: probeToken, path: 'probe', limit: 10, workspaceDir: dir },
      'sqlite',
    );

    // The failure string must be gone entirely...
    expect(result.hint).not.toContain(TDZ_FAILURE);
    expect(result.next_step).not.toContain(TDZ_FAILURE);
    // ...and the query must return the indexed line.
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0]).toContain(probeToken);
    expect(result.results[0]).toMatch(/^probe\.ts:L\d+ /);
    expect(result.index_status).toBe('partial');
  });

  it('returns matches through the async content path the RepoQuery tool calls', async () => {
    const result = await queryRepoIndexContentAsync(
      { query: probeToken, path: 'probe', limit: 10, workspaceDir: dir },
      'sqlite',
    );

    expect(result.hint).not.toContain(TDZ_FAILURE);
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results.some((row) => row.includes(probeToken))).toBe(true);
  });

  it('reports a driver diagnostic (never the TDZ string) for an unknown token', () => {
    const result = queryRepoIndexContent(
      { query: 'zzzz-not-indexed-token-zzzz', limit: 10, workspaceDir: dir },
      'sqlite',
    );
    expect(result.hint).not.toContain(TDZ_FAILURE);
    expect(result.results).toEqual([]);
    expect(result.index_status).toBe('cold');
    expect(result.next_step).toContain('Grep fallback');
  });
});
