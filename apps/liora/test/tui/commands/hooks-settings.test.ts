import { describe, expect, it, vi } from 'vitest';

import { showHooksSettings } from '#/tui/commands/config/hooks-settings';

function makeHooksHost(
  options: { hasSession?: boolean; hookCount?: number; registry?: { totalCount: number; events: Record<string, number> } } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  const getHookRegistry = vi.fn(async () =>
    options.registry ?? { totalCount: options.hookCount ?? 2, events: { PreToolUse: options.hookCount ?? 2 } },
  );
  const listPlugins = vi.fn(async () =>
    options.hasSession === false
      ? []
      : [{ id: 'p1', enabled: true, hookCount: options.hookCount ?? 2 }],
  );
  return {
    harness: {
      homeDir: '/home/.superliora',
      configPath: '/home/.superliora/config.toml',
    },
    state: {
      transcriptContainer,
      appState: {},
      renderer: { invalidateFrame: vi.fn() },
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => ({ getHookRegistry, listPlugins })),
  } as never;
}

describe('hooks settings', () => {
  it('mounts read-only hooks panel with live registry and Pre/Post/Stop tips', async () => {
    const host = makeHooksHost({ hookCount: 3, registry: { totalCount: 3, events: { PreToolUse: 2, Stop: 1 } } });
    showHooksSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('Hooks (read-only)');
    expect(lines).toContain('Live registry (HookEngine)');
    expect(lines).toContain('PreToolUse×2 · Stop×1');
    expect(lines).toContain('Registered hooks: 3 in HookEngine');
    expect(lines).toContain('PostToolUse');
    expect(lines).toContain('config.toml [[hooks]]');
    expect(host.requireSession().getHookRegistry).toHaveBeenCalled();
  });

  it('works without session', async () => {
    const host = makeHooksHost({ hasSession: false });
    showHooksSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const text = panel.buildLines(1).join('\n');
    expect(text).toContain('/ext hooks');
    expect(text).not.toContain('Live registry (HookEngine)');
  });
});
