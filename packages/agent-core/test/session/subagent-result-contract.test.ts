import { describe, expect, it } from 'vitest';

import {
  buildSubagentResultContract,
  computeFilesChanged,
  deriveVerificationPackageDir,
  formatSubagentResultEnvelope,
  renderSubagentCompletionText,
  verdictFromCheckOutcomes,
  VERIFICATION_NOT_RUN,
} from '../../src/session/subagent-result-contract';

describe('subagent-result-contract — computeFilesChanged', () => {
  it('merges committed and dirty files, sorted and de-duplicated', () => {
    expect(
      computeFilesChanged({
        committedChanged: ['src/b.ts', 'src/a.ts'],
        dirtyBefore: [],
        dirtyNow: ['src/a.ts', 'src/c.ts'],
      }),
    ).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('excludes files that were already dirty before the child started', () => {
    expect(
      computeFilesChanged({
        committedChanged: ['src/child.ts'],
        dirtyBefore: ['plan/parent-wip.md'],
        dirtyNow: ['plan/parent-wip.md', 'src/child.ts'],
      }),
    ).toEqual(['src/child.ts']);
  });

  it('caps the list at 100 entries', () => {
    const many = Array.from({ length: 150 }, (_, i) => `f${String(i).padStart(3, '0')}.ts`);
    expect(computeFilesChanged({ committedChanged: many, dirtyBefore: [], dirtyNow: [] })).toHaveLength(100);
  });
});

describe('subagent-result-contract — build + format', () => {
  it('defaults verification to not_run and deviations to empty', () => {
    const contract = buildSubagentResultContract({
      agentId: 'agent-1',
      profile: 'coder',
      summary: 'did the thing',
      filesChanged: ['a.ts'],
    });
    expect(contract.status).toBe('completed');
    expect(contract.verification).toEqual(VERIFICATION_NOT_RUN);
    expect(contract.deviations).toEqual([]);
    expect(contract.files_changed).toEqual(['a.ts']);
  });

  it('renders a parseable envelope without duplicating the summary', () => {
    const contract = buildSubagentResultContract({
      agentId: 'agent-2',
      profile: 'explore',
      summary: 'mapped the pipeline',
      filesChanged: [],
    });
    const envelope = formatSubagentResultEnvelope(contract);
    expect(envelope.startsWith('<subagent-result>\n')).toBe(true);
    expect(envelope.endsWith('\n</subagent-result>')).toBe(true);
    const json = envelope.slice('<subagent-result>\n'.length, -'\n</subagent-result>'.length);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['agent_id']).toBe('agent-2');
    expect(parsed['profile']).toBe('explore');
    expect(parsed['verification']).toEqual(VERIFICATION_NOT_RUN);
    expect(parsed).not.toHaveProperty('summary');
  });

  it('renderSubagentCompletionText passes through when no contract is attached', () => {
    expect(renderSubagentCompletionText({ result: 'plain summary' })).toBe('plain summary');
  });

  it('renderSubagentCompletionText appends the envelope when a contract is attached', () => {
    const contract = buildSubagentResultContract({
      agentId: 'agent-3',
      profile: 'coder',
      summary: 'done',
      filesChanged: ['x.ts'],
    });
    const rendered = renderSubagentCompletionText({ result: 'done', contract });
    expect(rendered.startsWith('done\n\n<subagent-result>')).toBe(true);
    expect(rendered).toContain('"x.ts"');
  });

  it('flags verification_failed when any verdict failed', () => {
    const failed = buildSubagentResultContract({
      agentId: 'agent-4',
      profile: 'coder',
      summary: 'done',
      filesChanged: [],
      verification: { tests: 'failed', typecheck: 'passed', lint: 'not_run' },
    });
    expect(failed.verification_failed).toBe(true);
    const clean = buildSubagentResultContract({
      agentId: 'agent-5',
      profile: 'coder',
      summary: 'done',
      filesChanged: [],
      verification: { tests: 'passed', typecheck: 'passed', lint: 'passed' },
    });
    expect(clean.verification_failed).toBe(false);
  });
});

describe('subagent-result-contract — deriveVerificationPackageDir', () => {
  it('returns the shared package dir for a single-package change set', () => {
    expect(
      deriveVerificationPackageDir(['packages/agent-core/src/a.ts', 'packages/agent-core/test/b.test.ts']),
    ).toBe('packages/agent-core');
    expect(deriveVerificationPackageDir(['apps/liora/src/tui/c.ts'])).toBe('apps/liora');
  });

  it('returns undefined for empty, multi-package, or out-of-layout change sets', () => {
    expect(deriveVerificationPackageDir([])).toBeUndefined();
    expect(
      deriveVerificationPackageDir(['packages/agent-core/a.ts', 'packages/kaos/b.ts']),
    ).toBeUndefined();
    expect(deriveVerificationPackageDir(['packages/agent-core/a.ts', 'README.md'])).toBeUndefined();
  });
});

describe('subagent-result-contract — verdictFromCheckOutcomes', () => {
  const outcomes = [
    { name: 'test', exitCode: 0 },
    { name: 'typecheck', exitCode: 1 },
    { name: 'lint', exitCode: 0, skipped: true },
  ];

  it('maps exit codes and skipped checks onto verdicts', () => {
    expect(verdictFromCheckOutcomes(outcomes, 'test')).toBe('passed');
    expect(verdictFromCheckOutcomes(outcomes, 'typecheck')).toBe('failed');
    expect(verdictFromCheckOutcomes(outcomes, 'lint')).toBe('not_run');
  });

  it('returns not_run when the check is absent', () => {
    expect(verdictFromCheckOutcomes([], 'test')).toBe('not_run');
  });
});
