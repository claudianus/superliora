import type { Event, IndependentSessionFact } from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import { WorkerDockController, type WorkerDockHost } from '#/tui/controllers/worker-dock/controller';
import { SessionEventHandler, type SessionEventHost } from '#/tui/controllers/session-event/handler';

const fact: IndependentSessionFact = {
  id: 'coord_one', sessionId: 'coord_one', revision: 1,
  status: 'accepted', purpose: 'Implement checkout', cwd: '/workspace',
  workerAncestry: { agentId: 'main', sessionId: 'coord_one', parentAgentId: 'main', parentSessionId: 'conductor',
    rootAgentId: 'main', rootSessionId: 'conductor', conductorAgentId: 'main', conductorSessionId: 'conductor',
    coordinationId: 'coord_one', status: 'linked' },
};

function dock() {
  const host = {
    state: {
      appState: { workDir: '/workspace' },
      transcriptContainer: { isBatchMounting: false },
      renderer: { invalidateFrame: vi.fn() },
      workerDockPanel: { isEmpty: vi.fn(() => false), setView: vi.fn() },
    },
  };
  return { host, controller: new WorkerDockController(host as unknown as WorkerDockHost) };
}

describe('independent session task visibility', () => {
  it('shows accepted work before admission, streams real tool activity, and settles only on recorded terminal facts', () => {
    const { controller, host } = dock();
    controller.handleIndependentActivity({ type: 'snapshot', conductorSessionId: 'conductor', records: [fact] });
    expect(controller.registry.treeSnapshot('conductor').nodes[0]).toMatchObject({
      id: 'record:conductor:coord_one', label: 'Implement checkout', phase: 'queued',
    });
    const event = (payload: Partial<Event>) => ({ ...payload, sessionId: 'coord_one', agentId: 'main' }) as Event;
    for (const raw of [
      event({ type: 'tool.call.started', turnId: 0, toolCallId: 'call-one', name: 'Bash', args: { command: 'pnpm test' }, description: 'Run tests' }),
      event({ type: 'tool.progress', turnId: 0, toolCallId: 'call-one', update: { kind: 'stdout', text: 'tests running' } }),
      event({ type: 'tool.result', turnId: 0, toolCallId: 'call-one', output: 'passed' }),
    ]) {
      controller.handleIndependentActivity({ type: 'event', conductorSessionId: 'conductor', record: fact, event: raw });
      expect(raw.agentId).toBe('main'); // The actual session event is never rewritten.
    }
    expect(controller.registry.snapshot().ops[0]).toMatchObject({ workerId: 'record:conductor:coord_one', name: 'Bash', status: 'ok' });
    controller.handleIndependentActivity({
      type: 'event', conductorSessionId: 'conductor', record: fact,
      event: event({ type: 'turn.ended', turnId: 0, reason: 'completed' }),
    });
    expect(controller.registry.snapshot().workers[0]?.status).toBe('running');
    controller.handleIndependentActivity({
      type: 'snapshot', conductorSessionId: 'conductor', records: [{ ...fact, revision: 2, status: 'completed' }],
    });
    expect(controller.registry.treeSnapshot('conductor').nodes.find((node) => node.recordId === 'coord_one')?.phase).toBe('completed');
    expect(controller.getIndependentRecord('record:conductor:coord_one')?.revision).toBe(2);
    expect(host.state.workerDockPanel.setView).toHaveBeenCalled();
    controller.reset();
    expect(controller.getIndependentRecord('record:conductor:coord_one')).toBeUndefined();
  });

  it('keeps two independent main agents distinct even when their tool IDs match', () => {
    const { controller } = dock();
    const second = { ...fact, id: 'coord_two', sessionId: 'coord_two', purpose: 'Review checkout',
      workerAncestry: { ...fact.workerAncestry!, sessionId: 'coord_two', coordinationId: 'coord_two' } };
    controller.handleIndependentActivity({ type: 'snapshot', conductorSessionId: 'conductor', records: [fact, second] });
    for (const record of [fact, second]) {
      controller.handleIndependentActivity({ type: 'event', conductorSessionId: 'conductor', record, event: {
        sessionId: record.id, agentId: 'main', type: 'tool.call.started', turnId: 0,
        toolCallId: 'same-tool-id', name: 'Bash', args: {},
      } });
    }
    expect(controller.registry.snapshot().ops.map((op) => op.workerId)).toEqual(['record:conductor:coord_one', 'record:conductor:coord_two']);
  });

  it('subscribes directly to scoped activity, never main chat dispatch, and cleans up on reattach', () => {
    let emit: ((activity: unknown) => void) | undefined;
    const stopIndependent = vi.fn();
    const stopSession = vi.fn();
    const workerDock = { handleIndependentActivity: vi.fn() };
    const host = {
      state: { appState: { sessionId: 'conductor' } }, aborted: false,
      sessionEventUnsubscribe: undefined as (() => void) | undefined,
      requireSession: () => ({ onEvent: vi.fn(() => stopSession) }),
      workerDock,
      harness: { onIndependentSessionActivity: vi.fn((_id, callback) => { emit = callback; return stopIndependent; }) },
    };
    const handler = new SessionEventHandler(host as unknown as SessionEventHost);
    const mainDispatch = vi.spyOn(handler, 'handleEvent');
    handler.startSubscription();
    const snapshot = { type: 'snapshot', conductorSessionId: 'conductor', records: [fact] };
    emit?.(snapshot);
    expect(workerDock.handleIndependentActivity).toHaveBeenCalledWith(snapshot);
    expect(mainDispatch).not.toHaveBeenCalled();
    host.state.appState.sessionId = 'another';
    emit?.(snapshot);
    expect(workerDock.handleIndependentActivity).toHaveBeenCalledTimes(1);
    handler.startSubscription();
    expect(stopSession).toHaveBeenCalledTimes(1);
    expect(stopIndependent).toHaveBeenCalledTimes(1);
    host.sessionEventUnsubscribe?.();
    expect(stopIndependent).toHaveBeenCalledTimes(2);
  });
});
