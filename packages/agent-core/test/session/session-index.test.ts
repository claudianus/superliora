import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'pathe';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendSessionIndexEntry,
  compactSessionIndex,
  readSessionIndex,
  sessionIndexLegacyPath,
  sessionIndexPath,
  upsertSessionIndexEntry,
} from '../../src/session/store/session-index';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'liora-session-index-'));
  tempDirs.push(home);
  return home;
}

describe('session index layout', () => {
  it('appends under sessions/index.jsonl', async () => {
    const home = await makeHome();
    const sessionsDir = join(home, 'sessions');
    const sessionDir = join(sessionsDir, 'wd_test', 'ses_write');
    await mkdir(sessionDir, { recursive: true });

    await appendSessionIndexEntry(home, {
      sessionId: 'ses_write',
      sessionDir,
      workDir: '/tmp/work',
    });

    const raw = await readFile(sessionIndexPath(home), 'utf-8');
    expect(raw).toContain('"sessionId":"ses_write"');
    await expect(readFile(sessionIndexLegacyPath(home), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reads leftover session_index.jsonl and lets the new file win', async () => {
    const home = await makeHome();
    const sessionsDir = join(home, 'sessions');
    const legacyDir = join(sessionsDir, 'wd_legacy', 'ses_merge');
    const currentDir = join(sessionsDir, 'wd_current', 'ses_merge');
    await mkdir(legacyDir, { recursive: true });
    await mkdir(currentDir, { recursive: true });

    await writeFile(
      sessionIndexLegacyPath(home),
      `${JSON.stringify({
        sessionId: 'ses_merge',
        sessionDir: legacyDir,
        workDir: '/tmp/legacy',
      })}\n`,
      'utf-8',
    );
    await writeFile(
      sessionIndexPath(home),
      `${JSON.stringify({
        sessionId: 'ses_merge',
        sessionDir: currentDir,
        workDir: '/tmp/current',
      })}\n`,
      'utf-8',
    );

    const index = await readSessionIndex(home, sessionsDir);
    expect(index.get('ses_merge')).toEqual({
      sessionId: 'ses_merge',
      sessionDir: resolve(currentDir),
      workDir: '/tmp/current',
    });
  });

  it('compacts duplicate lines onto sessions/index.jsonl and drops the leftover file', async () => {
    const home = await makeHome();
    const sessionsDir = join(home, 'sessions');
    const sessionDir = join(sessionsDir, 'wd_test', 'ses_compact');
    await mkdir(sessionDir, { recursive: true });

    const stale = `${JSON.stringify({
      sessionId: 'ses_compact',
      sessionDir,
      workDir: '/tmp/old',
    })}\n`;
    const fresh = `${JSON.stringify({
      sessionId: 'ses_compact',
      sessionDir,
      workDir: '/tmp/new',
    })}\n`;
    await writeFile(sessionIndexLegacyPath(home), stale + stale, 'utf-8');
    await writeFile(sessionIndexPath(home), stale + fresh, 'utf-8');

    expect(await compactSessionIndex(home, sessionsDir)).toBe(1);

    const raw = await readFile(sessionIndexPath(home), 'utf-8');
    expect(raw.trim().split(/\r?\n/)).toHaveLength(1);
    expect(raw).toContain('/tmp/new');
    await expect(readFile(sessionIndexLegacyPath(home), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('upserts a last-wins snapshot and drops leftover index lines', async () => {
    const home = await makeHome();
    const sessionsDir = join(home, 'sessions');
    const sessionDir = join(sessionsDir, 'wd_test', 'ses_upsert');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      sessionIndexLegacyPath(home),
      `${JSON.stringify({
        sessionId: 'ses_upsert',
        sessionDir,
        workDir: '/tmp/old',
      })}\n`,
      'utf-8',
    );

    await upsertSessionIndexEntry(home, sessionsDir, {
      sessionId: 'ses_upsert',
      sessionDir,
      workDir: '/tmp/new',
    });

    const raw = await readFile(sessionIndexPath(home), 'utf-8');
    expect(raw.trim().split(/\r?\n/)).toHaveLength(1);
    expect(raw).toContain('/tmp/new');
    await expect(readFile(sessionIndexLegacyPath(home), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
