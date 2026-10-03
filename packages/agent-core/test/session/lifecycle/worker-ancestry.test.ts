import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, WorkerAncestry } from '@superliora/protocol';
import { eventSchema } from '@superliora/protocol';
import { Session } from '../../../src/session';
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

  it('reports missing parents and ancestry cycles as explicit orphans, without invented roots', () => {
    const meta = (parentAgentId: string | null) => ({ homedir: '/workspace', type: 'sub' as const, parentAgentId });
    expect(resolveWorkerAncestry({ id: 'session' }, { child: meta('missing') }, 'child')).toMatchObject({ parentAgentId: 'missing', parentSessionId: 'session', rootAgentId: null, rootSessionId: null, status: 'orphan' });
    expect(resolveWorkerAncestry({ id: 'session' }, { a: meta('b'), b: meta('a') }, 'a').status).toBe('orphan');
    expect(resolveWorkerAncestry({ id: 'session' }, {}, 'unknown').status).toBe('orphan');
  });
});
