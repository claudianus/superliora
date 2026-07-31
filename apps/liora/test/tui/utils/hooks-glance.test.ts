import { describe, expect, it } from 'vitest';

import {
  buildHooksSettingsLines,
  formatHookEventSummary,
} from '#/tui/utils/hooks/hooks-glance';

describe('hooks glance live registry', () => {
  it('formats event counts sorted by frequency', () => {
    expect(
      formatHookEventSummary({
        Stop: 1,
        PreToolUse: 3,
        PostToolUse: 2,
      }),
    ).toBe('PreToolUse×3 · PostToolUse×2 · Stop×1');
  });

  it('surfaces live HookEngine registry when wired', () => {
    const lines = buildHooksSettingsLines({
      configPath: '/home/.superliora/config.toml',
      registry: {
        totalCount: 4,
        events: { PreToolUse: 2, Stop: 2 },
      },
      pluginHookCount: 2,
      enabledPluginCount: 1,
    }).join('\n');
    expect(lines).toContain('Live registry (HookEngine)');
    expect(lines).toContain('4 hook(s)');
    expect(lines).toContain('PreToolUse×2 · Stop×2');
    expect(lines).toContain('Registered hooks: 4 in HookEngine');
  });

  it('falls back to session prompt when registry is absent', () => {
    const lines = buildHooksSettingsLines({
      configPath: '/home/.superliora/config.toml',
    }).join('\n');
    expect(lines).not.toContain('Live registry (HookEngine)');
    expect(lines).toContain('open a session to count enabled plugin hooks');
  });
});
