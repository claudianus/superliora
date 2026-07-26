import { describe, expect, it } from 'vitest';

import {
  workspaceCreateSchema,
  workspaceIdSchema,
  workspaceSchema,
  workspaceUpdateSchema,
} from '../workspace';

describe('protocol/workspace — zod schemas', () => {
  it('workspaceIdSchema accepts a wd_<slug>_<12-hex> literal', () => {
    expect(workspaceIdSchema.parse('wd_superliora_5eccc730425f')).toBe('wd_superliora_5eccc730425f');
  });

  it('workspaceIdSchema rejects malformed ids', () => {
    expect(() => workspaceIdSchema.parse('not-a-workspace-id')).toThrow();
    expect(() => workspaceIdSchema.parse('wd_short')).toThrow();
    expect(() => workspaceIdSchema.parse('wd_superliora_zzzzzzzzzzzz')).toThrow();
  });

  it('workspaceCreateSchema accepts a minimal create payload with just root', () => {
    const created = workspaceCreateSchema.parse({ root: '/tmp/project' });
    expect(created.root).toBe('/tmp/project');
  });

  it('workspaceCreateSchema rejects an empty root', () => {
    expect(() => workspaceCreateSchema.parse({ root: '' })).toThrow();
  });

  it('workspaceUpdateSchema requires a non-empty name within 100 chars', () => {
    expect(workspaceUpdateSchema.parse({ name: 'ok' }).name).toBe('ok');
    expect(() => workspaceUpdateSchema.parse({ name: '' })).toThrow();
    expect(() => workspaceUpdateSchema.parse({ name: 'a'.repeat(101) })).toThrow();
  });

  it('workspaceSchema accepts a fully populated record', () => {
    const ws = workspaceSchema.parse({
      id: 'wd_superliora_5eccc730425f',
      root: '/tmp/project',
      name: 'project',
      is_git_repo: true,
      branch: 'main',
      created_at: '2024-01-01T00:00:00.000Z',
      last_opened_at: '2024-01-02T00:00:00.000Z',
      session_count: 3,
    });
    expect(ws.is_git_repo).toBe(true);
    expect(ws.branch).toBe('main');
  });

  it('workspaceSchema rejects a negative session_count', () => {
    expect(() =>
      workspaceSchema.parse({
        id: 'wd_superliora_5eccc730425f',
        root: '/tmp/project',
        name: 'project',
        is_git_repo: false,
        branch: null,
        created_at: '2024-01-01T00:00:00.000Z',
        last_opened_at: '2024-01-01T00:00:00.000Z',
        session_count: -1,
      }),
    ).toThrow();
  });
});
