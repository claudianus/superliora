import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { promises as fs, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { LioraMemoryStore } from '../../src/memory/store';

interface SqliteHandle {
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
}

/** Open a second, out-of-band handle on the store's database file. */
const openSqlite = (path: string): SqliteHandle => {
  const require = createRequire(import.meta.url);
  const sqlite = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteHandle };
  return new sqlite.DatabaseSync(path);
};

describe('LioraMemoryStore — integrity checking', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = join(
      tmpdir(),
      `liora-memory-integrity-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});
  });

  const recordsDir = (): string => join(homeDir, 'memory', 'records');

  it('reports a healthy store as ok with no issues', async () => {
    const store = new LioraMemoryStore({ homeDir });
    await store.remember({ type: 'fact', subject: 'Tea', content: 'User prefers oolong tea.' });
    await store.remember({ type: 'procedure', subject: 'Deploy', content: 'Deploy via pnpm release.' });

    const report = store.checkIntegrity();
    assert.equal(report.ok, true);
    assert.deepEqual(report.issues, []);
    assert.equal(report.repaired, undefined);

    const withRepair = store.checkIntegrity({ repair: true });
    assert.equal(withRepair.ok, true);
    assert.deepEqual(withRepair.issues, []);
    assert.equal(withRepair.repaired, false, 'nothing to repair in a healthy store');
  });

  it('detects a row deleted out-of-band and repairs it from the mirror', async () => {
    const store = new LioraMemoryStore({ homeDir });
    await store.remember({ type: 'fact', subject: 'Kept', content: 'Stays in the database.' });
    const lost = await store.remember({
      type: 'fact',
      subject: 'Lost',
      content: 'Deleted out-of-band.',
    });

    // Delete one row behind the store's back; the markdown mirror keeps it.
    const db = openSqlite(store.getStorePath());
    db.prepare('DELETE FROM memories WHERE id = ?').run(lost.id);
    db.close();

    const before = store.checkIntegrity();
    assert.equal(before.ok, false);
    assert.equal(before.repaired, undefined);
    assert.ok(
      before.issues.some((issue) => issue.includes('record count mismatch')),
      `expected a count mismatch issue, got: ${JSON.stringify(before.issues)}`,
    );
    assert.ok(
      before.issues.some((issue) => issue.includes('missing database records') && issue.includes(lost.id)),
      `expected the missing record id in issues, got: ${JSON.stringify(before.issues)}`,
    );

    const repair = store.checkIntegrity({ repair: true });
    assert.equal(repair.repaired, true, 'the mirrored record should be restored');

    const after = store.checkIntegrity();
    assert.equal(after.ok, true);
    assert.deepEqual(after.issues, []);
    assert.equal((await store.get(lost.id))?.content, 'Deleted out-of-band.');
    assert.equal((await store.list()).length, 2);
  });

  it('reports a count mismatch caused by an orphan mirror file', async () => {
    const store = new LioraMemoryStore({ homeDir });
    await store.remember({ type: 'fact', subject: 'Solo', content: 'Only real record.' });

    // Drop a parseable mirror file with no matching database row.
    const orphanId = randomUUID();
    const orphanRecord = {
      id: orphanId,
      type: 'fact',
      epistemic: 'direct',
      scope: 'user',
      subject: 'Orphan',
      content: 'Mirror file without a database row.',
      tags: [] as string[],
      confidence: 0.5,
      importance: 0.5,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      recordedAt: Date.now(),
      accessCount: 0,
      supersedes: [],
      source: { kind: 'system' },
      evidenceRefs: [],
      links: [],
      metadata: {},
    };
    const encoded = Buffer.from(JSON.stringify(orphanRecord), 'utf8').toString('base64url');
    const stem = `memory_${Buffer.from(orphanId, 'utf8').toString('base64url')}`;
    writeFileSync(
      join(recordsDir(), `${stem}.md`),
      `# Orphan\n\n<!-- liora-memory-record-json-base64:${encoded} -->\n`,
      'utf8',
    );

    const report = store.checkIntegrity();
    assert.equal(report.ok, false);
    assert.ok(
      report.issues.some((issue) => issue.includes('record count mismatch')),
      `expected a count mismatch issue, got: ${JSON.stringify(report.issues)}`,
    );
    assert.ok(
      report.issues.some((issue) => issue.includes(orphanId)),
      `expected the orphan id in issues, got: ${JSON.stringify(report.issues)}`,
    );
  });

  it('warns at open on a persistent count mismatch but never throws', async () => {
    const store = new LioraMemoryStore({ homeDir });
    await store.remember({ type: 'fact', subject: 'Tea', content: 'User prefers oolong tea.' });

    // An unparseable stray file the mirror restore cannot absorb, so the
    // mismatch survives the constructor's restore pass.
    writeFileSync(join(recordsDir(), 'stray.md'), 'not a memory record\n', 'utf8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reopened = new LioraMemoryStore({ homeDir });
    assert.equal((await reopened.list()).length, 1, 'open must succeed and keep the data');
    assert.ok(
      warn.mock.calls.some((args) => String(args[0]).includes('records/ mirror has 2 markdown files')),
      'expected a count mismatch warning from the on-open check',
    );
  });
});
