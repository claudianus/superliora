import { describe, expect, it } from 'vitest';

import {
  buildSubagentResultContract,
  computeFilesChanged,
  formatSubagentResultEnvelope,
  renderSubagentCompletionText,
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
});
