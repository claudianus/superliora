import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { join as joinPosix } from 'pathe';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalKaos } from '@superliora/kaos';

import { SESSION_STATE_VERSION } from '../../src/session/lifecycle/session-types';
import type { Logger } from '../../src/logging/types';
import { SessionMetadataPersistence } from '../../src/session/metadata-persistence';
import {
  LAST_PROMPT_MAX_CHARS,
  prepareSessionMetaForWrite,
  prepareSessionStateRecord,
  resolveSessionMetaHomedirs,
  truncateLastPrompt,
} from '../../src/session/session-meta-format';
import {
  readRequiredSessionState,
  writeSessionStateFile,
} from '../../src/session/store/session-state-io';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liora-session-state-'));
  tempDirs.push(dir);
  return dir;
}

describe('session meta format', () => {
  it('stamps version, caps lastPrompt, and drops custom.goal', () => {
    const prepared = prepareSessionMetaForWrite({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'New Session',
      isCustomTitle: false,
      lastPrompt: 'x'.repeat(LAST_PROMPT_MAX_CHARS + 20),
      agents: {},
      custom: { sandboxProfile: 'workspace', goal: { goalId: 'g1' } },
    });

    expect(prepared.version).toBe(SESSION_STATE_VERSION);
    expect(prepared.lastPrompt).toHaveLength(LAST_PROMPT_MAX_CHARS);
    expect(prepared.custom).toEqual({ sandboxProfile: 'workspace' });
  });

  it('keeps unknown top-level keys on store records', () => {
    expect(
      prepareSessionStateRecord({
        session_id: 'ses_legacy',
        nested: { enabled: true },
        lastPrompt: 'ok',
        custom: { cwd: '/tmp/work', goal: { id: 'drop' } },
      }),
    ).toEqual({
      session_id: 'ses_legacy',
      nested: { enabled: true },
      lastPrompt: 'ok',
      custom: { cwd: '/tmp/work' },
      version: SESSION_STATE_VERSION,
    });
  });

  it('leaves short lastPrompt text unchanged', () => {
    expect(truncateLastPrompt('hello')).toBe('hello');
  });

  it('persists agent homedirs relative to the session directory', () => {
    const sessionDir = '/tmp/sessions/wd_x/ses_a';
    const prepared = prepareSessionMetaForWrite(
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        title: 'New Session',
        isCustomTitle: false,
        agents: {
          main: {
            homedir: `${sessionDir}/agents/main`,
            type: 'main',
            parentAgentId: null,
          },
        },
        custom: {},
      },
      sessionDir,
    );
    expect(prepared.agents['main']?.homedir).toBe('agents/main');
  });

  it('keeps an already-relative agent homedir and resolves it back', async () => {
    const sessionDir = await makeDir();
    const prepared = prepareSessionMetaForWrite(
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        title: 'New Session',
        isCustomTitle: false,
        agents: {
          main: {
            homedir: 'agents/main',
            type: 'main',
            parentAgentId: null,
          },
        },
        custom: {},
      },
      sessionDir,
    );
    expect(prepared.agents['main']?.homedir).toBe('agents/main');

    const resolved = resolveSessionMetaHomedirs(prepared, sessionDir);
    expect(resolved.agents['main']?.homedir).toBe(joinPosix(sessionDir, 'agents', 'main'));
  });

  it('round-trips relative agent homedirs through metadata persistence', async () => {
    const sessionDir = await makeDir();
    const silentLog: Logger = {
      error() {},
      warn() {},
      info() {},
      debug() {},
      createChild() {
        return silentLog;
      },
    };
    const persistence = new SessionMetadataPersistence({
      sessionHomedir: sessionDir,
      kaos: (await LocalKaos.create()).withCwd(sessionDir),
      log: silentLog,
    });
    await persistence.write({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'New Session',
      isCustomTitle: false,
      agents: {
        main: {
          homedir: joinPosix(sessionDir, 'agents', 'main'),
          type: 'main',
          parentAgentId: null,
        },
      },
      custom: {},
    });

    expect(JSON.parse(await readFile(join(sessionDir, 'state.json'), 'utf-8'))).toMatchObject({
      version: SESSION_STATE_VERSION,
      agents: { main: { homedir: 'agents/main' } },
    });
    await expect(persistence.read({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'New Session',
      isCustomTitle: false,
      agents: {},
      custom: {},
    })).resolves.toMatchObject({
      agents: { main: { homedir: joinPosix(sessionDir, 'agents', 'main') } },
    });
  });
});

describe('session state io', () => {
  it('writes atomically and rotates the previous file to .bak', async () => {
    const dir = await makeDir();
    const statePath = join(dir, 'state.json');
    await writeSessionStateFile(statePath, { title: 'first' });
    await writeSessionStateFile(statePath, { title: 'second' });

    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toMatchObject({
      title: 'second',
      version: SESSION_STATE_VERSION,
    });
    expect(JSON.parse(await readFile(`${statePath}.bak`, 'utf-8'))).toMatchObject({
      title: 'first',
    });
  });

  it('reads a leftover backup when state.json is corrupt', async () => {
    const dir = await makeDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'state.json.bak'),
      `${JSON.stringify({ title: 'from-bak', isCustomTitle: true })}\n`,
      'utf-8',
    );
    await writeFile(join(dir, 'state.json'), '{ "truncated', 'utf-8');

    await expect(readRequiredSessionState(dir, 'ses_bak')).resolves.toMatchObject({
      title: 'from-bak',
      isCustomTitle: true,
    });
  });

  it('rejects a well-formed non-object without reading the backup', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'state.json'), '[]', 'utf-8');
    await writeFile(join(dir, 'state.json.bak'), `${JSON.stringify({ title: 'hidden' })}\n`, 'utf-8');

    await expect(readRequiredSessionState(dir, 'ses_bad')).rejects.toMatchObject({
      code: 'session.state_invalid',
    });
  });
});
