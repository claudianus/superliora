import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, WorkerAncestry } from '@superliora/protocol';
import { eventSchema } from '@superliora/protocol';
import { ErrorCodes } from '../../../src/errors';
import { Session } from '../../../src/session';
import { SessionStore } from '../../../src/session/store';
import type { SDKSessionRPC } from '../../../src/rpc';
import { resolveWorkerAncestry } from '../../../src/session/lifecycle/worker-ancestry';
import { testKaos } from '../../fixtures/test-kaos';

async function fixture(workerAncestry?: WorkerAncestry) {
  const directory = await mkdtemp(join(tmpdir(), 'worker-ancestry-'));
  const events: (AgentEvent & { agentId: string })[] = [];
  const rpc: SDKSessionRPC = {
    emitEvent: vi.fn(async (event) => { events.push(event); }),
    requestApproval: vi.fn(async () => ({ decision: 'cancelled' as const })),
    requestQuestion: vi.fn(async () => null), requestCredential: vi.fn(async () => null),
  };
  const session = new Session({ id: 'worker-session', role: 'interactive-conductor', workerAncestry, kaos: testKaos, homedir: directory, rpc });
  const main = await session.createAgent({ type: 'main' });
  const child = await session.createAgent({ type: 'sub' }, { parentAgentId: main.id });
  const grandchild = await session.createAgent({ type: 'sub' }, { parentAgentId: child.id });
  return { directory, session, main, child, grandchild, events };
}

describe('authoritative host worker lineage', () => {
  it('emits exact grandchild parent metadata and keeps only main in conductor mode', async () => {
    const f = await fixture();
    try {
      f.grandchild.agent.emitEvent({ type: 'turn.started', turnId: 1, origin: { kind: 'user' } });
      f.child.agent.emitEvent({ type: 'subagent.started', subagentId: f.grandchild.id });
      expect(f.events.at(-2)).toMatchObject({ agentId: f.grandchild.id, workerAncestry: { agentId: f.grandchild.id, sessionId: 'worker-session', parentAgentId: f.child.id, parentSessionId: 'worker-session', rootAgentId: 'main', rootSessionId: 'worker-session', conductorAgentId: 'main', conductorSessionId: 'worker-session', status: 'linked' } });
      expect(f.events.at(-1)?.workerAncestry).toEqual(f.events.at(-2)?.workerAncestry);
      expect(f.session.getSubagentHost('main').role).toBe('interactive-conductor');
      expect(f.session.getSubagentHost(f.child.id).role).toBe('worker');
      expect(f.session.getSubagentHost(f.child.id).coordination).toBeUndefined();
      const wire = eventSchema.parse({ ...f.events.at(-1), sessionId: 'worker-session' });
      expect(wire.workerAncestry).toEqual(f.events.at(-1)?.workerAncestry);
    } finally { await f.session.close(); await rm(f.directory, { recursive: true, force: true }); }
  });

  it('preserves cross-session conductor roots for every descendant of an independent main', async () => {
    const f = await fixture({ agentId: 'main', sessionId: 'worker-session', parentAgentId: 'requesting-worker', parentSessionId: 'conductor-session', rootAgentId: 'main', rootSessionId: 'conductor-session', conductorAgentId: 'main', conductorSessionId: 'conductor-session', coordinationId: 'coord_request', status: 'linked' });
    try {
      f.main.agent.emitEvent({ type: 'turn.started', turnId: 1, origin: { kind: 'user' } });
      f.grandchild.agent.emitEvent({ type: 'turn.started', turnId: 2, origin: { kind: 'user' } });
      expect(f.events.at(-2)?.workerAncestry).toMatchObject({ parentAgentId: 'requesting-worker', parentSessionId: 'conductor-session', rootSessionId: 'conductor-session', coordinationId: 'coord_request' });
      expect(f.events.at(-1)?.workerAncestry).toMatchObject({ agentId: f.grandchild.id, parentAgentId: f.child.id, parentSessionId: 'worker-session', rootSessionId: 'conductor-session', conductorSessionId: 'conductor-session', coordinationId: 'coord_request' });
    } finally { await f.session.close(); await rm(f.directory, { recursive: true, force: true }); }
  });

  it('names only the main root as conductor in an interactive-conductor session', () => {
    const agents = { main: { homedir: '/workspace', type: 'main' as const, parentAgentId: null }, loose: { homedir: '/workspace', type: 'sub' as const, parentAgentId: null } };
    const options = { id: 'session', role: 'interactive-conductor' as const };
    expect(resolveWorkerAncestry(options, agents, 'main')).toMatchObject({ conductorAgentId: 'main', conductorSessionId: 'session', status: 'root' });
    const loose = resolveWorkerAncestry(options, agents, 'loose');
    expect(loose).toMatchObject({ rootAgentId: 'loose', status: 'root' });
    expect(loose.conductorAgentId).toBeUndefined();
    expect(loose.conductorSessionId).toBeUndefined();
  });

  it('reports missing parents and ancestry cycles as explicit orphans, without invented roots', () => {
    const meta = (parentAgentId: string | null) => ({ homedir: '/workspace', type: 'sub' as const, parentAgentId });
    expect(resolveWorkerAncestry({ id: 'session' }, { child: meta('missing') }, 'child')).toMatchObject({ parentAgentId: 'missing', parentSessionId: 'session', rootAgentId: null, rootSessionId: null, status: 'orphan' });
    expect(resolveWorkerAncestry({ id: 'session' }, { a: meta('b'), b: meta('a') }, 'a').status).toBe('orphan');
    expect(resolveWorkerAncestry({ id: 'session' }, {}, 'unknown').status).toBe('orphan');
  });

  describe('persisted independent ancestry', () => {
    const rpc = (): SDKSessionRPC => ({
      emitEvent: vi.fn(async () => {}), requestApproval: vi.fn(async () => ({ decision: 'cancelled' as const })),
      requestQuestion: vi.fn(async () => null), requestCredential: vi.fn(async () => null),
    });
    const ancestry: WorkerAncestry = { agentId: 'main', sessionId: 'admitted', parentAgentId: 'main', parentSessionId: 'conductor', rootAgentId: 'main', rootSessionId: 'conductor', conductorAgentId: 'main', conductorSessionId: 'conductor', coordinationId: 'coord_admitted', status: 'linked' };

    async function admitted(home: string) {
      const store = new SessionStore(home);
      const summary = await store.create({ id: 'admitted', workDir: home });
      const session = new Session({ id: 'admitted', workerAncestry: ancestry, kaos: testKaos, homedir: summary.sessionDir, rpc: rpc() });
      session.metadata = { ...session.metadata, workerAncestry: ancestry };
      await session.createMain();
      await session.flushMetadata();
      await session.close();
      return { store, summary };
    }
    const reopen = (id: string, homedir: string, workerAncestry?: WorkerAncestry) =>
      new Session({ id, workerAncestry, kaos: testKaos, homedir, rpc: rpc(), initializeMainAgent: false });

    it('drops the source ancestry from a fork so the fork reopens as its own session', async () => {
      const home = await mkdtemp(join(tmpdir(), 'worker-ancestry-fork-'));
      try {
        const { store } = await admitted(home);
        const fork = await store.fork({ sourceId: 'admitted', targetId: 'forked' });
        const forked = reopen('forked', fork.sessionDir);
        await expect(forked.resume()).resolves.toBeDefined();
        expect(forked.options.workerAncestry).toBeUndefined();
        expect(forked.metadata.workerAncestry).toBeUndefined();
        await forked.close();
      } finally { await rm(home, { recursive: true, force: true }); }
    });

    it('rejects reparenting, late attachment, and corrupt ancestry with typed session errors', async () => {
      const home = await mkdtemp(join(tmpdir(), 'worker-ancestry-guard-'));
      try {
        const { store, summary } = await admitted(home);
        const reparented = reopen('admitted', summary.sessionDir, { ...ancestry, coordinationId: 'coord_other' });
        await expect(reparented.resume()).rejects.toMatchObject({ code: ErrorCodes.SESSION_STATE_INVALID });
        await reparented.close();
        const restated = reopen('admitted', summary.sessionDir, ancestry);
        await restated.resume();
        expect(restated.options.workerAncestry).toEqual(ancestry);
        await restated.close();

        const fork = await store.fork({ sourceId: 'admitted', targetId: 'plain' });
        const attached = reopen('plain', fork.sessionDir, { ...ancestry, sessionId: 'plain' });
        await expect(attached.resume()).rejects.toMatchObject({ code: ErrorCodes.SESSION_STATE_INVALID });
        await attached.close();

        const corrupt = reopen('admitted', summary.sessionDir);
        const state = JSON.parse(await readFile(join(summary.sessionDir, 'state.json'), 'utf8')) as Record<string, unknown>;
        await writeFile(join(summary.sessionDir, 'state.json'), JSON.stringify({ ...state, workerAncestry: { agentId: 7 } }));
        await expect(corrupt.resume()).rejects.toMatchObject({ code: ErrorCodes.SESSION_STATE_INVALID });
        await corrupt.close();
      } finally { await rm(home, { recursive: true, force: true }); }
    });
  });
});
