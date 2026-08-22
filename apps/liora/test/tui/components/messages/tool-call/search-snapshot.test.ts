import { describe, expect, it } from 'vitest';

import {
  buildToolCallSearchSnapshot,
  extractSearchSubject,
  resolveSearchHitKind,
} from '#/tui/components/messages/tool-call/search-snapshot';

describe('search-snapshot', () => {
  it('marks pending when no result has landed', () => {
    expect(
      buildToolCallSearchSnapshot({
        toolCallId: 'g1',
        name: 'Grep',
        args: { pattern: 'TODO' },
        result: undefined,
        workspaceDir: '/tmp/proj',
      }),
    ).toEqual({
      toolCallId: 'g1',
      name: 'Grep',
      kind: 'search',
      subject: 'TODO',
      phase: 'pending',
      hits: 0,
      hitKind: 'match',
    });
  });

  it('counts Grep matches and Glob files from non-empty result lines', () => {
    expect(
      buildToolCallSearchSnapshot({
        toolCallId: 'g1',
        name: 'Grep',
        args: { pattern: 'foo' },
        result: { tool_call_id: 'g1', output: 'a.ts:1:foo\nb.ts:2:foo\n', is_error: false },
        workspaceDir: '/tmp/proj',
      }).hits,
    ).toBe(2);

    const glob = buildToolCallSearchSnapshot({
      toolCallId: 'gl1',
      name: 'Glob',
      args: { pattern: '**/*.ts', path: '/tmp/proj/src' },
      result: { tool_call_id: 'gl1', output: 'src/a.ts\nsrc/b.ts\n', is_error: false },
      workspaceDir: '/tmp/proj',
    });
    expect(glob.kind).toBe('search');
    expect(glob.hitKind).toBe('file');
    expect(glob.hits).toBe(2);
    expect(glob.subject).toContain('**/*.ts');
    expect(glob.subject).toContain('src');
  });

  it('treats LS as a directory listing with file hits', () => {
    const snap = buildToolCallSearchSnapshot({
      toolCallId: 'ls1',
      name: 'LS',
      args: { path: '/tmp/proj/src' },
      result: { tool_call_id: 'ls1', output: 'a.ts\nb.ts\n', is_error: false },
      workspaceDir: '/tmp/proj',
    });
    expect(snap.kind).toBe('dir');
    expect(snap.hitKind).toBe('file');
    expect(snap.hits).toBe(2);
    expect(snap.phase).toBe('done');
  });

  it('zeros hits on failure', () => {
    expect(
      buildToolCallSearchSnapshot({
        toolCallId: 'g1',
        name: 'Grep',
        args: { pattern: 'x' },
        result: { tool_call_id: 'g1', output: 'boom', is_error: true },
        workspaceDir: undefined,
      }),
    ).toMatchObject({ phase: 'failed', hits: 0, hitKind: 'match' });
  });

  it('resolves hit kinds and subject fallbacks', () => {
    expect(resolveSearchHitKind('Grep', 'search')).toBe('match');
    expect(resolveSearchHitKind('Glob', 'search')).toBe('file');
    expect(resolveSearchHitKind('LS', 'dir')).toBe('file');
    expect(extractSearchSubject('LS', { path: 'apps' }, undefined)).toBe('apps');
    expect(extractSearchSubject('SemanticSearch', { query: 'auth flow' }, undefined)).toBe(
      'auth flow',
    );
  });
});
