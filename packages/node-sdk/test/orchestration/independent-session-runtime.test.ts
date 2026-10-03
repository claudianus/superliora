import { describe, expect, it, vi } from 'vitest';
import { Session } from '../../src/session/session';
import { createIndependentSessionRuntime } from '../../src/orchestration';
import type { SDKRpcClientBase } from '../../src/rpc/rpc';
import type { Event } from '../../src/session/events';

function fixture() {
  const listeners = new Set<(event: Event) => void>();
  const closed = Promise.withResolvers<void>();
  const rpc = {
    onEvent: (listener: (event: Event) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    closeSession: vi.fn(() => closed.promise),
    clearSessionHandlers: vi.fn(),
  };
  const session = new Session({ id: 'coord_test', workDir: '/workspace', rpc: rpc as unknown as SDKRpcClientBase });
  const harness = { createSession: vi.fn(async () => session), resumeSession: vi.fn(async () => session) };
  const emit = (event: Event) => { for (const listener of listeners) listener(event); };
  const started = (turnId = 7): Event => ({ type: 'turn.started', turnId, origin: { kind: 'user' }, agentId: 'main', sessionId: session.id });
  const ended = (turnId = 7, reason: 'completed' | 'failed' | 'cancelled' = 'completed'): Event => ({ type: 'turn.ended', turnId, reason, agentId: 'main', sessionId: session.id });
  return { session, harness, rpc, closed, emit, started, ended, listeners };
}
const request = { prompt: 'Task', description: 'Task', cwd: '/workspace' };
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

describe('independent SDK execution uses terminal events and physical close', () => {
  it('does not equate prompt ACK or unrelated terminal events with completion', async () => {
    const f = fixture();
    const activity = vi.fn();
    const runtime = createIndependentSessionRuntime(f.harness, activity);
    const handle = await runtime.admit('coord_test', request, new AbortController().signal);
    let completed = false;
    void handle.completion.then(() => { completed = true; });
    await flush();
    expect(f.rpc.prompt).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    expect(f.rpc.closeSession).not.toHaveBeenCalled();
    f.emit(f.ended(99));
    f.emit(f.started());
    f.emit({ ...f.ended(), agentId: 'other-agent' });
    await flush();
    expect(f.rpc.closeSession).not.toHaveBeenCalled();
    f.emit(f.ended());
    await flush();
    expect(f.rpc.closeSession).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    f.closed.resolve();
    await handle.completion;
    expect(completed).toBe(true);
    expect(activity).toHaveBeenCalledTimes(4);
    expect(f.listeners.size).toBe(0);
  });

  it('subscribes before prompt so a synchronous turn cannot be missed', async () => {
    const f = fixture();
    f.rpc.prompt.mockImplementation(async () => { f.emit(f.started()); f.emit(f.ended()); });
    const handle = await createIndependentSessionRuntime(f.harness).admit('coord_test', request, new AbortController().signal);
    f.closed.resolve();
    await expect(handle.completion).resolves.toBeUndefined();
  });

  it('waits for physical close after cancellation ACK even without a started turn', async () => {
    const f = fixture();
    const controller = new AbortController();
    const handle = await createIndependentSessionRuntime(f.harness).admit('coord_test', request, controller.signal);
    const outcome = handle.completion.catch((error: unknown) => error);
    let completed = false;
    void outcome.then(() => { completed = true; });
    controller.abort(new Error('Stop'));
    await flush();
    expect(f.rpc.cancel).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    f.closed.resolve();
    await expect(outcome).resolves.toMatchObject({ message: 'Stop' });
  });

  it('reports cleanup failure as unsettled and uses real session resume', async () => {
    const f = fixture();
    const runtime = createIndependentSessionRuntime(f.harness);
    const handle = await runtime.resume!('coord_test', request, new AbortController().signal);
    const outcome = handle.completion.catch((error: unknown) => error);
    expect(f.harness.resumeSession).toHaveBeenCalledWith({ id: 'coord_test' });
    expect(f.harness.createSession).not.toHaveBeenCalled();
    f.emit(f.started());
    f.emit(f.ended());
    f.closed.reject(new Error('Process remains live'));
    await expect(outcome).resolves.toMatchObject({ name: 'IndependentSessionUnsettledError' });
  });
});
