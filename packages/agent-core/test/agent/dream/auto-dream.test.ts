import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AutoDreamService } from '../../../src/agent/dream/auto-dream';
import { LioraMemoryStore } from '../../../src/memory/store';
import type { Agent } from '../../../src/agent';

function fakeAgent(o: Partial<Agent> = {}): Agent {
  return { experimentalFlags: { enabled: () => true, enabledIds: () => [] }, log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }, kimiConfig: {}, config: { provider: { withThinking: () => ({}) } }, modelProvider: undefined, generate: vi.fn(), ...o } as unknown as Agent;
}
function createStore() { const dir = mkdtempSync(join(tmpdir(), 'dream-')); return { store: new LioraMemoryStore({ homeDir: dir }), dir }; }

describe('auto_dream flag', () => {
  it('defaults the auto_dream flag on', async () => {
    const { FLAG_DEFINITIONS, FlagResolver } = await import('../../../src/flags');
    expect(new FlagResolver({}, FLAG_DEFINITIONS).enabled('auto_dream')).toBe(true);
  });
});
describe('AutoDreamService', () => {
  it('promotes candidates without invoking an LLM', async () => {
    const { store } = createStore();
    const candidate = await store.remember({
      type: 'fact',
      scope: 'user',
      source: { kind: 'auto' },
      subject: 'A',
      content: 'a',
    });
    const agent = fakeAgent();
    const svc = new AutoDreamService(agent, store, { minActiveRecords: 2, minHoursSinceLastDream: 0 });
    await store.remember({
      type: 'fact',
      scope: 'user',
      source: { kind: 'auto' },
      subject: 'B',
      content: 'b',
    });
    const result = await svc['runDream']();

    expect(result).toEqual({ examined: 2, merged: 0 });
    expect((await store.get(candidate.id))?.status).toBe('active');
    expect(agent.generate).not.toHaveBeenCalled();
  });
  it('rejects a candidate that duplicates an active record', async () => {
    const { store } = createStore();
    const active = await store.remember({
      type: 'fact',
      scope: 'user',
      subject: 'tabs',
      content: 'indent tabs',
    });
    const duplicate = await store.remember({
      type: 'fact',
      scope: 'user',
      source: { kind: 'auto' },
      subject: active.subject,
      content: active.content,
    });
    const svc = new AutoDreamService(fakeAgent(), store, { minActiveRecords: 1, minHoursSinceLastDream: 0 });
    const result = await svc['runDream']();

    expect(result).toEqual({ examined: 2, merged: 0 });
    expect((await store.get(duplicate.id))?.status).toBe('superseded');
    expect((await store.get(duplicate.id))?.supersededBy).toBe(active.id);
  });
});
  it('exposes operator snapshot for /status Memory', () => {
    const { store } = createStore();
    const agent = fakeAgent();
    const svc = new AutoDreamService(agent, store, { minActiveRecords: 8, minHoursSinceLastDream: 4 });
    const snap = svc.snapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.runs).toBe(0);
    expect(snap.minHours).toBe(4);
    expect(snap.minActiveRecords).toBe(8);
    expect(snap.lastDreamAt).toBeNull();
  });

