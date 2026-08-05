import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { LioraMemoryStore } from '../../src/memory';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('Liora Memory migrations', () => {
  it('moves the legacy sqlite filename and keeps records searchable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liora-memory-migration-'));
    roots.push(root);
    const legacyPath = join(root, 'memory', 'kimi-recall.sqlite');
    const legacy = new LioraMemoryStore({
      homeDir: root,
      config: () => ({ storePath: legacyPath }),
    });
    const saved = await legacy.remember({
      type: 'fact',
      scope: 'user',
      subject: 'legacy preference',
      content: 'The old store record must remain searchable after migration.',
    });

    const migrated = new LioraMemoryStore({ homeDir: root });
    const results = await migrated.recall({ query: 'legacy preference', scope: 'user', limit: 3 });

    expect(migrated.getStorePath()).toBe(join(root, 'memory', 'liora-memory.sqlite'));
    expect(existsSync(legacyPath)).toBe(false);
    expect(results[0]?.memory.id).toBe(saved.id);
  });

  it('imports legacy markdown markers and JSON episodes into canonical memory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liora-memory-migration-'));
    roots.push(root);
    const recordsDir = join(root, 'memory', 'records');
    const episodesDir = join(root, 'memory', 'episodes');
    mkdirSync(recordsDir, { recursive: true });
    mkdirSync(episodesDir, { recursive: true });

    const legacyRecord = {
      id: 'legacy-markdown',
      kind: 'semantic',
      scope: 'user',
      subject: 'legacy markdown fact',
      content: 'This v1 markdown record should become a fact.',
      tags: ['legacy'],
      confidence: 0.8,
      importance: 0.6,
      status: 'active',
      source: { kind: 'user' },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      accessCount: 0,
      supersedes: [],
      metadata: {},
    };
    const encoded = Buffer.from(JSON.stringify(legacyRecord), 'utf8').toString('base64url');
    writeFileSync(
      join(recordsDir, 'legacy-markdown.md'),
      `# legacy\n\n<!-- kimi-recall-record-json-base64:${encoded} -->\n`,
      'utf8',
    );
    writeFileSync(
      join(episodesDir, 'episode-1.json'),
      JSON.stringify({
        id: 'episode-1',
        goal: 'migrate an episode',
        outcome: 'completed',
        insights: ['The episode is now canonical memory.'],
        steps: [{ description: 'write migration' }],
        session_id: 'run-1',
      }),
      'utf8',
    );

    const store = new LioraMemoryStore({ homeDir: root });
    const markdown = await store.get('legacy-markdown');
    const episode = await store.get('episode-episode-1');

    expect(markdown?.type).toBe('fact');
    expect(markdown?.epistemic).toBe('direct');
    expect(episode).toMatchObject({
      type: 'event',
      epistemic: 'summary',
      source: { kind: 'import' },
    });
    const canonicalMirror = readdirSync(recordsDir).find((file) => file.startsWith('memory_'));
    expect(canonicalMirror).toBeDefined();
    expect(readFileSync(join(recordsDir, canonicalMirror!), 'utf8')).toContain('liora-memory-record-json-base64');
    expect(existsSync(join(episodesDir, 'episode-1.json'))).toBe(true);
  });
});
