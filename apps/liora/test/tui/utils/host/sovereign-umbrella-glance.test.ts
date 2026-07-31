import { describe, expect, it } from 'vitest';

import {
  buildHostSessionLiveLines,
  resolveSovereignUmbrellaSoftGates,
} from '#/tui/utils/host/sovereign-umbrella-glance';

describe('sovereign-umbrella-glance', () => {
  it('resolveSovereignUmbrellaSoftGates keeps all gates OFF without umbrella env', () => {
    const gates = resolveSovereignUmbrellaSoftGates({});
    expect(gates.coreProfile).toBe(false);
    expect(gates.hideLegacy).toBe(false);
    expect(gates.warm).toBe(false);
    expect(gates.dualEmitMission).toBe(false);
    expect(gates.dualEmitFleet).toBe(false);
  });

  it('resolveSovereignUmbrellaSoftGates enables all gates when SUPERLIORA_SOVEREIGN=1', () => {
    const gates = resolveSovereignUmbrellaSoftGates({ SUPERLIORA_SOVEREIGN: '1' });
    expect(gates.coreProfile).toBe(true);
    expect(gates.hideLegacy).toBe(true);
    expect(gates.warm).toBe(true);
    expect(gates.dualEmitMission).toBe(true);
    expect(gates.dualEmitFleet).toBe(true);
  });

  it('buildHostSessionLiveLines is empty when umbrella env is unset', () => {
    expect(buildHostSessionLiveLines({ env: {} })).toEqual([]);
  });

  it('buildHostSessionLiveLines lists ON gates when SUPERLIORA_SOVEREIGN=1', () => {
    const text = buildHostSessionLiveLines({ env: { SUPERLIORA_SOVEREIGN: '1' } }).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Sovereign umbrella: ON');
    expect(text).toContain('· core profile: ON');
    expect(text).toContain('· hide-legacy: ON');
    expect(text).toContain('· codemap warm: ON');
    expect(text).toContain('· mission dual-emit: ON');
    expect(text).toContain('· fleet dual-emit: ON');
  });
});
