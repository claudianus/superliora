import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'pathe';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
  createEpisode,
  FileEpisodicMemoryStore,
  renderEpisodicMemorySection,
  type Episode,
} from '../../src/memory/episodic-memory';

describe('episodic-memory — createEpisode', () => {
  it('creates an episode with content hash as id', () => {
    const episode = createEpisode({
      workDir: '/tmp/project',
      goal: 'Fix the compaction bug',
      outcome: 'success',
      insights: ['Auto-compaction was triggering too early'],
    });
    assert.ok(episode.id.length > 0);
    assert.equal(episode.id, episode.contentHash);
    assert.equal(episode.outcome, 'success');
    assert.equal(episode.insights.length, 1);
  });

  it('same content produces same id', () => {
    const input = {
      workDir: '/tmp/project',
      goal: 'Fix the compaction bug',
      outcome: 'success' as const,
      insights: ['Auto-compaction was triggering too early'],
    };
    const e1 = createEpisode(input);
    const e2 = createEpisode(input);
    assert.equal(e1.id, e2.id);
  });

  it('different content produces different id', () => {
    const e1 = createEpisode({ workDir: '/a', goal: 'Goal A', outcome: 'success' });
    const e2 = createEpisode({ workDir: '/b', goal: 'Goal B', outcome: 'success' });
    assert.notEqual(e1.id, e2.id);
  });
});

describe('episodic-memory — FileEpisodicMemoryStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `episodic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('add and retrieve episodes', async () => {
    const store = new FileEpisodicMemoryStore({ storageDir: tmpDir });
    const episode = createEpisode({
      workDir: '/tmp/project',
      goal: 'Fix compaction bug',
      outcome: 'success',
      insights: ['Check the context window threshold'],
      tags: ['compaction', 'bugfix'],
    });
    await store.add(episode);
    assert.equal(store.episodes.length, 1);
    assert.equal(store.episodes[0]!.goal, 'Fix compaction bug');
  });

  it('search finds episodes by goal keywords', async () => {
    const store = new FileEpisodicMemoryStore({ storageDir: tmpDir });
    await store.add(createEpisode({
      workDir: '/tmp/a', goal: 'Fix compaction bug', outcome: 'success',
      insights: ['Threshold was too low'],
    }));
    await store.add(createEpisode({
      workDir: '/tmp/b', goal: 'Add model routing', outcome: 'success',
      insights: ['Route by role'],
    }));

    const results = store.search('compaction');
    assert.equal(results.length, 1);
    assert.ok(results[0]!.goal.includes('compaction'));
  });

  it('search finds episodes by insight keywords', async () => {
    const store = new FileEpisodicMemoryStore({ storageDir: tmpDir });
    await store.add(createEpisode({
      workDir: '/tmp/a', goal: 'Fix bug', outcome: 'success',
      insights: ['The cache hit rate depends on tool order'],
    }));

    const results = store.search('cache hit rate');
    assert.equal(results.length, 1);
  });

  it('getByTag filters by tag', async () => {
    const store = new FileEpisodicMemoryStore({ storageDir: tmpDir });
    await store.add(createEpisode({
      workDir: '/tmp/a', goal: 'Goal 1', outcome: 'success', tags: ['bugfix'],
    }));
    await store.add(createEpisode({
      workDir: '/tmp/b', goal: 'Goal 2', outcome: 'success', tags: ['feature'],
    }));

    const results = store.getByTag('bugfix');
    assert.equal(results.length, 1);
    assert.equal(results[0]!.goal, 'Goal 1');
  });

  it('getByWorkDir filters by work directory', async () => {
    const store = new FileEpisodicMemoryStore({ storageDir: tmpDir });
    await store.add(createEpisode({ workDir: '/tmp/a', goal: 'Goal 1', outcome: 'success' }));
    await store.add(createEpisode({ workDir: '/tmp/b', goal: 'Goal 2', outcome: 'success' }));

    const results = store.getByWorkDir('/tmp/a');
    assert.equal(results.length, 1);
    assert.equal(results[0]!.goal, 'Goal 1');
  });

  it('persists episodes to disk and reloads', async () => {
    const episode = createEpisode({
      workDir: '/tmp/project',
      goal: 'Persistent episode',
      outcome: 'success',
    });

    const store1 = new FileEpisodicMemoryStore({ storageDir: tmpDir });
    await store1.add(episode);

    // Create a new store — should load from disk
    const store2 = new FileEpisodicMemoryStore({ storageDir: tmpDir });
    await store2.load();
    assert.equal(store2.episodes.length, 1);
    assert.equal(store2.episodes[0]!.goal, 'Persistent episode');
  });

  it('does not duplicate episodes with same content hash', async () => {
    const store = new FileEpisodicMemoryStore({ storageDir: tmpDir });
    const input = {
      workDir: '/tmp/project',
      goal: 'Same goal',
      outcome: 'success' as const,
      insights: ['Same insight'],
    };
    await store.add(createEpisode(input));
    await store.add(createEpisode(input));
    assert.equal(store.episodes.length, 1);
  });
});

describe('episodic-memory — renderEpisodicMemorySection', () => {
  it('renders empty string for no episodes', () => {
    assert.equal(renderEpisodicMemorySection([]), '');
  });

  it('renders episode details', () => {
    const episode: Episode = {
      id: 'abc123',
      createdAt: '2026-07-25T00:00:00.000Z',
      workDir: '/tmp/project',
      goal: 'Fix compaction',
      steps: [],
      outcome: 'success',
      insights: ['Check threshold'],
      tags: ['bugfix'],
      contentHash: 'abc123',
    };
    const rendered = renderEpisodicMemorySection([episode]);
    assert.ok(rendered.includes('past_episodes:'));
    assert.ok(rendered.includes('Fix compaction'));
    assert.ok(rendered.includes('Check threshold'));
    assert.ok(rendered.includes('bugfix'));
  });
});