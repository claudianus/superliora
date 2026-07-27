import { describe, expect, it } from 'vitest';

import { extractFileChangePaths, hasCitedEvidence } from '../../../../src/tools/builtin/collaboration/ultra-swarm-helpers';

describe('extractFileChangePaths', () => {
  it('extracts labeled file change lists', () => {
    const paths = extractFileChangePaths(
      'VERDICT: PASS\nfiles_changed: packages/agent-core/src/foo.ts, apps/liora/src/bar.tsx\n',
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        'packages/agent-core/src/foo.ts',
        'apps/liora/src/bar.tsx',
      ]),
    );
    expect(paths).toHaveLength(2);
  });

  it('extracts artifact_paths and inline source paths', () => {
    const paths = extractFileChangePaths(
      [
        'Implemented the fix.',
        'artifact_paths: packages/agent-core/src/session/swarm-budget.ts',
        'Also touched packages/agent-core/test/session/swarm-budget.test.ts',
      ].join('\n'),
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        'packages/agent-core/src/session/swarm-budget.ts',
        'packages/agent-core/test/session/swarm-budget.test.ts',
      ]),
    );
  });

  it('ignores bare words, urls, and evidence-only ids', () => {
    const paths = extractFileChangePaths(
      'evidence_ids: ac_1, f8661b5e9df9\nsee https://example.com/docs/guide\nno real paths here',
    );
    expect(paths).toEqual([]);
  });

  it('dedupes repeated paths', () => {
    const paths = extractFileChangePaths(
      'files changed: src/a.ts src/a.ts\nwrote: src/a.ts',
    );
    expect(paths).toEqual(['src/a.ts']);
  });

  it('extracts verb+path lines without a colon label', () => {
    const paths = extractFileChangePaths(
      [
        'Modified packages/agent-core/src/foo.ts',
        'Wrote 18 bytes to packages/agent-core/src/bar.ts',
        'Appended 6 bytes to packages/agent-core/src/bar.ts',
        'Created packages/agent-core/test/baz.test.ts',
      ].join('\n'),
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        'packages/agent-core/src/foo.ts',
        'packages/agent-core/src/bar.ts',
        'packages/agent-core/test/baz.test.ts',
      ]),
    );
  });
});

describe('hasCitedEvidence (T4-7b)', () => {
  it('accepts evidence ids, changed paths, file:line, and log artifacts', () => {
    expect(hasCitedEvidence('evidence_ids: ab12cd34ef56')).toBe(true);
    expect(hasCitedEvidence('files_changed: src/session/host.ts')).toBe(true);
    expect(hasCitedEvidence('The leak is at src/session/host.ts:702 — fixed.')).toBe(true);
    expect(hasCitedEvidence('Captured output in .superliora/tmp/gate.log')).toBe(true);
    expect(hasCitedEvidence('Added test/session/host.test.ts coverage')).toBe(true);
  });

  it('rejects bare claims with no citation', () => {
    expect(hasCitedEvidence('VERDICT: PASS\nEverything works, all good.')).toBe(false);
    expect(hasCitedEvidence('')).toBe(false);
  });
});
