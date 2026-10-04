import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorCodes } from '../../src/errors';
import { createSession, resumeSession, type SessionLifecycleContext } from '../../src/rpc/session-lifecycle';
import type { Session } from '../../src/session';
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

  it('rejects a busy role change before attributing supplied worker ancestry', async () => {
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
      .rejects.toMatchObject({ code: ErrorCodes.TURN_AGENT_BUSY });
    expect(options['workerAncestry']).toBeUndefined();
    expect(metadata['workerAncestry']).toBeUndefined();
    expect(ctx.resolveSessionCoordinator).not.toHaveBeenCalled();
  });
});
