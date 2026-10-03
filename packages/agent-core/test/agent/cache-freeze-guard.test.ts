import { describe, expect, it } from 'vitest';

import { CacheFreezeGuard, buildTurnToolBlockMaterial } from '../../src/agent/cache/cache-freeze-guard';

const bash = {
  name: 'Bash',
  description: 'Run a shell command',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
};

describe('turn prefix stability', () => {
  it('rejects schema and description drift until the owning turn clears its freeze', () => {
    const guard = new CacheFreezeGuard();
    const original = buildTurnToolBlockMaterial([bash]);
    guard.freeze(original);
    expect(() => guard.assertUnchanged(original)).not.toThrow();
    const changed = buildTurnToolBlockMaterial([{ ...bash, description: 'A changed command contract' }]);
    expect(() => guard.assertUnchanged(changed, 'tool block')).toThrow('changed mid-turn');
    const schemaChanged = buildTurnToolBlockMaterial([{ ...bash, parameters: { type: 'object', properties: { command: { type: 'number' } } } }]);
    expect(() => guard.assertUnchanged(schemaChanged, 'tool block')).toThrow('changed mid-turn');
    expect(guard.getViolationCount()).toBe(2);
    guard.clear();
    expect(() => guard.assertUnchanged(changed)).not.toThrow();
    guard.freeze(changed);
    expect(() => guard.assertUnchanged(original)).toThrow('changed mid-turn');
  });

  it('does not treat schema key insertion order as prefix drift', () => {
    const reordered = {
      ...bash,
      parameters: { required: ['command'], properties: { command: { type: 'string' } }, type: 'object' },
    };
    const guard = new CacheFreezeGuard();
    guard.freeze(buildTurnToolBlockMaterial([bash]));
    expect(() => guard.assertUnchanged(buildTurnToolBlockMaterial([reordered]))).not.toThrow();
  });

  it('reports drift without replacing the original prefix fingerprint', () => {
    const guard = new CacheFreezeGuard();
    guard.freeze('original');
    expect(guard.checkUnchanged('drift', 'tool block')).toBe(false);
    expect(guard.checkUnchanged('original')).toBe(true);
    expect(guard.getViolationCount()).toBe(1);
    expect(guard.getLastViolationLabel()).toBe('tool block');
    guard.clear();
    expect(guard.getViolationCount()).toBe(1);
  });
});
