import { describe, expect, it } from 'vitest';
import { buildCard, dedupeCards, pickNextCard, type RawCardInput } from '../../../src/autopilot/intake';

describe('autopilot intake', () => {
  it('scores bug keywords higher', () => {
    const normal = buildCard({ source: 'github-issue', title: 'Add docs', body: 'improve readme' });
    const bug = buildCard({ source: 'github-issue', title: 'Fix crash bug', body: 'critical error regression' });
    expect(bug.score).toBeGreaterThan(normal.score);
  });
  it('fingerprints dedupe identical issues', () => {
    const c1 = buildCard({ source: 'github-issue', title: 'Fix crash', body: 'x', refNumber: 1 });
    const c2 = buildCard({ source: 'github-issue', title: 'Fix crash', body: 'x', refNumber: 1 });
    expect(c1.fingerprint).toBe(c2.fingerprint);
    expect(dedupeCards([c1, c2])).toHaveLength(1);
  });
  it('pickNextCard returns highest scored queued', () => {
    const low = buildCard({ source: 'manual', title: 'A', body: 'x' });
    const high = buildCard({ source: 'manual', title: 'B', body: 'urgent critical bug crash' });
    const next = pickNextCard([low, high]);
    expect(next?.id).toBe(high.id);
  });
  it('pickNextCard returns undefined when nothing queued', () => {
    const c = buildCard({ source: 'manual', title: 'A', body: 'x' });
    expect(pickNextCard([{ ...c, status: 'merged' }])).toBeUndefined();
  });
});
