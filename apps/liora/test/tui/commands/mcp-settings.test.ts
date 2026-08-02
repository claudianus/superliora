import { describe, expect, it, vi } from 'vitest';

import {
  MCP_ALLOWLIST_TIP,
  MCP_CONFIG_SCOPES_TIP,
  MCP_OAUTH_TIP,
  showMcpSettings,
} from '#/tui/commands/config/mcp/mcp-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeMcpSettingsHost(
  options: {
    hasSession?: boolean;
    servers?: Array<{
      name: string;
      transport: string;
      status: string;
      toolCount: number;
    }>;
  } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  const mountCenterModal = vi.fn();
  const listMcpServers = vi.fn(async () => options.servers ?? []);
  return {
    harness: { homeDir: '/home/.superliora' },
    state: {
      centerModalStack: [],
      transcriptContainer,
      appState: { workDir: '/tmp/ws' },
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal,
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no active session');
          })
        : vi.fn(() => ({ listMcpServers, workDir: '/tmp/ws' })),
  } as unknown as SlashCommandHost;
}

function selectMcpAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('mcp settings tips', () => {
  it('exports config scopes, OAuth, and allowlist tips (glance copy, not menu rows)', () => {
    expect(MCP_CONFIG_SCOPES_TIP).toContain('mcp.json');
    expect(MCP_CONFIG_SCOPES_TIP).toContain('.superliora');
    expect(MCP_OAUTH_TIP).toContain('/mcp-config login');
    expect(MCP_ALLOWLIST_TIP).toContain('enabledTools');
  });
});

describe('showMcpSettings', () => {
  it('mounts ChoicePicker with status, manage, and read-only tip actions — tip-free', () => {
    const host = makeMcpSettingsHost();
    showMcpSettings(host);
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

  it('mounts glance panel with live listMcpServers count', async () => {
    const host = makeMcpSettingsHost({
      servers: [
        { name: 'demo', transport: 'stdio', status: 'connected', toolCount: 4 },
        { name: 'off', transport: 'http', status: 'disabled', toolCount: 0 },
      ],
    });
    showMcpSettings(host);
    selectMcpAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    expect(host.requireSession().listMcpServers).toHaveBeenCalled();
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Live session: 2 server(s)');
    expect(text).toContain('1 connected');
    expect(text).toContain('demo — connected');
  });

  it('works without session', async () => {
    const host = makeMcpSettingsHost({ hasSession: false });
    showMcpSettings(host);
    selectMcpAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('open a session to inspect MCP connection status');
  });
});
