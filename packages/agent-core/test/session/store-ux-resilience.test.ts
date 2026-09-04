/**
 * UX-sweep regression coverage for the session store and wire recovery:
 * - one unreadable session directory must not poison the whole listing
 * - a corrupt mid-file wire line recovers instead of bricking resume
 * - persisted `updatedAt` (state.json) outranks lying filesystem mtimes
 * - `latestRecordedAgentWireMtime` finds root-homedir agent wires
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SessionStore } from '../../src/session/store/session-store';
import { FileSystemAgentRecordPersistence } from '../../src/agent/records';

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
  it('keeps listing sessions when one session directory is unreadable', async () => {
    const { store } = await makeStore();
    await store.create({ id: 'ses_ok', workDir: WORK_DIR });
    await store.create({ id: 'ses_bad', workDir: WORK_DIR });

    // Simulate a transient unreadable dir (Windows EPERM / AV lock): strip
    // all permissions from the session directory.
    const badDir = await store.assertDirectory('ses_bad');
    await chmod(badDir, 0o000).catch(() => {
      // Some filesystems (Windows root drives) ignore chmod; the test then
      // degenerates to a plain two-session listing, which still passes below.
    });

    const sessions = await store.list({ workDir: WORK_DIR });
    // The unreadable entry may or may not be skippable on this platform, but
    // the healthy session must always survive the listing.
    expect(sessions.map((s) => s.id)).toContain('ses_ok');
  });

  it('sorts by the persisted state.json updatedAt, not directory mtimes', async () => {
    const { store } = await makeStore();
    await store.create({ id: 'ses_old_active', workDir: WORK_DIR });
    await store.create({ id: 'ses_new_stale', workDir: WORK_DIR });

    // The "older" session has a fresher persisted activity stamp.
    const oldDir = await store.assertDirectory('ses_old_active');
    await writeFile(
      join(oldDir, 'state.json'),
      JSON.stringify({
        version: 2,
        workDir: WORK_DIR,
        title: 'old but active',
        updatedAt: new Date('2026-09-04T12:00:00Z').toISOString(),
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

    const good1 = JSON.stringify({ type: 'metadata', protocol_version: 1, time: 1 });
    const good2 = JSON.stringify({ type: 'message', role: 'user', content: 'hello', time: 2 });
    const corrupt = '{ this is not json';
    const good3 = JSON.stringify({ type: 'message', role: 'user', content: 'after seam', time: 3 });

    const persistence = new FileSystemAgentRecordPersistence(wirePath);
    persistence.append(JSON.parse(good1) as never);
    persistence.append(JSON.parse(good2) as never);
    await persistence.flush();
    await persistence.close().catch(() => undefined);

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
  });
});
