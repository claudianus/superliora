import { describe, expect, it } from 'vitest';

import {
  HIDE_LEGACY_TOOL_NAMES_ENV,
  SOVEREIGN_UMBRELLA_ENV,
  buildToolsSessionLiveLines,
  formatHideLegacyToolsStatusLine,
  isHideLegacyToolNamesEnabled,
  resolveHideLegacyToolsGlance,
} from '#/tui/utils/tool/tools-glance';
import { loadProfileLiveGlance } from '#/tui/utils/agent/profile-glance';

describe('tools-glance hide-legacy', () => {
  it('enables when SUPERLIORA_HIDE_LEGACY_TOOL_NAMES is non-empty', () => {
    expect(isHideLegacyToolNamesEnabled({ [HIDE_LEGACY_TOOL_NAMES_ENV]: '1' })).toBe(true);
    expect(isHideLegacyToolNamesEnabled({ [HIDE_LEGACY_TOOL_NAMES_ENV]: 'yes' })).toBe(true);
    expect(isHideLegacyToolNamesEnabled({})).toBe(false);
  });

  it('enables via sovereign umbrella when explicit env is unset', () => {
    expect(isHideLegacyToolNamesEnabled({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toBe(true);
  });

  it('prefers explicit hide-legacy env as trigger over sovereign umbrella', () => {
    const glance = resolveHideLegacyToolsGlance({
      hiddenCompatAliases: ['LioraReview→Review'],
      env: {
        [HIDE_LEGACY_TOOL_NAMES_ENV]: '1',
        [SOVEREIGN_UMBRELLA_ENV]: '1',
      },
    });
    expect(glance.enabled).toBe(true);
    expect(glance.trigger).toBe(HIDE_LEGACY_TOOL_NAMES_ENV);
    expect(formatHideLegacyToolsStatusLine(glance)).toContain(
      `${HIDE_LEGACY_TOOL_NAMES_ENV}=1`,
    );
  });

  it('formats OFF line with compat count from inventory filter', () => {
    const line = formatHideLegacyToolsStatusLine(
      resolveHideLegacyToolsGlance({
        hiddenCompatAliases: ['LioraReview→Review'],
        env: {},
      }),
    );
    expect(line).toBe('Hide legacy: OFF · 1 compat alias(es) off primary help');
  });

  it('builds Session (live) block before inventory', () => {
    const profile = loadProfileLiveGlance({});
    const lines = buildToolsSessionLiveLines({
      activeCount: 3,
      registeredCount: 5,
      hideLegacy: resolveHideLegacyToolsGlance({
        hiddenCompatAliases: [],
        env: { [SOVEREIGN_UMBRELLA_ENV]: '1' },
      }),
      profile,
    });
    expect(lines[0]).toContain('Session (live)');
    expect(lines[1]).toBe('Core waist: ON (default) · Profile: core');
    expect(lines[2]).toBe('Tools: 3 active / 5 registered');
    expect(lines[3]).toContain('Hide legacy: ON');
    expect(lines[3]).toContain(`${SOVEREIGN_UMBRELLA_ENV}=1`);
  });
});
