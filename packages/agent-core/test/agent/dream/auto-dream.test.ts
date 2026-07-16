import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AutoDreamService, parseDreamPlan } from '../../../src/agent/dream/auto-dream';
import { LioraRecallStore } from '../../../src/memory/store';
import type { MemoryRecord } from '../../../src/memory/types';
import type { Agent } from '../../../src/agent';

function makeRecord(id: string, subject: string, content: string): MemoryRecord {
  const now = Date.now();
  return { id, kind: 'semantic', scope: 'workspace', subject, content, tags: [], confidence: 0.8, importance: 0.5, status: 'active', source: { kind: 'auto' }, createdAt: now, updatedAt: now, accessCount: 0, supersedes: [], metadata: {} };
}
function fakeAgent(o: Partial<Agent> = {}): Agent {
  return { experimentalFlags: { enabled: () => true, enabledIds: () => [] }, log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }, kimiConfig: {}, config: { provider: { withThinking: () => ({}) } }, modelProvider: undefined, generate: vi.fn(), ...o } as unknown as Agent;
}
function createStore() { const dir = mkdtempSync(join(tmpdir(), 'dream-')); return { store: new LioraRecallStore({ homeDir: dir }), dir }; }

describe('parseDreamPlan', () => {
  const records = [makeRecord('r1', 'tabs', 'use tabs'), makeRecord('r2', 'tab indent', 'tabs over spaces'), makeRecord('r3', 'friday', 'ship friday')];
  it('parses a valid merge plan', () => {
    const p = parseDreamPlan(JSON.stringify({ merges: [{ keeperId: 'r1', duplicateIds: ['r2'] }] }), records);
    expect(p.merges).toHaveLength(1); expect(p.merges[0]?.keeperId).toBe('r1');
  });
  it('drops merges with unknown ids', () => {
    expect(parseDreamPlan(JSON.stringify({ merges: [{ keeperId: 'x', duplicateIds: ['r2'] }] }), records).merges).toEqual([]);
  });
  it('returns empty for unparseable text', () => {
    expect(parseDreamPlan('no json', records).merges).toEqual([]);
  });
});


describe('auto_dream flag', () => {
  it('defaults the auto_dream flag on', async () => {
    const { FLAG_DEFINITIONS, FlagResolver } = await import('../../../src/flags');
    expect(new FlagResolver({}, FLAG_DEFINITIONS).enabled('auto_dream')).toBe(true);
  });
});
describe('AutoDreamService', () => {
  it('restores store on LLM failure', async () => {
    const { store } = createStore();
    await store.remember({ kind: 'semantic', scope: 'workspace', subject: 'A', content: 'a' });
    await store.remember({ kind: 'semantic', scope: 'workspace', subject: 'B', content: 'b' });
    const orig = readFileSync(store.getStorePath());
    const agent = fakeAgent({ generate: vi.fn().mockRejectedValue(new Error('LLM down')) });
    const svc = new AutoDreamService(agent, store, { minActiveRecords: 2, minHoursSinceLastDream: 0 });
    await expect(svc['runDream']()).rejects.toThrow('LLM down');
    expect(readFileSync(store.getStorePath()).equals(orig)).toBe(true);
  });
  it('merges records per LLM plan', async () => {
    const { store } = createStore();
    const a = await store.remember({ kind: 'semantic', scope: 'workspace', subject: 'tabs', content: 'indent tabs' });
    const b = await store.remember({ kind: 'semantic', scope: 'workspace', subject: 'tab pref', content: 'tabs not spaces' });
    const c = await store.remember({ kind: 'semantic', scope: 'workspace', subject: 'friday', content: 'ship friday' });
    const plan = JSON.stringify({ merges: [{ keeperId: a.id, duplicateIds: [b.id] }] });
    const agent = fakeAgent({ generate: vi.fn().mockResolvedValue({ message: { content: [{ type: 'text', text: plan }] }, finishReason: 'stop', usage: null }) });
    const svc = new AutoDreamService(agent, store, { minActiveRecords: 2, minHoursSinceLastDream: 0 });
    const result = await svc['runDream']();
    expect(result?.semanticMerged).toBe(1);
    expect((await store.get(b.id))?.status).toBe('superseded');
    expect((await store.get(c.id))?.status).toBe('active');
  });
});
