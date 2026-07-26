import { describe, expect, it } from 'vitest';

import { isRestaffSteerText } from '#/agent/ultra-swarm-run';

describe('agent/ultra-swarm-run — isRestaffSteerText', () => {
  it('returns false for empty / whitespace-only input', () => {
    expect(isRestaffSteerText('')).toBe(false);
    expect(isRestaffSteerText('   \n  ')).toBe(false);
  });

  it('accepts the canonical war-room restaff directive (case-insensitive)', () => {
    expect(isRestaffSteerText('UltraSwarm restaff requested')).toBe(true);
    expect(isRestaffSteerText('ULTRASWARM RESTAFF REQUESTED from war room')).toBe(true);
  });

  it('accepts the "restaff requested from war room" form', () => {
    expect(isRestaffSteerText('Restaff requested from war room: too many debates')).toBe(true);
  });

  it('accepts leading "restaff:" and "/swarm restaff" prefixes', () => {
    expect(isRestaffSteerText('restaff: need more reviewers')).toBe(true);
    expect(isRestaffSteerText('/swarm restaff please')).toBe(true);
  });

  it('accepts a bare leading "restaff" token', () => {
    expect(isRestaffSteerText('restaff now')).toBe(true);
    expect(isRestaffSteerText('Restaff, please add a critic.')).toBe(true);
  });

  it('accepts "request restaff" / "requested restaff" anywhere in the text', () => {
    expect(isRestaffSteerText('User said: requested restaff after review')).toBe(true);
    expect(isRestaffSteerText('please request restaff to fix coverage')).toBe(true);
  });

  it('rejects unrelated prose', () => {
    expect(isRestaffSteerText('please continue with the plan')).toBe(false);
    expect(isRestaffSteerText('The restaffed team is now in place.')).toBe(false);
  });
});
