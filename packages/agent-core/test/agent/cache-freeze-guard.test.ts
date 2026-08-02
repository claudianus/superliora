import { describe, expect, it } from 'vitest';

import {
  CACHE_FREEZE_DRIFT_SENSOR_ORIGIN,
  CacheFreezeGuard,
  buildTurnPrefixMaterial,
  formatCacheFreezeDriftTip,
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

  // Loop20a: multi-step soft re-check pattern (mirrors step-loop beforeStep).
  it('checkUnchanged re-checks after freeze without throw; counts violations', () => {
    const guard = new CacheFreezeGuard();
    const material = buildTurnPrefixMaterial(['Read', 'Write', 'Bash']);
    guard.freeze(material);
    for (let step = 0; step < 3; step += 1) {
      expect(guard.checkUnchanged(material, 'tool list')).toBe(true);
    }
    expect(guard.getViolationCount()).toBe(0);
    const drifted = buildTurnPrefixMaterial(['Read', 'Write', 'Bash', 'DeepResearch']);
    expect(guard.checkUnchanged(drifted, 'tool list')).toBe(false);
    expect(guard.getViolationCount()).toBe(1);
    expect(guard.getLastViolationLabel()).toBe('tool list');
    // Soft path must not throw; hard path still does.
    expect(() => {
      guard.assertUnchanged(drifted, 'tool list');
    }).toThrow(/tool list changed mid-turn/);
    expect(guard.getViolationCount()).toBe(2);
  });

  // Loop32a: live wire tip helpers for mid-turn drift notices.
  it('formatCacheFreezeDriftTip names violations and stable code', () => {
    const tip = formatCacheFreezeDriftTip(3, 'tool list');
    expect(tip.startsWith('CACHE_FREEZE_DRIFT:')).toBe(true);
    expect(tip).toContain('drift×3');
    expect(tip).toContain('tool list');
    expect(tip).toContain('code=CACHE_FREEZE_DRIFT');
    expect(CACHE_FREEZE_DRIFT_SENSOR_ORIGIN).toBe('cache-freeze-drift-sensor');
  });
});
