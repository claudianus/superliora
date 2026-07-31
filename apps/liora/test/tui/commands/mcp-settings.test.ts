import { describe, expect, it, vi } from 'vitest';

import { showMcpSettings } from '#/tui/commands/config/mcp-settings';

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
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no active session');
          })
        : vi.fn(() => ({ listMcpServers, workDir: '/tmp/ws' })),
  } as never;
}

describe('mcp settings', () => {
  it('opens picker with live status and manage entries', () => {
    const host = makeMcpSettingsHost();
    showMcpSettings(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    const [component] = host.mountCenterModal.mock.calls[0] as [
      { render: (width: number) => string[] },
    ];
    const body = component.render(100).join('\n');
    expect(body).toContain('Live status');
    expect(body).toContain('Manage servers');
  });

  it('mounts glance panel with live listMcpServers count', async () => {
    const host = makeMcpSettingsHost({
      servers: [
        { name: 'demo', transport: 'stdio', status: 'connected', toolCount: 4 },
        { name: 'off', transport: 'http', status: 'disabled', toolCount: 0 },
      ],
    });
    showMcpSettings(host);
    const [component] = host.mountCenterModal.mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    component.handleInput('\r');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    expect(host.requireSession().listMcpServers).toHaveBeenCalled();
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const text = panel.buildLines(1).join('\n');
    expect(text).toContain('Live session: 2 server(s)');
    expect(text).toContain('1 connected');
    expect(text).toContain('demo — connected');
  });

  it('works without session', async () => {
    const host = makeMcpSettingsHost({ hasSession: false });
    showMcpSettings(host);
    const [component] = host.mountCenterModal.mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    component.handleInput('\r');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const text = panel.buildLines(1).join('\n');
    expect(text).toContain('open a session to inspect MCP connection status');
  });
});
