import { describe, expect, it, vi } from 'vitest';

import {
  SECURITY_MCP_ALLOWLIST_TIP,
  SECURITY_NOT_OS_SANDBOX,
  SECURITY_REDACTION_TIP,
  SECURITY_SANDBOX_TIP,
  showSecuritySettings,
} from '#/tui/commands/config/security/security-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeSecurityHost(options: {
  hasSession?: boolean;
  permissionMode?: string;
  workDir?: string;
  sandboxProfile?: 'off' | 'workspace' | 'read-only';
} = {}) {
  const transcriptContainer = { addChild: vi.fn() };
  const setConfig = vi.fn(async () => undefined);
  const setSandboxProfile = vi.fn(async () => undefined);
  const requireSession = vi.fn(() => {
    if (options.hasSession === false) {
      throw new Error('no session');
    }
    return {
      getStatus: vi.fn(async () => ({ permission: options.permissionMode ?? 'auto' })),
      listMcpServers: vi.fn(async () => [{ status: 'connected' }]),
      getResumeState: vi.fn(() => ({
        sessionMetadata: {
          custom: { sandboxProfile: options.sandboxProfile ?? 'workspace' },
        },
      })),
      setSandboxProfile,
    };
  });
  return {
    state: {
      transcriptContainer,
      centerModalStack: [] as readonly unknown[],
      appState: {
        permissionMode: options.permissionMode ?? 'auto',
        workDir: options.workDir ?? '/tmp/superliora-security',
        additionalDirs: [],
      },
      renderer: { invalidateFrame: vi.fn() },
    },
    requireSession,
    harness: { setConfig },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
    _setConfig: setConfig,
    _setSandboxProfile: setSandboxProfile,
  } as unknown as SlashCommandHost & {
    _setConfig: typeof setConfig;
    _setSandboxProfile: typeof setSandboxProfile;
  };
}

async function waitForPicker(host: SlashCommandHost): Promise<ChoicePickerComponent> {
  await vi.waitFor(() => {
    expect(host.mountCenterModal).toHaveBeenCalled();
  });
  return (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ChoicePickerComponent;
}

function selectSecurityAction(picker: ChoicePickerComponent, value: string): void {
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('security settings tips', () => {
  it('exports sandbox, redaction, and MCP allowlist tips (glance copy)', () => {
    expect(SECURITY_SANDBOX_TIP).toContain('sandboxProfile');
    expect(SECURITY_SANDBOX_TIP).toContain('read-only');
    expect(SECURITY_SANDBOX_TIP).toContain('not OS isolation');
    expect(SECURITY_NOT_OS_SANDBOX).toContain('Not an OS sandbox');
    expect(SECURITY_REDACTION_TIP).toContain('redactSecretsInText');
    expect(SECURITY_REDACTION_TIP).toContain('redteam-soft');
    expect(SECURITY_MCP_ALLOWLIST_TIP).toContain('enabledTools');
    expect(SECURITY_MCP_ALLOWLIST_TIP).toContain('disabledTools');
  });
});

describe('showSecuritySettings', () => {
  it('mounts ChoicePicker with status and three sandbox profiles — PREMIUM currentValue, no tip-only rows', async () => {
    const host = makeSecurityHost({ sandboxProfile: 'workspace' });
    showSecuritySettings(host);
    const picker = await waitForPicker(host);
    const opts = (
      picker as unknown as {
        opts: {
          currentValue?: string;
          options: readonly { value: string; label: string }[];
        };
      }
    ).opts;
    expect(opts.options.map((o) => o.value)).toEqual(['status', 'off', 'workspace', 'read-only']);
    expect(opts.options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    expect(opts.currentValue).toBe('workspace');
    expect(opts.options.every((o) => !o.label.includes('●'))).toBe(true);
  });

  it('defaults currentValue to off when session metadata has no sandbox profile', async () => {
    const host = makeSecurityHost({ hasSession: false });
    showSecuritySettings(host);
    const picker = await waitForPicker(host);
    const opts = (picker as unknown as { opts: { currentValue?: string } }).opts;
    expect(opts.currentValue).toBe('off');
  });

  it('persists sandbox profile via setConfig and live session setSandboxProfile', async () => {
    const host = makeSecurityHost({ sandboxProfile: 'off' });
    showSecuritySettings(host);
    const picker = await waitForPicker(host);
    selectSecurityAction(picker, 'workspace');
    await vi.waitFor(() => {
      expect(host._setConfig).toHaveBeenCalledWith({ sandboxProfile: 'workspace' });
    });
    await vi.waitFor(() => {
      expect(host._setSandboxProfile).toHaveBeenCalledWith('workspace');
    });
    expect(host.showStatus).toHaveBeenCalled();
    const statusMsg = String((host.showStatus as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '');
    expect(statusMsg).toMatch(/Path sandbox|OS isolation/i);
  });

  it('mounts security panel for status action with workspace profile', async () => {
    const host = makeSecurityHost();
    showSecuritySettings(host);
    const picker = await waitForPicker(host);
    selectSecurityAction(picker, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('§9.2');
    expect(lines).toContain('Sandbox profile: workspace');
    expect(lines).toContain('Not an OS sandbox');
    expect(lines).toContain('redactSecretsInText');
    expect(lines).toContain('enabledTools');
    expect(lines).toContain('/tmp/superliora-security');
  });

  it('renders security panel without session when unavailable', async () => {
    const host = makeSecurityHost({ hasSession: false });
    showSecuritySettings(host);
    const picker = await waitForPicker(host);
    selectSecurityAction(picker, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('no active session');
    expect(lines).toContain('Permission mode');
  });
});
