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
  it('defaults to conductor when no env or config override', () => {
    expect(resolveEffectiveProfileName(undefined, undefined, {})).toBe('conductor');
    const glance = loadProfileLiveGlance({ env: {} });
    expect(glance.effectiveProfile).toBe('conductor');
    expect(glance.sovereignCoreOptIn).toBe(false);
    expect(glance.expectedToolCount).toBe(27); // conductor
    expect(formatProfileToolsBadge(glance)).toBe('profile=conductor tools=27');
    expect(formatProfileLiveStatusLine(glance)).toBe(
      'Conductor: ON (default) · profile=conductor tools=27',
    );
  });

  it('still defaults to conductor when SUPERLIORA_SOVEREIGN_CORE=1 and profile unset', () => {
    const env = { [SOVEREIGN_CORE_DEFAULT_ENV]: '1' };
    expect(resolveEffectiveProfileName(undefined, undefined, env)).toBe('conductor');
    const glance = loadProfileLiveGlance({ env });
    expect(glance.effectiveProfile).toBe('conductor');
    expect(glance.sovereignCoreOptIn).toBe(true);
    expect(glance.sovereignCoreTrigger).toBe(SOVEREIGN_CORE_DEFAULT_ENV);
    expect(formatProfileLiveStatusLine(glance)).toBe(
      'Conductor: ON (default) · profile=conductor tools=27',
    );
  });

  it('prefers SUPERLIORA_PROFILE env over hard default', () => {
    const env = {
      [SOVEREIGN_CORE_DEFAULT_ENV]: '1',
      SUPERLIORA_PROFILE: 'agent',
    };
    const glance = loadProfileLiveGlance({ env });
    expect(glance.effectiveProfile).toBe('agent');
    expect(glance.expectedToolCount).toBe(29);
    expect(isSovereignCoreDefaultEnabled(env)).toBe(true);
    expect(formatProfileToolsBadge(glance)).toBe('profile=agent tools=29');
    expect(formatProfileLiveStatusLine(glance)).toBe('Core waist: OFF · profile=agent tools=29');
  });

  it('enables sovereign soft flag via umbrella env without forcing core profile', () => {
    const env = { [SOVEREIGN_UMBRELLA_ENV]: '1' };
    const glance = loadProfileLiveGlance({ env });
    expect(glance.effectiveProfile).toBe('conductor');
    expect(glance.sovereignCoreTrigger).toBe(SOVEREIGN_UMBRELLA_ENV);
    expect(formatProfileLiveStatusLine(glance)).toBe(
      'Conductor: ON (default) · profile=conductor tools=27',
    );
  });

  it('uses config profile when env profile unset', () => {
    const glance = loadProfileLiveGlance({ configProfile: 'core', env: {} });
    expect(glance.effectiveProfile).toBe('core');
    expect(formatProfileLiveStatusLine(glance)).toBe('Core waist: ON · profile=core tools=12');
  });

  it('maps bundled waist sizes for diagnostics', () => {
    expect(expectedToolCountForProfile('core')).toBe(12);
    expect(expectedToolCountForProfile('agent')).toBe(29);
    expect(expectedToolCountForProfile('conductor')).toBe(27);
    expect(expectedToolCountForProfile('custom-profile')).toBeUndefined();
  });
});
