import { describe, expect, it, vi } from 'vitest';

import {
  SECURITY_MCP_ALLOWLIST_TIP,
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
} = {}) {
  const transcriptContainer = { addChild: vi.fn() };
  const requireSession = vi.fn(() => {
    if (options.hasSession === false) {
      throw new Error('no session');
    }
    return {
      getStatus: vi.fn(async () => ({ permission: options.permissionMode ?? 'auto' })),
      listMcpServers: vi.fn(async () => [{ status: 'connected' }]),
      getResumeState: vi.fn(() => ({
        sessionMetadata: { custom: { sandboxProfile: 'workspace' } },
      })),
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
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectSecurityAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('security settings tips', () => {
  it('exports sandbox, redaction, and MCP allowlist tips (glance copy, not menu rows)', () => {
    expect(SECURITY_SANDBOX_TIP).toContain('sandboxProfile');
    expect(SECURITY_SANDBOX_TIP).toContain('read-only');
    expect(SECURITY_REDACTION_TIP).toContain('redactSecretsInText');
    expect(SECURITY_REDACTION_TIP).toContain('redteam-soft');
    expect(SECURITY_MCP_ALLOWLIST_TIP).toContain('enabledTools');
    expect(SECURITY_MCP_ALLOWLIST_TIP).toContain('disabledTools');
  });
});

describe('showSecuritySettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeSecurityHost();
    showSecuritySettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('mounts read-only security panel for status action', async () => {
    const host = makeSecurityHost();
    showSecuritySettings(host);
    selectSecurityAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('§9.2');
    expect(lines).toContain('Sandbox profile: workspace');
    expect(lines).toContain('redactSecretsInText');
    expect(lines).toContain('enabledTools');
    expect(lines).toContain('/tmp/superliora-security');
  });

  it('renders security panel without session when unavailable', async () => {
    const host = makeSecurityHost({ hasSession: false });
    showSecuritySettings(host);
    selectSecurityAction(host, 'status');
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
