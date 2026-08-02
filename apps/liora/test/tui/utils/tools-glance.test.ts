import { describe, expect, it } from 'vitest';

import {
  HIDE_LEGACY_TOOL_NAMES_ENV,
  SHOW_LEGACY_TOOL_NAMES_ENV,
  SOVEREIGN_UMBRELLA_ENV,
  buildToolsSessionLiveLines,
  formatHideLegacyToolsStatusLine,
  isHideLegacyToolNamesEnabled,
  resolveHideLegacyToolsGlance,
} from '#/tui/utils/tool/tools-glance';
import { loadProfileLiveGlance } from '#/tui/utils/agent/profile-glance';

describe('tools-glance hide-legacy', () => {
  it('enables by default when env is unset', () => {
    expect(isHideLegacyToolNamesEnabled({})).toBe(true);
  });

  it('disables when SUPERLIORA_SHOW_LEGACY_TOOL_NAMES=1', () => {
    expect(isHideLegacyToolNamesEnabled({ [SHOW_LEGACY_TOOL_NAMES_ENV]: '1' })).toBe(false);
    expect(isHideLegacyToolNamesEnabled({ [SHOW_LEGACY_TOOL_NAMES_ENV]: 'true' })).toBe(false);
  });

  it('enables when SUPERLIORA_HIDE_LEGACY_TOOL_NAMES is non-empty', () => {
    expect(isHideLegacyToolNamesEnabled({ [HIDE_LEGACY_TOOL_NAMES_ENV]: '1' })).toBe(true);
    expect(isHideLegacyToolNamesEnabled({ [HIDE_LEGACY_TOOL_NAMES_ENV]: 'yes' })).toBe(true);
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

  it('formats default ON line with compat count from inventory filter', () => {
    const line = formatHideLegacyToolsStatusLine(
      resolveHideLegacyToolsGlance({
        hiddenCompatAliases: ['LioraReview→Review'],
        env: {},
      }),
    );
    expect(line).toBe('Hide legacy: ON (default) · 1 compat alias(es) off primary help');
  });

  it('formats OFF line when SHOW_LEGACY opt-out is set', () => {
    const line = formatHideLegacyToolsStatusLine(
      resolveHideLegacyToolsGlance({
        hiddenCompatAliases: ['LioraReview→Review'],
        env: { [SHOW_LEGACY_TOOL_NAMES_ENV]: '1' },
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
        env: {},
      }),
      profile,
    });
    expect(lines[0]).toContain('Session (live)');
    expect(lines[1]).toBe('Core waist: ON (default) · profile=core tools=12');
    expect(lines[2]).toBe('Tools: 3 active / 5 registered');
    expect(lines[3]).toContain('Hide legacy: ON (default)');
  });
});
