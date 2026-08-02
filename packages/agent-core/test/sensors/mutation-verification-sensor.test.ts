import { describe, expect, it } from 'vitest';

import {
  MUTATION_SENSOR_GOAL_DONE_TIP,
  MUTATION_SENSOR_RECENCY_MS,
  MUTATION_VERIFY_NUDGE,
  buildPendingMutationSoftTips,
  clearPendingMutations,
  createMutationVerificationLedger,
  deriveMutationPackageDir,
  extractMutationPathsFromToolArgs,
  extractPathsFromOpenCodePatch,
  filterRecentMutations,
  formatMutationVerifyNudge,
  isFileMutationTool,
  observeFileMutationToolResult,
  recordFileMutation,
} from '../../src/sensors/mutation-verification-sensor';

describe('mutation-verification-sensor', () => {
  it('recognizes file mutation tools only', () => {
    expect(isFileMutationTool('Edit')).toBe(true);
    expect(isFileMutationTool('Write')).toBe(true);
    expect(isFileMutationTool('ApplyPatch')).toBe(true);
    expect(isFileMutationTool('Read')).toBe(false);
    expect(isFileMutationTool('Bash')).toBe(false);
  });

  it('records pending mutations and appends nudge on successful Edit', () => {
    const ledger = createMutationVerificationLedger();
    const result = observeFileMutationToolResult(ledger, 'Edit', {
      output: 'Replaced 1 occurrence in foo.ts',
    });
    expect(ledger.pending).toHaveLength(1);
    expect(ledger.pending[0]?.toolName).toBe('Edit');
    expect(typeof result.output === 'string' ? result.output : '').toContain(MUTATION_VERIFY_NUDGE);
    expect(typeof result.output === 'string' ? result.output : '').toContain(
      'Replaced 1 occurrence in foo.ts',
    );
  });

  it('does not record or nudge on error results', () => {
    const ledger = createMutationVerificationLedger();
    const result = observeFileMutationToolResult(ledger, 'Write', {
      isError: true,
      output: 'old_string not found',
    });
    expect(ledger.pending).toHaveLength(0);
    expect(result.output).toBe('old_string not found');
  });

  it('does not double-append the nudge', () => {
    const ledger = createMutationVerificationLedger();
    const first = observeFileMutationToolResult(ledger, 'Edit', {
      output: 'ok',
    });
    const text = typeof first.output === 'string' ? first.output : '';
    const second = observeFileMutationToolResult(ledger, 'Edit', { output: text });
    const secondText = typeof second.output === 'string' ? second.output : '';
    expect(secondText.split('PostToolUse sensor: source mutated').length - 1).toBe(1);
  });

  it('clears pending on green checks', () => {
    const ledger = createMutationVerificationLedger();
    recordFileMutation(ledger, 'ApplyPatch');
    expect(ledger.pending).toHaveLength(1);
    clearPendingMutations(ledger, 1_000);
    expect(ledger.pending).toHaveLength(0);
    expect(ledger.lastCheckPassAtMs).toBe(1_000);
  });

  it('ignores stale mutations outside recency window', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const ledger = createMutationVerificationLedger();
    recordFileMutation(ledger, 'Edit', now - MUTATION_SENSOR_RECENCY_MS - 1);
    expect(filterRecentMutations(ledger.pending, now)).toHaveLength(0);
    expect(buildPendingMutationSoftTips(ledger, now)).toHaveLength(0);
  });

  it('builds soft tips while mutations are newer than last green check', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const ledger = createMutationVerificationLedger();
    clearPendingMutations(ledger, now - 60_000);
    recordFileMutation(ledger, 'Write', now - 10_000);
    const tips = buildPendingMutationSoftTips(ledger, now);
    expect(tips.join('\n')).toContain(MUTATION_SENSOR_GOAL_DONE_TIP);
    expect(tips.join('\n')).toContain('Write');
  });

  it('suppresses soft tips after a later green check', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const ledger = createMutationVerificationLedger();
    recordFileMutation(ledger, 'Edit', now - 30_000);
    clearPendingMutations(ledger, now - 5_000);
    // clear empties pending; re-seed a mutation then pass after it.
    recordFileMutation(ledger, 'Edit', now - 20_000);
    clearPendingMutations(ledger, now);
    expect(buildPendingMutationSoftTips(ledger, now)).toHaveLength(0);
  });

  it('derives packageDir from packages/apps paths only when unanimous', () => {
    expect(
      deriveMutationPackageDir([
        'packages/agent-core/src/sensors/foo.ts',
        'packages/agent-core/src/index.ts',
      ]),
    ).toBe('packages/agent-core');
    expect(
      deriveMutationPackageDir([
        'packages/agent-core/src/a.ts',
        'packages/node-sdk/src/b.ts',
      ]),
    ).toBeUndefined();
    expect(deriveMutationPackageDir(['README.md'])).toBeUndefined();
    expect(
      deriveMutationPackageDir(['/Users/me/code/superliora/packages/agent-core/src/x.ts']),
    ).toBe('packages/agent-core');
  });

  it('extracts paths from Edit/Write args and OpenCode patches', () => {
    expect(
      extractMutationPathsFromToolArgs('Edit', {
        path: 'packages/agent-core/src/foo.ts',
      }),
    ).toEqual(['packages/agent-core/src/foo.ts']);
    expect(extractMutationPathsFromToolArgs('Write', { path: 'apps/liora/src/x.ts' })).toEqual([
      'apps/liora/src/x.ts',
    ]);
    const patch = `*** Begin Patch
*** Update File: packages/agent-core/src/a.ts
@@
-old
+new
*** Add File: packages/agent-core/src/b.ts
+hello
*** End Patch`;
    expect(extractPathsFromOpenCodePatch(patch)).toEqual([
      'packages/agent-core/src/a.ts',
      'packages/agent-core/src/b.ts',
    ]);
    expect(extractMutationPathsFromToolArgs('ApplyPatch', { patch })).toEqual([
      'packages/agent-core/src/a.ts',
      'packages/agent-core/src/b.ts',
    ]);
  });

  it('records packageDir and scopes the PostToolUse nudge when args share one package', () => {
    const ledger = createMutationVerificationLedger();
    const result = observeFileMutationToolResult(
      ledger,
      'Edit',
      { output: 'Replaced 1 occurrence in packages/agent-core/src/foo.ts' },
      { path: 'packages/agent-core/src/foo.ts' },
    );
    expect(ledger.pending[0]?.packageDir).toBe('packages/agent-core');
    const text = typeof result.output === 'string' ? result.output : '';
    expect(text).toContain(formatMutationVerifyNudge('packages/agent-core'));
    expect(text).toContain('packageDir=packages/agent-core');
    expect(text).not.toBe(MUTATION_VERIFY_NUDGE);
  });

  it('keeps generic nudge when package scope is missing or mixed', () => {
    const ledger = createMutationVerificationLedger();
    const result = observeFileMutationToolResult(
      ledger,
      'Write',
      { output: 'Wrote README.md' },
      { path: 'README.md' },
    );
    expect(ledger.pending[0]?.packageDir).toBeUndefined();
    expect(typeof result.output === 'string' ? result.output : '').toContain(MUTATION_VERIFY_NUDGE);
  });

  it('surfaces unanimous packageDir in Goal soft tips', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const ledger = createMutationVerificationLedger();
    recordFileMutation(ledger, 'Edit', now - 5_000, 'packages/agent-core');
    recordFileMutation(ledger, 'Write', now - 1_000, 'packages/agent-core');
    const tips = buildPendingMutationSoftTips(ledger, now);
    expect(tips.join('\n')).toContain('packageDir=packages/agent-core');
    expect(tips.join('\n')).toContain('Scope: packages/agent-core');
  });

  it('omits scoped tip when recent packageDirs disagree', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const ledger = createMutationVerificationLedger();
    recordFileMutation(ledger, 'Edit', now - 5_000, 'packages/agent-core');
    recordFileMutation(ledger, 'Write', now - 1_000, 'apps/liora');
    const tips = buildPendingMutationSoftTips(ledger, now);
    expect(tips.join('\n')).not.toContain('packageDir=');
    expect(tips.join('\n')).toContain('Run RunProjectChecks (or the package test');
  });
});
