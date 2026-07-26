import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import {
  countEvidenceIds,
  formatPredicateFailures,
  isAllowedTestFile,
  resolveWithinRoot,
} from '#/agent/goal/predicate-runner';
import type { GoalPredicateFailure, UltraworkRun } from '#/agent/goal/predicate-runner';

const makeNode = (over: { id: string; evidenceIds?: string[] } = { id: 'n1' }) => ({
  id: over.id,
  evidenceIds: over.evidenceIds,
});

const makeRun = (nodes: Array<{ id: string; evidenceIds?: string[] }>): UltraworkRun => ({
  workGraph: { nodes: nodes.map(makeNode) as never },
} as never);

const makeFailure = (code: string, message: string): GoalPredicateFailure => ({ code, message });

describe('agent/goal/predicate-runner — countEvidenceIds', () => {
  it('returns 0 for null / undefined workGraph', () => {
    expect(countEvidenceIds(null)).toBe(0);
    expect(countEvidenceIds({} as never)).toBe(0);
  });

  it('sums evidenceIds across all nodes', () => {
    expect(
      countEvidenceIds(
        makeRun([
          { id: 'a', evidenceIds: ['e1', 'e2'] },
          { id: 'b', evidenceIds: ['e3'] },
          { id: 'c' },
        ]),
      ),
    ).toBe(3);
  });

  it('treats missing evidenceIds as 0', () => {
    expect(countEvidenceIds(makeRun([{ id: 'a' }, { id: 'b' }]))).toBe(0);
  });
});

describe('agent/goal/predicate-runner — resolveWithinRoot', () => {
  const root = resolve('/tmp/root');

  it('resolves a relative path under the root', () => {
    expect(resolveWithinRoot(root, 'sub/file.ts')).toBe(resolve(root, 'sub/file.ts'));
  });

  it('returns the normalized absolute path when input is already absolute and inside root', () => {
    expect(resolveWithinRoot(root, resolve(root, 'x/y.ts'))).toBe(resolve(root, 'x/y.ts'));
  });

  it('returns null for paths that escape the root', () => {
    expect(resolveWithinRoot(root, '../escape.ts')).toBeNull();
  });

  it('returns null for absolute paths outside the root', () => {
    expect(resolveWithinRoot(root, '/etc/passwd')).toBeNull();
  });
});

describe('agent/goal/predicate-runner — isAllowedTestFile', () => {
  const root = resolve('/tmp/root');

  it('accepts a .test.ts file under the root', () => {
    expect(isAllowedTestFile(root, resolve(root, 'src/foo.test.ts'))).toBe(true);
  });

  it('accepts a .spec.mjs file under the root', () => {
    expect(isAllowedTestFile(root, resolve(root, 'pkg/foo.spec.mjs'))).toBe(true);
  });

  it('accepts files inside a nested "test/" directory even when the extension is not a test name', () => {
    expect(isAllowedTestFile(root, resolve(root, 'nested/test/fixture.ts'))).toBe(true);
  });

  it('rejects files outside the root', () => {
    expect(isAllowedTestFile(root, '/etc/passwd')).toBe(false);
  });

  it('rejects regular .ts files outside any test directory', () => {
    expect(isAllowedTestFile(root, resolve(root, 'src/foo.ts'))).toBe(false);
  });
});

describe('agent/goal/predicate-runner — formatPredicateFailures', () => {
  it('returns an empty string for an empty failure list', () => {
    expect(formatPredicateFailures([])).toBe('');
  });

  it('renders each failure as "- [code] message" joined by newlines', () => {
    expect(
      formatPredicateFailures([
        makeFailure('evidence.missing', 'e-1 not found'),
        makeFailure('test.failed', 'tests/foo.test.ts failed'),
      ]),
    ).toBe('- [evidence.missing] e-1 not found\n- [test.failed] tests/foo.test.ts failed');
  });
});
