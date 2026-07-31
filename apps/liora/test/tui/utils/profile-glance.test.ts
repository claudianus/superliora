import { describe, expect, it } from 'vitest';

import {
  SOVEREIGN_CORE_DEFAULT_ENV,
  SOVEREIGN_UMBRELLA_ENV,
  formatProfileLiveStatusLine,
  isSovereignCoreDefaultEnabled,
  loadProfileLiveGlance,
  resolveEffectiveProfileName,
} from '#/tui/utils/agent/profile-glance';

describe('profile-glance', () => {
  it('defaults to core when no env or config override', () => {
    expect(resolveEffectiveProfileName(undefined, undefined, {})).toBe('core');
    const glance = loadProfileLiveGlance({ env: {} });
    expect(glance.effectiveProfile).toBe('core');
    expect(glance.sovereignCoreOptIn).toBe(false);
    expect(formatProfileLiveStatusLine(glance)).toBe('Core waist: ON (default) · Profile: core');
  });

  it('resolves core when SUPERLIORA_SOVEREIGN_CORE=1 and profile unset', () => {
    const env = { [SOVEREIGN_CORE_DEFAULT_ENV]: '1' };
    expect(resolveEffectiveProfileName(undefined, undefined, env)).toBe('core');
    const glance = loadProfileLiveGlance({ env });
    expect(glance.sovereignCoreOptIn).toBe(true);
    expect(glance.sovereignCoreTrigger).toBe(SOVEREIGN_CORE_DEFAULT_ENV);
    expect(formatProfileLiveStatusLine(glance)).toBe(
      `Core waist: ON (${SOVEREIGN_CORE_DEFAULT_ENV}=1) · Profile: core`,
    );
  });

  it('prefers SUPERLIORA_PROFILE env over hard default', () => {
    const env = {
      [SOVEREIGN_CORE_DEFAULT_ENV]: '1',
      SUPERLIORA_PROFILE: 'agent',
    };
    const glance = loadProfileLiveGlance({ env });
    expect(glance.effectiveProfile).toBe('agent');
    expect(isSovereignCoreDefaultEnabled(env)).toBe(true);
    expect(formatProfileLiveStatusLine(glance)).toBe('Core waist: OFF · Profile: agent');
  });

  it('enables sovereign core via umbrella env', () => {
    const env = { [SOVEREIGN_UMBRELLA_ENV]: '1' };
    const glance = loadProfileLiveGlance({ env });
    expect(glance.effectiveProfile).toBe('core');
    expect(glance.sovereignCoreTrigger).toBe(SOVEREIGN_UMBRELLA_ENV);
    expect(formatProfileLiveStatusLine(glance)).toBe(
      `Core waist: ON (${SOVEREIGN_UMBRELLA_ENV}=1) · Profile: core`,
    );
  });

  it('uses config profile when env profile unset', () => {
    const glance = loadProfileLiveGlance({ configProfile: 'core', env: {} });
    expect(glance.effectiveProfile).toBe('core');
    expect(formatProfileLiveStatusLine(glance)).toBe('Core waist: ON (default) · Profile: core');
  });
});
