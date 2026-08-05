import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REPO_QUERY_LIMIT,
  formatRepoQueryOutput,
  normalizeRepoQueryLimit,
  parseRepoQueryInput,
  softFailRepoQuery,
  validateRepoQueryModeInput,
} from '#/tools/builtin/file/repo-query-core';

describe('normalizeRepoQueryLimit', () => {
  it('defaults to 20 when limit is omitted', () => {
    expect(normalizeRepoQueryLimit(undefined)).toBe(DEFAULT_REPO_QUERY_LIMIT);
  });

  it('preserves an explicit limit', () => {
    expect(normalizeRepoQueryLimit(5)).toBe(5);
  });
});

describe('parseRepoQueryInput', () => {
  it('accepts valid content queries', () => {
    const parsed = parseRepoQueryInput({
      mode: 'content',
      query: 'RepoQueryTool',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.mode).toBe('content');
    expect(parsed.value.query).toBe('RepoQueryTool');
  });

  it('rejects empty query strings', () => {
    const parsed = parseRepoQueryInput({ mode: 'path', query: '' });
    expect(parsed.ok).toBe(false);
  });

  it('requires a file path for outline when query is not path-like', () => {
    const parsed = parseRepoQueryInput({ mode: 'outline', query: 'MyClass' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('outline mode requires path');
  });

  it('accepts outline when query looks like a file path', () => {
    const parsed = parseRepoQueryInput({ mode: 'outline', query: 'src/foo.ts' });
    expect(parsed.ok).toBe(true);
  });
});

describe('validateRepoQueryModeInput', () => {
  it('accepts outline with explicit path', () => {
    expect(
      validateRepoQueryModeInput({ mode: 'outline', query: 'filter', path: 'src/a.ts' }).ok,
    ).toBe(true);
  });
});

describe('formatRepoQueryOutput', () => {
  it('renders structured fields and result lines', () => {
    const output = formatRepoQueryOutput({
      mode: 'content',
      results: ['src/a.ts:1:match'],
      index_status: 'cold',
      took_ms: 12,
      truncated: false,
      next_step: 'Use Read.',
    });
    expect(output).toContain('<repo_query mode="content">');
    expect(output).toContain('index_status: cold');
    expect(output).toContain('took_ms: 12');
    expect(output).toContain('truncated: false');
    expect(output).toContain('- src/a.ts:1:match');
    expect(output).toContain('next_step: Use Read.');
    expect(output).toContain('</repo_query>');
  });

  it('renders derived graph links as copyable memory provenance', () => {
    const output = formatRepoQueryOutput({
      mode: 'symbol',
      results: ['src/a.ts:L4 function save'],
      derived_links: [
        {
          targetKind: 'symbol',
          targetId: 'src/a.ts#L4',
          relation: 'derived:codemap',
          confidence: 0.95,
        },
      ],
      index_status: 'warm',
      took_ms: 1,
      truncated: false,
    });
    expect(output).toContain('derived_links:');
    expect(output).toContain('"target_kind":"symbol"');
    expect(output).toContain('"target_id":"src/a.ts#L4"');
    expect(output).toContain('Memory.remember.links');
  });
});

describe('softFailRepoQuery', () => {
  it('returns cold index status with hints', () => {
    const output = softFailRepoQuery('symbol', 'index cold', 'Try Grep.');
    expect(output).toContain('index_status: cold');
    expect(output).toContain('hint: index cold');
    expect(output).toContain('next_step: Try Grep.');
    expect(output).toContain('results: 0');
  });
});
