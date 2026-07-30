import { describe, expect, it, vi } from 'vitest';

import { handlePermissionCommand, showPermissionPicker } from '#/tui/commands/config/permission';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(mode: 'manual' | 'auto' | 'yolo' = 'manual') {
  const session = {
    setPermission: vi.fn(async () => {}),
  };
  const host = {
    requireSession: vi.fn(() => session),
    state: {
      appState: {
        permissionMode: mode,
      },
    },
    setAppState: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(host.state.appState, patch);
    }),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    showError: vi.fn(),
    showNotice: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost & {
    requireSession: ReturnType<typeof vi.fn>;
    state: { appState: { permissionMode: string } };
    setAppState: ReturnType<typeof vi.fn>;
    mountEditorReplacement: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    showNotice: ReturnType<typeof vi.fn>;
    showStatus: ReturnType<typeof vi.fn>;
  };
  return { host, session };
}

describe('/permission command', () => {
  it('opens the picker when args are empty', async () => {
    const { host } = makeHost('manual');
    await handlePermissionCommand(host, '');
    expect(host.mountEditorReplacement).toHaveBeenCalledTimes(1);
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.requireSession).not.toHaveBeenCalled();
  });

  it('sets a valid mode directly', async () => {
    const { host, session } = makeHost('manual');
    await handlePermissionCommand(host, 'yolo');
    expect(session.setPermission).toHaveBeenCalledWith('yolo');
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'yolo' });
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
  });

  it('rejects unknown modes without mutating state', async () => {
    const { host, session } = makeHost('auto');
    await handlePermissionCommand(host, 'turbo');
    expect(host.showError).toHaveBeenCalledTimes(1);
    expect(host.showError.mock.calls[0]?.[0]).toContain('Unknown permission mode');
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
  });

  it('reports unchanged mode without calling setPermission', async () => {
    const { host, session } = makeHost('auto');
    await handlePermissionCommand(host, 'auto');
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps showPermissionPicker available for settings hub', () => {
    const { host } = makeHost();
    showPermissionPicker(host);
    expect(host.mountEditorReplacement).toHaveBeenCalledTimes(1);
  });
});
