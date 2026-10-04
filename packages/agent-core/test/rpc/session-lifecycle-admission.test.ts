import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorCodes } from '../../src/errors';
import { createSession, resumeSession, type SessionLifecycleContext } from '../../src/rpc/session-lifecycle';
import { Session } from '../../src/session';
import { noopTelemetryClient } from '../../src/telemetry';
import { SessionStore } from '../../src/session/store';
import { testKaos } from '../fixtures/test-kaos';

let workDir: string | undefined;
afterEach(async () => {
  if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  workDir = undefined;
});

function context(overrides: Partial<SessionLifecycleContext>): SessionLifecycleContext {
  return {
    homeDir: workDir!,
    sessions: new Map(),
    telemetry: undefined as never,
    appVersion: undefined,
    sdk: new Promise(() => {}),
    config: {} as never,
    reloadProviderManager: () => ({}) as never,
    getKaos: async () => testKaos,
    resolveProviderManager: () => undefined as never,
    refreshSessionRuntimeConfig: async () => {},
    sessionStore: {} as never,
    ...overrides,
  };
}

describe('session lifecycle admission ordering', () => {
  it('does not index a conductor session whose coordinator cannot be resolved', async () => {
    workDir = await mkdtemp(join(tmpdir(), 'liora-lifecycle-coordinator-'));
    const create = vi.fn();
    const ctx = context({
      sessionStore: { create } as never,
      resolveSessionCoordinator: vi.fn(async () => { throw new Error('coordinator refused'); }),
    });
    await expect(createSession(ctx, { workDir, role: 'interactive-conductor' })).rejects.toThrow('coordinator refused');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects attaching supplied worker ancestry to a live unbound session without mutating it', async () => {
    workDir = await mkdtemp(join(tmpdir(), 'liora-lifecycle-resume-'));
    const options: Record<string, unknown> = { role: 'worker' };
    const metadata: Record<string, unknown> = {};
    const active = { options, metadata, hasActiveTurn: true, getAdditionalDirs: () => [] } as unknown as Session;
    const ctx = context({
      sessions: new Map([['session-busy', active]]),
      sessionStore: { get: async () => ({ id: 'session-busy', workDir, sessionDir: workDir }) } as never,
      resolveSessionCoordinator: vi.fn(),
    });
    const ancestry = {
      agentId: 'main', sessionId: 'session-busy', parentAgentId: 'main', parentSessionId: 'conductor',
      rootAgentId: 'main', rootSessionId: 'conductor', conductorAgentId: 'main', conductorSessionId: 'conductor',
      coordinationId: 'coord_one', status: 'linked' as const,
    };
    await expect(resumeSession(ctx, { sessionId: 'session-busy', role: 'interactive-conductor', workerAncestry: ancestry }))
      .rejects.toMatchObject({ code: ErrorCodes.SESSION_STATE_INVALID });
    expect(options['workerAncestry']).toBeUndefined();
    expect(metadata['workerAncestry']).toBeUndefined();
    expect(ctx.resolveSessionCoordinator).not.toHaveBeenCalled();
  });

  it('keeps an admitted independent worker in the worker role when a client asks for a conductor', async () => {
    workDir = await mkdtemp(join(tmpdir(), 'liora-lifecycle-worker-role-'));
    const store = new SessionStore(workDir);
    const summary = await store.create({ id: 'admitted', workDir });
    const ancestry = {
      agentId: 'main', sessionId: 'admitted', parentAgentId: 'main', parentSessionId: 'conductor',
      rootAgentId: 'main', rootSessionId: 'conductor', conductorAgentId: 'main', conductorSessionId: 'conductor',
      coordinationId: 'coord_admitted', status: 'linked' as const,
    };
    const rpc = {
      emitEvent: vi.fn(async () => {}), requestApproval: vi.fn(async () => ({ decision: 'cancelled' as const })),
      requestQuestion: vi.fn(async () => null), requestCredential: vi.fn(async () => null),
    };
    const seeded = new Session({ id: 'admitted', workerAncestry: ancestry, kaos: testKaos, homedir: summary.sessionDir, rpc });
    seeded.metadata = { ...seeded.metadata, workerAncestry: ancestry };
    await seeded.createMain();
    await seeded.flushMetadata();
    await seeded.close();

    const sessions = new Map<string, Session>();
    const ctx = context({ sessions, telemetry: noopTelemetryClient, sessionStore: store, sdk: Promise.resolve(rpc as never), resolveSessionCoordinator: vi.fn() });
    await resumeSession(ctx, { sessionId: 'admitted', role: 'interactive-conductor' });
    const reopened = sessions.get('admitted')!;
    try {
      expect(reopened.options.role).toBe('worker');
      expect(reopened.options.workerAncestry).toEqual(ancestry);
      expect(ctx.resolveSessionCoordinator).not.toHaveBeenCalled();
      // A live reopen keeps the same role instead of promoting it.
      await resumeSession(ctx, { sessionId: 'admitted', role: 'interactive-conductor' });
      expect(sessions.get('admitted')).toBe(reopened);
      expect(reopened.options.role).toBe('worker');
    } finally {
      await reopened.close();
    }
  });
});
