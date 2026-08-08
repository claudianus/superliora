import { describe, expect, it } from 'vitest';

import {
  describeSubagentToolFeedBody,
  subagentToolDetailParts,
} from '#/tui/utils/tools/subagent-tool-detail';

describe('subagentToolDetailParts', () => {
  it('maps structured detail to target + chip parts', () => {
    expect(
      subagentToolDetailParts({ kind: 'edit', path: 'src/a.ts', addedLines: 3, removedLines: 1 }),
    ).toEqual({ target: 'src/a.ts', chip: '+3 -1' });
    expect(subagentToolDetailParts({ kind: 'read', path: 'src/c.ts' })).toEqual({
      target: 'src/c.ts',
      chip: undefined,
    });
    expect(subagentToolDetailParts(undefined)).toEqual({
      target: undefined,
      chip: undefined,
    });
  });
});

describe('describeSubagentToolFeedBody', () => {
  it('composes name, target, and chip into one compact line', () => {
    expect(
      describeSubagentToolFeedBody(
        'Edit',
        { kind: 'edit', path: 'src/a.ts', addedLines: 3, removedLines: 1 },
        undefined,
      ),
    ).toBe('Edit src/a.ts +3 -1');
    expect(
      describeSubagentToolFeedBody('Write', { kind: 'write', path: 'src/b.ts', lines: 1, bytes: 2 }, undefined),
    ).toBe('Write src/b.ts 1 line');
    expect(
      describeSubagentToolFeedBody('Read', { kind: 'read', path: 'src/c.ts' }, undefined),
    ).toBe('Read src/c.ts');
    expect(
      describeSubagentToolFeedBody('Bash', { kind: 'bash', command: 'pnpm test' }, undefined),
    ).toBe('Bash pnpm test');
    expect(
      describeSubagentToolFeedBody('Grep', { kind: 'search', pattern: 'foo.*' }, undefined),
    ).toBe('Grep foo.*');
  });

  it('falls back to a humanized args preview and bare name', () => {
    expect(describeSubagentToolFeedBody('FetchURL', undefined, '{"url":"x"}')).toBe(
      'FetchURL x',
    );
    expect(
      describeSubagentToolFeedBody(
        'WebSearch',
        undefined,
        '{"query":"premium HTML","limit":5}',
      ),
    ).toBe('WebSearch premium HTML');
    expect(describeSubagentToolFeedBody('Tool', undefined, undefined)).toBe('Tool');
  });
});
