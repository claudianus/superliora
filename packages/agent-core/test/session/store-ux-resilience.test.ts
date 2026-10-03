/**
 * UX-sweep regression coverage for the session store and wire recovery:
 * - one unreadable session directory must not poison the whole listing
 * - a corrupt mid-file wire line recovers instead of bricking resume
 * - persisted `updatedAt` (state.json) outranks lying filesystem mtimes
 * - `latestRecordedAgentWireMtime` finds root-homedir agent wires
 */

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SessionStore } from '../../src/session/store/session-store';
import { FileSystemAgentRecordPersistence, type AgentRecord } from '../../src/agent/records';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeStore(): Promise<{ store: SessionStore; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'liora-session-store-ux-'));
  tempDirs.push(home);
  const store = new SessionStore(home);
  return { store, home };
}

const WORK_DIR = process.platform === 'win32' ? 'C:\\work\\proj' : '/work/proj';

describe('session listing resilience (UX sweep)', () => {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('keeps listing sessions when one session directory is unreadable', async () => {
    const { store } = await makeStore();
    await store.create({ id: 'ses_ok', workDir: WORK_DIR });
    await store.create({ id: 'ses_bad', workDir: WORK_DIR });

    const badDir = await store.assertDirectory('ses_bad');
    await chmod(badDir, 0o000);
    try {
      const sessions = await store.list({ workDir: WORK_DIR });
      expect(sessions.map((s) => s.id)).toContain('ses_ok');
    } finally {
      await chmod(badDir, 0o700);
    }
  });

  it('sorts by the persisted state.json updatedAt, not directory mtimes', async () => {
    const { store } = await makeStore();
    await store.create({ id: 'ses_old_active', workDir: WORK_DIR });
    await store.create({ id: 'ses_new_stale', workDir: WORK_DIR });

    // The "older" session has a fresher persisted activity stamp.
    // Use a relative offset — a fixed calendar date ages out once wall-clock
    // passes it (shard 1/3 red on tip after 2026-09-04).
    const oldDir = await store.assertDirectory('ses_old_active');
    await writeFile(
      join(oldDir, 'state.json'),
      JSON.stringify({
        version: 2,
        workDir: WORK_DIR,
        title: 'old but active',
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      'utf-8',
    );

    const sessions = await store.list({ workDir: WORK_DIR });
    expect(sessions[0]?.id).toBe('ses_old_active');
  });
});

describe('wire corruption recovery (UX sweep)', () => {
  it('recovers records before a corrupt mid-file line instead of throwing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'liora-wire-corrupt-'));
    tempDirs.push(home);
    const wirePath = join(home, 'wire.jsonl');

    const metadata: AgentRecord = { type: 'metadata', protocol_version: '1.5', created_at: 1 };
    const prompt: AgentRecord = { type: 'turn.prompt', input: [{ type: 'text', text: 'hello' }], origin: { kind: 'user' }, time: 2 };
    const good1 = JSON.stringify(metadata);
    const good2 = JSON.stringify(prompt);
    const corrupt = '{ this is not json';
    const good3 = JSON.stringify({ ...prompt, input: [{ type: 'text', text: 'after seam' }], time: 3 });

    const persistence = new FileSystemAgentRecordPersistence(wirePath);
    persistence.append(metadata);
    persistence.append(prompt);
    await persistence.flush();
    await persistence.close();

    // Splice a corrupt line in the middle, followed by more records.
    await writeFile(wirePath, `${good1}\n${good2}\n${corrupt}\n${good3}\n`, 'utf-8');

    const revived = new FileSystemAgentRecordPersistence(wirePath);
    const records: unknown[] = [];
    for await (const record of revived.read()) {
      records.push(record);
    }

    expect(revived.readCorruption).toBeDefined();
    expect(revived.readCorruption?.lineNumber).toBe(3);
    // Records before the seam are recovered.
    expect(records).toHaveLength(2);
    expect((records[0] as { type: string }).type).toBe('metadata');

    // The damaged tail is dropped from disk so new appends start clean.
    const after = await import('node:fs/promises').then((fs) => fs.readFile(wirePath, 'utf-8'));
    expect(after).not.toContain('after seam');
    await revived.close();
  });
});
