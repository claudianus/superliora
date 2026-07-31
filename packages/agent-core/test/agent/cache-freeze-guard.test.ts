import { describe, expect, it } from 'vitest';

import {
  CacheFreezeGuard,
  buildTurnPrefixMaterial,
  hashPrefixMaterial,
} from '../../src/agent/cache/cache-freeze-guard';

describe('CacheFreezeGuard', () => {
  it('starts unfrozen', () => {
    const guard = new CacheFreezeGuard();
    expect(guard.isFrozen()).toBe(false);
  });

  it('freeze + assertUnchanged passes for identical material', () => {
    const guard = new CacheFreezeGuard();
    guard.freeze('alpha\nbeta');
    expect(guard.isFrozen()).toBe(true);
    expect(() =>{  guard.assertUnchanged('alpha\nbeta'); }).not.toThrow();
  });

  it('assertUnchanged throws when material changes mid-turn', () => {
    const guard = new CacheFreezeGuard();
    guard.freeze('tools:v1');
    expect(() =>{  guard.assertUnchanged('tools:v2', 'tool list'); }).toThrow(
      /CacheFreezeGuard: tool list changed mid-turn/,
    );
  });

  it('clear resets frozen state', () => {
    const guard = new CacheFreezeGuard();
    guard.freeze('x');
    guard.clear();
    expect(guard.isFrozen()).toBe(false);
    expect(() =>{  guard.assertUnchanged('y'); }).not.toThrow();
  });

  it('buildTurnPrefixMaterial sorts tool names', () => {
    expect(buildTurnPrefixMaterial(['Edit', 'Read', 'Grep'])).toBe('Edit\nGrep\nRead');
  });

  it('hashPrefixMaterial is stable and truncated', () => {
    const a = hashPrefixMaterial('same');
    const b = hashPrefixMaterial('same');
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });
});
