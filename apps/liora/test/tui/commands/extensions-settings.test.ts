import { describe, expect, it, vi } from 'vitest';

import {
  EXTENSIONS_AUDIT_TIP,
  EXTENSIONS_HOT_RELOAD_TIP,
  EXTENSIONS_MANAGE_TIP,
  showExtensionsSettings,
} from '#/tui/commands/config/extensions/extensions-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeExtensionsHost(
  options: {
    hasSession?: boolean;
    plugins?: readonly {
      id: string;
      enabled: boolean;
      hasErrors: boolean;
      hookCount: number;
    }[];
  } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  const listPlugins = vi.fn(async () =>
    options.hasSession === false
      ? []
      : (options.plugins ?? [
          { id: 'p1', enabled: true, hasErrors: false, hookCount: 2 },
        ]),
  );
  const listSkills = vi.fn(async () => [
    { name: 'write-tui', description: '', source: 'builtin', path: '/builtin/write-tui' },
  ]);
  const listMcpServers = vi.fn(async () => [
    { name: 'fs', transport: 'stdio', status: 'connected', toolCount: 3 },
  ]);
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
        : vi.fn(() => ({ listPlugins, listSkills, listMcpServers })),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectExtensionsAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('extensions settings tips', () => {
  it('exports audit, manage paths, and hot-reload tips (glance copy, not menu rows)', () => {
    expect(EXTENSIONS_AUDIT_TIP).toContain('/extensions');
    expect(EXTENSIONS_MANAGE_TIP).toContain('/plugins');
    expect(EXTENSIONS_HOT_RELOAD_TIP).toContain('Hot-reload');
  });
});

describe('showExtensionsSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeExtensionsHost();
    showExtensionsSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'manage',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('mounts read-only extensions panel with live session counts', async () => {
    const host = makeExtensionsHost();
    showExtensionsSettings(host);
    selectExtensionsAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Extensions (read-only)');
    expect(lines).toContain('── Session (live)');
    expect(lines).toContain('Plugins: 1 installed · 1 enabled');
    expect(lines).toContain('Skills: 1 in catalog');
    expect(lines).toContain('MCP: 1 server(s)');
    expect(lines).toContain('Hooks: 2 from 1 enabled plugin(s)');
    expect(lines).toContain('/extensions');
    expect(host.requireSession().listPlugins).toHaveBeenCalled();
  });

  it('works without session', async () => {
    const host = makeExtensionsHost({ hasSession: false });
    showExtensionsSettings(host);
    selectExtensionsAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('session unavailable');
    expect(text).not.toContain('1 installed');
  });
});
