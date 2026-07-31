import { describe, expect, it, vi } from 'vitest';

import { showSecuritySettings } from '#/tui/commands/config/security-settings';

function makeSecurityHost(
  options: {
    hasSession?: boolean;
    permissionMode?: 'manual' | 'auto' | 'yolo';
    sessionPermission?: 'manual' | 'auto' | 'yolo';
    sandboxProfile?: 'off' | 'workspace' | 'read-only';
    pendingInterventions?: number;
  } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  const getStatus = vi.fn(async () => ({
    permission: options.sessionPermission ?? options.permissionMode ?? 'manual',
    pendingInterventions: options.pendingInterventions,
    oldestInterventionAgeMs: options.pendingInterventions ? 30_000 : undefined,
  }));
  const listMcpServers = vi.fn(async () => [
    { name: 'demo', transport: 'stdio', status: 'connected', toolCount: 1 },
  ]);
  const getResumeState = vi.fn(() =>
    options.hasSession === false
      ? undefined
      : {
          sessionMetadata: {
            custom: {
              sandboxProfile: options.sandboxProfile ?? 'workspace',
            },
          },
        },
  );
  const session = {
    getStatus,
    listMcpServers,
    getResumeState,
  };
  return {
    state: {
      transcriptContainer,
      appState: {
        permissionMode: options.permissionMode ?? 'manual',
        workDir: '/tmp/security-panel',
        additionalDirs: [] as string[],
      },
      renderer: { invalidateFrame: vi.fn() },
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => session),
  } as never;
}

describe('security settings', () => {
  it('mounts panel with live permission, sandbox, and MCP from session', async () => {
    const host = makeSecurityHost({
      permissionMode: 'auto',
      sessionPermission: 'auto',
      sandboxProfile: 'read-only',
      pendingInterventions: 1,
    });
    await showSecuritySettings(host);
    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const text = panel.buildLines(1).join('\n');
    expect(text).toContain('Security glance');
    expect(text).toContain('live session confirms');
    expect(text).toContain('Sandbox profile: read-only');
    expect(text).toContain('Never-Halt queue');
    expect(text).toContain('1 server(s)');
    expect(text).toContain('Network egress');
    expect(host.requireSession().getStatus).toHaveBeenCalled();
    expect(host.requireSession().listMcpServers).toHaveBeenCalled();
  });

  it('works without session using TUI state and network env only', async () => {
    const host = makeSecurityHost({ hasSession: false, permissionMode: 'manual' });
    await showSecuritySettings(host);
    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const text = panel.buildLines(1).join('\n');
    expect(text).toContain('/tmp/security-panel');
    expect(text).toContain('no active session');
    expect(text).not.toContain('live session confirms');
  });
});
