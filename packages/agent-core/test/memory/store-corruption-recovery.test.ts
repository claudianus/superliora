import { strict as assert } from 'node:assert';
import { existsSync, promises as fs, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { LioraMemoryStore } from '../../src/memory/store';

describe('LioraMemoryStore — corruption recovery', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = join(
      tmpdir(),
      `liora-memory-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});
  });

  const dbFile = (): string => join(homeDir, 'memory', 'liora-memory.sqlite');
  const memoryDir = (): string => join(homeDir, 'memory');

  /**
   * Overwrite the database and its WAL/SHM sidecars with garbage. Corrupting
   * the main file alone is not enough: while a healthy WAL is present, SQLite
   * legitimately recovers the committed data from the WAL and reports the
   * database as sound — no quarantine should happen in that case.
   */
  const corruptDatabase = (payload: Buffer): void => {
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${dbFile()}${suffix}`;
      if (existsSync(target)) writeFileSync(target, payload);
    }
  };

  it('opens a healthy database without quarantining anything', async () => {
    const store = new LioraMemoryStore({ homeDir });
    await store.remember({ type: 'fact', subject: 'Tea', content: 'User prefers oolong tea.' });

    const reopened = new LioraMemoryStore({ homeDir });
    const rows = await reopened.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.subject, 'Tea');
    assert.equal(
      readdirSync(memoryDir()).some((file) => file.includes('.corrupt-')),
      false,
      'healthy opens must not leave quarantine artifacts',
    );
  });

  it('quarantines a corrupt database and rebuilds from the records mirror', async () => {
    const store = new LioraMemoryStore({ homeDir });
    const record = await store.remember({
      type: 'fact',
      subject: 'Editor',
      content: 'User edits in Neovim.',
    });

    // Smash the SQLite header so the next open sees "file is not a database".
    corruptDatabase(Buffer.from('this is definitely not a sqlite database file'));

    const healed = new LioraMemoryStore({ homeDir });
    const rows = await healed.list();
    assert.equal(rows.length, 1, 'records mirror should repopulate the fresh database');
    assert.equal(rows[0]?.id, record.id);
    assert.equal(rows[0]?.content, 'User edits in Neovim.');

    const quarantined = readdirSync(memoryDir()).filter((file) =>
      file.startsWith('liora-memory.sqlite.corrupt-'),
    );
    assert.ok(quarantined.length > 0, 'expected the corrupt file to be quarantined, not deleted');
    assert.ok(existsSync(dbFile()), 'expected a fresh database at the original path');

    // The rebuilt store is fully writable, not a limp read-only fallback.
    await healed.remember({ type: 'event', subject: 'Aftermath', content: 'Recovery verified.' });
    assert.equal((await healed.list()).length, 2);
  });

  it('rejects a database that keeps the magic header but loses its pages', async () => {
    const store = new LioraMemoryStore({ homeDir });
    await store.remember({ type: 'procedure', subject: 'Deploy', content: 'Deploy via pnpm release.' });

    // Magic header intact, every page garbage: the probe must refuse the file
    // instead of trusting a database that only looks plausible.
    const garbage = Buffer.alloc(4096, 0x2f);
    Buffer.from('SQLite format 3\u0000').copy(garbage);
    corruptDatabase(garbage);

    const healed = new LioraMemoryStore({ homeDir });
    const rows = await healed.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.subject, 'Deploy');
    assert.ok(
      readdirSync(memoryDir()).some((file) => file.startsWith('liora-memory.sqlite.corrupt-')),
      'expected quick_check failure to quarantine the file',
    );
  });
});
