import { describe, expect, it, vi } from 'vitest';

import {
  HOOKS_ENABLE_TIP,
  HOOKS_POST_TOOL_USE_TIP,
  HOOKS_PRE_TOOL_USE_TIP,
  HOOKS_STOP_TIP,
  showHooksSettings,
} from '#/tui/commands/config/hooks/hooks-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeHooksHost(
  options: {
    hasSession?: boolean;
    hookCount?: number;
    registry?: { totalCount: number; events: Record<string, number> };
  } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  const getHookRegistry = vi.fn(async () =>
    options.registry ?? {
      totalCount: options.hookCount ?? 2,
      events: { PreToolUse: options.hookCount ?? 2 },
    },
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
      centerModalStack: [] as readonly unknown[],
      appState: {},
      renderer: { invalidateFrame: vi.fn() },
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => ({ getHookRegistry, listPlugins })),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectHooksAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('hooks settings tips', () => {
  it('exports PreToolUse, PostToolUse, Stop, and enable tips (glance copy, not menu rows)', () => {
    expect(HOOKS_PRE_TOOL_USE_TIP).toContain('PreToolUse');
    expect(HOOKS_POST_TOOL_USE_TIP).toContain('PostToolUse');
    expect(HOOKS_STOP_TIP).toContain('Stop');
    expect(HOOKS_ENABLE_TIP).toContain('config.toml [[hooks]]');
  });
});

describe('showHooksSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeHooksHost();
    showHooksSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'extensions',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });


  it('works without session', async () => {
    const host = makeHooksHost({ hasSession: false });
    showHooksSettings(host);
    selectHooksAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('/ext hooks');
    expect(text).not.toContain('Live registry (HookEngine)');
  });
});
