import { describe, expect, it } from 'vitest';

import {
  buildHostSessionLiveLines,
  resolveSovereignUmbrellaSoftGates,
} from '#/tui/utils/host/sovereign-umbrella-glance';

describe('sovereign-umbrella-glance', () => {
  it('resolveSovereignUmbrellaSoftGates keeps hide-legacy ON and warm ON by default without umbrella env', () => {
    const gates = resolveSovereignUmbrellaSoftGates({});
    expect(gates.coreProfile).toBe(false);
    expect(gates.hideLegacy).toBe(true);
    expect(gates.warm).toBe(true);
  });

  it('resolveSovereignUmbrellaSoftGates allows warm opt-out via SUPERLIORA_REPO_INDEX_WARM=0', () => {
    const gates = resolveSovereignUmbrellaSoftGates({ SUPERLIORA_REPO_INDEX_WARM: '0' });
    expect(gates.warm).toBe(false);
  });

  it('resolveSovereignUmbrellaSoftGates enables all gates when SUPERLIORA_SOVEREIGN=1', () => {
    const gates = resolveSovereignUmbrellaSoftGates({ SUPERLIORA_SOVEREIGN: '1' });
    expect(gates.coreProfile).toBe(true);
    expect(gates.hideLegacy).toBe(true);
    expect(gates.warm).toBe(true);
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
  });
});
