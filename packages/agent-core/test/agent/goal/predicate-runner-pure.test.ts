import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import {
  formatPredicateFailures,
  isAllowedTestFile,
  resolveWithinRoot,
} from '#/agent/goal/predicate-runner';
import type { GoalPredicateFailure } from '#/agent/goal/predicate-runner';

const makeFailure = (code: string, message: string): GoalPredicateFailure => ({ code, message });

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
