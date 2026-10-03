import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLioraHarness } from '../src/rpc/sdk-rpc-client';
import type { IndependentSessionActivity } from '../src/session/types';
import { createSessionCoordinator } from '../src/orchestration/index';
import * as processSandbox from '../../agent-core/src/tools/policies/process-sandbox-apply';
import { Session as CoreSession } from '../../agent-core/src/session';

vi.mock('../src/orchestration/index', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/orchestration/index')>(),
  createSessionCoordinator: vi.fn(),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(createSessionCoordinator).mockReset();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'liora-interactive-runtime-'));
  directories.push(path);
  return path;
}
function coordinator() {
  const facts = [{ id: 'coord_worker', sessionId: 'coord_worker', revision: 1, status: 'accepted', purpose: 'Worker task', cwd: '/workspace' }];
  let changed: ((snapshot: { records: object[]; total: number }) => void) | undefined;
  const stop = vi.fn();
  const instance = {
    onChange: vi.fn((callback: (snapshot: { records: object[]; total: number }) => void) => { changed = callback; return stop; }),
    facts: vi.fn(() => ({ records: facts, total: facts.length })),
    fact: vi.fn((id: string) => facts.find((fact) => fact.id === id)),
    close: vi.fn(async () => {}),
  };
  vi.mocked(createSessionCoordinator).mockResolvedValue(instance as unknown as Awaited<ReturnType<typeof createSessionCoordinator>>);
  return { instance, facts, changed: () => changed?.({ records: facts, total: facts.length }), stop };
}

describe('interactive host binding', () => {
  it('passes canonical explicit roots, shares the binding over create/resume, and keeps it alive after conductor close', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    const approved = await directory();
    const bound = coordinator();
    const getHost = vi.spyOn(CoreSession.prototype, 'getSubagentHost');
    const harness = createLioraHarness({ homeDir, uiMode: 'shell' });
    try {
      const session = await harness.createSession({ workDir, additionalDirs: [approved], role: 'interactive-conductor' });
      expect(createSessionCoordinator).toHaveBeenCalledTimes(1);
      const coreSession = getHost.mock.contexts[0] as CoreSession;
      expect(coreSession.options.role).toBe('interactive-conductor');
      expect(coreSession.options.coordination).toBe(bound.instance);
      expect(coreSession.getReadyAgent('main')?.role).toBe('interactive-conductor');
      const child = await coreSession.createAgent({ type: 'sub' }, { parentAgentId: 'main' });
      expect(child.agent.role).toBe('worker');
      expect(createSessionCoordinator).toHaveBeenCalledWith(harness, {
        path: expect.stringContaining(join(homeDir, 'coordination')),
        policy: { role: 'conductor', maxConcurrent: 4, authorizedRoots: [await realpath(workDir), await realpath(approved)].toSorted() },
        onActivity: expect.any(Function),
        prepareSession: expect.any(Function),
      });
      await harness.resumeSession({ id: session.id, role: 'interactive-conductor', additionalDirs: [approved] });
      await session.close();
      expect(bound.instance.close).not.toHaveBeenCalled();
      await harness.resumeSession({ id: session.id, role: 'interactive-conductor', additionalDirs: [approved] });
      expect(createSessionCoordinator).toHaveBeenCalledTimes(1);
      expect(bound.instance.close).not.toHaveBeenCalled();
    } finally { await harness.close(); }
    expect(bound.instance.close).toHaveBeenCalledTimes(1);
    expect(bound.stop).toHaveBeenCalledTimes(1);
  });

  it('promotes an idle resumed worker through native replay with the main execution role updated', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    const bound = coordinator();
    const getHost = vi.spyOn(CoreSession.prototype, 'getSubagentHost');
    const harness = createLioraHarness({ homeDir });
    try {
      const session = await harness.createSession({ workDir });
      const oldCore = getHost.mock.contexts[0] as CoreSession;
      expect(oldCore.getReadyAgent('main')?.role).toBe('worker');
      await harness.resumeSession({ id: session.id, role: 'interactive-conductor' });
      const newCore = getHost.mock.contexts.at(-1) as CoreSession;
      expect(oldCore.isClosing).toBe(true);
      expect(newCore).not.toBe(oldCore);
      expect(newCore.options.coordination).toBe(bound.instance);
      expect(newCore.getReadyAgent('main')?.role).toBe('interactive-conductor');
    } finally { await harness.close(); }
  });

  it('persists host ancestry before emission and restores it on native resume without silently reparenting', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    const getHost = vi.spyOn(CoreSession.prototype, 'getSubagentHost');
    const harness = createLioraHarness({ homeDir });
    const workerAncestry = {
      agentId: 'main', sessionId: 'coord_persisted', parentAgentId: 'main', parentSessionId: 'conductor-parent',
      rootAgentId: 'main', rootSessionId: 'conductor-parent', conductorAgentId: 'main',
      conductorSessionId: 'conductor-parent', coordinationId: 'coord_persisted', status: 'linked' as const,
    };
    try {
      const session = await harness.createSession({ id: workerAncestry.sessionId, workDir, workerAncestry });
      const core = getHost.mock.contexts[0] as CoreSession;
      expect(core.options.workerAncestry).toEqual(workerAncestry);
      await core.flushMetadata();
      const persisted = JSON.parse(await readFile(join(session.summary!.sessionDir, 'state.json'), 'utf8'));
      expect(persisted.workerAncestry).toEqual(workerAncestry);
      await session.close();
      const resumed = await harness.resumeSession({ id: session.id });
      const live = getHost.mock.contexts.at(-1) as CoreSession;
      expect(live.options.workerAncestry).toEqual(workerAncestry);
      expect(live.metadata.workerAncestry).toEqual(workerAncestry);
      await expect(harness.resumeSession({ id: resumed.id, workerAncestry: { ...workerAncestry, parentSessionId: 'different-parent' } }))
        .rejects.toThrow('Cannot reparent');
      expect(live.options.workerAncestry).toEqual(workerAncestry);
      await resumed.close();
      await expect(harness.resumeSession({ id: resumed.id, workerAncestry: { ...workerAncestry, parentSessionId: 'different-parent' } }))
        .rejects.toThrow('Cannot reparent');
    } finally { await harness.close(); }
  });

  it('does not infer conductor behavior from shell uiMode for worker/headless create or resume', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    coordinator();
    const harness = createLioraHarness({ homeDir, uiMode: 'shell' });
    try {
      const session = await harness.createSession({ workDir });
      await session.close();
      await harness.resumeSession({ id: session.id });
      expect(createSessionCoordinator).not.toHaveBeenCalled();
      expect(await readdir(homeDir)).not.toContain('coordination');
    } finally { await harness.close(); }
  });

  it('fails closed when resume attempts to expand the already-bound authority roots', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    const newlyApproved = await directory();
    coordinator();
    const harness = createLioraHarness({ homeDir });
    try {
      const session = await harness.createSession({ workDir, role: 'interactive-conductor' });
      await expect(harness.resumeSession({ id: session.id, role: 'interactive-conductor', additionalDirs: [newlyApproved] }))
        .rejects.toThrow('authorization roots changed');
      expect(createSessionCoordinator).toHaveBeenCalledTimes(1);
    } finally { await harness.close(); }
  });

  it('enforces the authoritative parent process minimum on independent admission and resume, including existing children', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    coordinator();
    const getHost = vi.spyOn(CoreSession.prototype, 'getSubagentHost');
    const harness = createLioraHarness({ homeDir });
    try {
      const conductor = await harness.createSession({ workDir, role: 'interactive-conductor' });
      const parent = getHost.mock.contexts[0] as CoreSession;
      const prepare = vi.mocked(createSessionCoordinator).mock.calls[0]![1].prepareSession!;
      const worker = await harness.createSession({ id: 'strict-worker', workDir });
      let core = getHost.mock.contexts.at(-1) as CoreSession;
      const child = await core.createAgent({ type: 'sub' }, { parentAgentId: 'main' });
      const retained = [core.getReadyAgent('main')!.kaos, child.agent.kaos];
      Object.assign(parent.metadata.custom, { sandboxProfile: 'workspace', sandboxEnforcement: 'process' });
      await parent.writeMetadata();
      vi.spyOn(processSandbox, 'resolveProcessSandboxRuntime').mockRejectedValue(new Error('Strict backend unavailable'));
      await expect(prepare(worker)).rejects.toThrow('one or more Agents');
      expect(core.options.sandboxMinimum).toEqual({ profile: 'workspace', enforcement: 'process' });
      for (const kaos of retained) await expect(kaos.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.unavailable' });
      // A failed activation does not persist a success ACK. A fresh runtime
      // resume must still consult the durable parent, even after its close.
      await worker.close();
      await conductor.close();
      const resumed = await harness.resumeSession({ id: worker.id });
      core = getHost.mock.contexts.at(-1) as CoreSession;
      await expect(prepare(resumed)).rejects.toThrow('one or more Agents');
      await expect(core.getReadyAgent('main')!.kaos.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    } finally { await harness.close(); }
  });

  it('keeps a stricter child policy when the authoritative parent is off', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    coordinator();
    const getHost = vi.spyOn(CoreSession.prototype, 'getSubagentHost');
    const harness = createLioraHarness({ homeDir });
    try {
      await harness.createSession({ workDir, role: 'interactive-conductor', metadata: { sandboxProfile: 'off' } });
      const prepare = vi.mocked(createSessionCoordinator).mock.calls[0]![1].prepareSession!;
      const worker = await harness.createSession({ workDir, metadata: { sandboxProfile: 'read-only', sandboxEnforcement: 'lexical' } });
      const core = getHost.mock.contexts.at(-1) as CoreSession;
      const child = await core.createAgent({ type: 'sub' }, { parentAgentId: 'main' });
      await prepare(worker);
      expect(child.agent.sandboxProfile).toBe('read-only');
      expect(core.getReadyAgent('main')!.sandboxProfile).toBe('read-only');
      expect(core.metadata.custom).toMatchObject({ sandboxProfile: 'read-only', sandboxEnforcement: 'lexical' });
    } finally { await harness.close(); }
  });

  it('routes an actual independent SDK requestQuestion through the existing host handler and emits scoped pending/resolved/error attention', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    const bound = coordinator();
    const getHost = vi.spyOn(CoreSession.prototype, 'getSubagentHost');
    const harness = createLioraHarness({ homeDir });
    const seen: IndependentSessionActivity[] = [];
    const entered = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<null>();
    try {
      const conductor = await harness.createSession({ workDir, role: 'interactive-conductor' });
      const workerAncestry = {
        agentId: 'main', sessionId: 'actual-question-worker', parentAgentId: 'main', parentSessionId: conductor.id,
        rootAgentId: 'main', rootSessionId: conductor.id, conductorAgentId: 'main', conductorSessionId: conductor.id,
        coordinationId: 'coord_worker', status: 'linked' as const,
      };
      await harness.createSession({ id: workerAncestry.sessionId, workDir, workerAncestry });
      const worker = getHost.mock.contexts.at(-1) as CoreSession;
      Object.assign(bound.facts[0]!, { sessionId: workerAncestry.sessionId, workerAncestry });
      const handler = vi.fn(async () => { entered.resolve(); return answer.promise; });
      harness.setIndependentSessionQuestionHandler(conductor.id, handler);
      harness.onIndependentSessionActivity(conductor.id, (activity) => seen.push(activity));
      const request = { agentId: 'main', toolCallId: 'real-question-call', questions: [{ question: 'Private question body', options: [{ label: 'A' }, { label: 'B' }] }] };
      // Real core -> SDK reverse RPC, not a manufactured WorkerTreeNode flag.
      const pending = worker.rpc.requestQuestion(request);
      await entered.promise;
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ sessionId: workerAncestry.sessionId, agentId: 'main', questions: request.questions }), undefined);
      expect(seen.at(-1)).toMatchObject({ type: 'attention', conductorSessionId: conductor.id, record: { id: 'coord_worker' },
        sessionId: workerAncestry.sessionId, agentId: 'main', attention: 'question' });
      expect(JSON.stringify(seen)).not.toContain('Private question body');
      answer.resolve(null);
      expect(await pending).toBeNull();
      expect(seen.at(-1)).toMatchObject({ type: 'attention', sessionId: workerAncestry.sessionId, agentId: 'main', attention: undefined });
      harness.setIndependentSessionQuestionHandler(conductor.id, async () => { throw new Error('Question handler failed'); });
      expect(await worker.rpc.requestQuestion(request)).toBeNull();
      expect(seen.at(-1)).toMatchObject({ type: 'attention', sessionId: workerAncestry.sessionId, agentId: 'main', attention: 'error' });
      harness.setIndependentSessionQuestionHandler(conductor.id, undefined);
      const before = seen.length;
      expect(await worker.rpc.requestQuestion(request)).toBeNull();
      expect(seen).toHaveLength(before); // Headless/no handler remains the existing null fallback.
    } finally { answer.resolve(null); await harness.close(); }
  });

  it('reads a nested independent trace from the scoped durable owner without closing its active worker or changing the conductor selection', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    const bound = coordinator();
    const harness = createLioraHarness({ homeDir });
    try {
      const conductor = await harness.createSession({ workDir, role: 'interactive-conductor' });
      const worker = await harness.createSession({ id: 'trace-worker', workDir });
      Object.assign(bound.facts[0]!, { sessionId: worker.id });
      const close = vi.spyOn(worker, 'close');
      const getTrace = vi.spyOn(worker, 'getSessionTrace').mockImplementation(async () => {
        expect(harness.interactiveAgentId).toBe('nested-reviewer');
        return { context: { history: [] } } as unknown as Awaited<ReturnType<typeof worker.getSessionTrace>>;
      });
      await harness.getIndependentSessionTrace(conductor.id, 'coord_worker', 'nested-reviewer');
      expect(getTrace).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      expect(harness.interactiveAgentId).toBe('main');
      await expect(harness.getIndependentSessionTrace('unrelated-conductor', 'coord_worker', 'nested-reviewer')).rejects.toThrow('not been admitted');
      expect(getTrace).toHaveBeenCalledTimes(1);
    } finally { await harness.close(); }
  });

  it('whitelists pipeline owner facts and lineage without copying pipeline results, binding, leases or mailbox bodies', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    const bound = coordinator();
    const harness = createLioraHarness({ homeDir });
    const seen: IndependentSessionActivity[] = [];
    try {
      const session = await harness.createSession({ workDir, role: 'interactive-conductor' });
      Object.assign(bound.facts[0]!, {
        kind: 'pipeline', coordinationId: 'coord_worker', parentAgentId: 'main', parentSessionId: session.id,
        pipeline: { planId: 'host-plan', status: 'blocked', result: { secret: 'private pipeline result' }, binding: 'private pipeline binding' },
        result: 'private worker result', lease: { owner: 'private lease' }, mailbox: { messages: ['private mailbox'] },
      });
      const stop = harness.onIndependentSessionActivity(session.id, (activity) => seen.push(activity));
      expect(seen.at(-1)).toMatchObject({ type: 'snapshot', records: [{ kind: 'pipeline', coordinationId: 'coord_worker',
        parentAgentId: 'main', parentSessionId: session.id, pipeline: { planId: 'host-plan', status: 'blocked' } }] });
      bound.changed();
      expect(JSON.stringify(seen)).not.toContain('private');
      expect(seen.at(-1)).toMatchObject({ records: [{ pipeline: { planId: 'host-plan', status: 'blocked' } }] });
      stop();
    } finally { await harness.close(); }
  });

  it('routes scoped independent events and durable fact changes directly, without exposing prompts or mutating event IDs', async () => {
    const homeDir = await directory();
    const workDir = await directory();
    const bound = coordinator();
    const harness = createLioraHarness({ homeDir });
    const seen: IndependentSessionActivity[] = [];
    try {
      const session = await harness.createSession({ workDir, role: 'interactive-conductor' });
      const stop = harness.onIndependentSessionActivity(session.id, (activity) => seen.push(activity));
      expect(seen[0]).toMatchObject({ type: 'snapshot', conductorSessionId: session.id, records: [bound.facts[0]] });
      const onActivity = vi.mocked(createSessionCoordinator).mock.calls[0]?.[1].onActivity;
      if (onActivity === undefined) throw new Error('Expected direct independent runtime activity callback');
      const workerAncestry = {
        agentId: 'main', sessionId: 'actual-worker-session', parentAgentId: 'main', parentSessionId: session.id,
        rootAgentId: 'main', rootSessionId: session.id, coordinationId: 'coord_worker', status: 'linked' as const,
      };
      Object.assign(bound.facts[0]!, { sessionId: 'actual-worker-session', workerAncestry, prompt: 'not an activity field', mailbox: [{ text: 'not visible' }] });
      const raw = { sessionId: 'actual-worker-session', agentId: 'main', workerAncestry, type: 'assistant.delta' as const, turnId: 0, delta: 'Worker live output' };
      onActivity('actual-worker-session', raw);
      expect(seen.at(-1)).toMatchObject({ type: 'event', conductorSessionId: session.id, event: raw });
      expect(raw.agentId).toBe('main');
      expect(seen.at(-1)).toMatchObject({ record: { id: 'coord_worker', workerAncestry }, event: { workerAncestry } });
      expect(JSON.stringify(seen.at(-1))).not.toContain('not an activity field');
      expect(JSON.stringify(seen.at(-1))).not.toContain('not visible');
      const length = seen.length;
      onActivity('unrelated-worker', { ...raw, sessionId: 'unrelated-worker' });
      expect(seen).toHaveLength(length);
      bound.changed();
      expect(seen.at(-1)?.type).toBe('snapshot');
      stop();
      const afterStop = seen.length;
      bound.changed();
      onActivity('actual-worker-session', raw);
      expect(seen).toHaveLength(afterStop);
    } finally { await harness.close(); }
  });
});
