import { describe, expect, it } from 'vitest';

import {
  SOVEREIGN_CORE_DEFAULT_ENV,
  SOVEREIGN_UMBRELLA_ENV,
  expectedToolCountForProfile,
  formatProfileLiveStatusLine,
  formatProfileToolsBadge,
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
    expect(glance.expectedToolCount).toBe(12);
    expect(formatProfileToolsBadge(glance)).toBe('profile=core tools=12');
    expect(formatProfileLiveStatusLine(glance)).toBe(
      'Core waist: ON (default) · profile=core tools=12',
    );
  });

  it('resolves core when SUPERLIORA_SOVEREIGN_CORE=1 and profile unset', () => {
    const env = { [SOVEREIGN_CORE_DEFAULT_ENV]: '1' };
    expect(resolveEffectiveProfileName(undefined, undefined, env)).toBe('core');
    const glance = loadProfileLiveGlance({ env });
    expect(glance.sovereignCoreOptIn).toBe(true);
    expect(glance.sovereignCoreTrigger).toBe(SOVEREIGN_CORE_DEFAULT_ENV);
    expect(formatProfileLiveStatusLine(glance)).toBe(
      `Core waist: ON (${SOVEREIGN_CORE_DEFAULT_ENV}=1) · profile=core tools=12`,
    );
  });

  it('prefers SUPERLIORA_PROFILE env over hard default', () => {
    const env = {
      [SOVEREIGN_CORE_DEFAULT_ENV]: '1',
      SUPERLIORA_PROFILE: 'agent',
    };
    const glance = loadProfileLiveGlance({ env });
    expect(glance.effectiveProfile).toBe('agent');
    expect(glance.expectedToolCount).toBe(30);
    expect(isSovereignCoreDefaultEnabled(env)).toBe(true);
    expect(formatProfileToolsBadge(glance)).toBe('profile=agent tools=30');
    expect(formatProfileLiveStatusLine(glance)).toBe('Core waist: OFF · profile=agent tools=30');
  });

  it('enables sovereign core via umbrella env', () => {
    const env = { [SOVEREIGN_UMBRELLA_ENV]: '1' };
    const glance = loadProfileLiveGlance({ env });
    expect(glance.effectiveProfile).toBe('core');
    expect(glance.sovereignCoreTrigger).toBe(SOVEREIGN_UMBRELLA_ENV);
    expect(formatProfileLiveStatusLine(glance)).toBe(
      `Core waist: ON (${SOVEREIGN_UMBRELLA_ENV}=1) · profile=core tools=12`,
    );
  });

  it('uses config profile when env profile unset', () => {
    const glance = loadProfileLiveGlance({ configProfile: 'core', env: {} });
    expect(glance.effectiveProfile).toBe('core');
    expect(formatProfileLiveStatusLine(glance)).toBe(
      'Core waist: ON (default) · profile=core tools=12',
    );
  });

  it('maps bundled waist sizes for diagnostics', () => {
    expect(expectedToolCountForProfile('core')).toBe(12);
    expect(expectedToolCountForProfile('agent')).toBe(30);
    expect(expectedToolCountForProfile('custom-profile')).toBeUndefined();
  });
});
