import { describe, expect, it } from 'vitest';

import {
  autopilotCardSchema,
  autopilotCardSourceSchema,
  autopilotCardStatusSchema,
  autopilotRunSchema,
} from '../autopilot';
import {
  memoryKindSchema,
  memoryRecordSchema,
  memoryScopeSchema,
  memorySearchResultSchema,
  memoryStatusSchema,
} from '../memory';

describe('protocol/autopilot — zod schemas', () => {
  it('autopilotCardSourceSchema accepts the canonical set', () => {
    for (const v of ['github-issue', 'github-pr', 'manual', 'cron-scan']) {
      expect(autopilotCardSourceSchema.parse(v)).toBe(v);
    }
    expect(() => autopilotCardSourceSchema.parse('other')).toThrow();
  });

  it('autopilotCardStatusSchema accepts the full lifecycle set', () => {
    for (const v of [
      'queued',
      'running',
      'verifying',
      'pr-open',
      'merged',
      'failed',
      'skipped',
    ]) {
      expect(autopilotCardStatusSchema.parse(v)).toBe(v);
    }
  });

  it('autopilotCardSchema accepts a minimal card', () => {
    const card = autopilotCardSchema.parse({
      id: 'card-1',
      source: 'manual',
      title: 't',
      body: 'b',
      fingerprint: 'fp',
      score: 0.5,
      status: 'queued',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      attempts: 0,
    });
    expect(card.id).toBe('card-1');
    expect(card.attempts).toBe(0);
  });

  it('autopilotCardSchema rejects a missing required field', () => {
    expect(() =>
      autopilotCardSchema.parse({
        id: 'card-1',
        source: 'manual',
        title: 't',
        body: 'b',
        fingerprint: 'fp',
        score: 0.5,
        status: 'queued',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    ).toThrow();
  });

  it('autopilotRunSchema accepts a minimal run', () => {
    const run = autopilotRunSchema.parse({
      id: 'run-1',
      cardId: 'card-1',
      status: 'running',
      worktreePath: '/w',
      branch: 'main',
      attempt: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(run.status).toBe('running');
  });
});

describe('protocol/memory — zod schemas', () => {
  it('memoryKindSchema accepts the canonical kinds', () => {
    for (const v of [
      'semantic',
      'episodic',
      'procedural',
      'prospective',
      'governance',
    ]) {
      expect(memoryKindSchema.parse(v)).toBe(v);
    }
    expect(() => memoryKindSchema.parse('weird')).toThrow();
  });

  it('memoryScopeSchema accepts the canonical scopes', () => {
    for (const v of ['user', 'workspace', 'session']) {
      expect(memoryScopeSchema.parse(v)).toBe(v);
    }
  });

  it('memoryStatusSchema accepts the canonical statuses', () => {
    for (const v of ['active', 'archived', 'superseded', 'deleted']) {
      expect(memoryStatusSchema.parse(v)).toBe(v);
    }
  });

  it('memoryRecordSchema accepts a minimal record', () => {
    const rec = memoryRecordSchema.parse({
      id: 'm-1',
      kind: 'semantic',
      scope: 'user',
      subject: 's',
      content: 'c',
      tags: ['a'],
      confidence: 0.9,
      importance: 0.5,
      status: 'active',
      source: { kind: 'user' },
      created_at: 1,
      updated_at: 1,
      access_count: 0,
      supersedes: [],
      metadata: {},
    });
    expect(rec.id).toBe('m-1');
  });

  it('memorySearchResultSchema wraps a record with score and reasons', () => {
    const rec = memoryRecordSchema.parse({
      id: 'm-1',
      kind: 'semantic',
      scope: 'user',
      subject: 's',
      content: 'c',
      tags: ['a'],
      confidence: 0.9,
      importance: 0.5,
      status: 'active',
      source: { kind: 'user' },
      created_at: 1,
      updated_at: 1,
      access_count: 0,
      supersedes: [],
      metadata: {},
    });
    const result = memorySearchResultSchema.parse({
      memory: rec,
      score: 0.7,
      reasons: ['tag match'],
    });
    expect(result.score).toBe(0.7);
    expect(result.reasons).toEqual(['tag match']);
  });
});
