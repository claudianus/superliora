import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { handlePermissionCommand, showPermissionPicker } from '#/tui/commands/config/permission/permission';
import { DEFAULT_APPEARANCE_PREFERENCES, loadTuiConfig } from '#/tui/config';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(mode: 'manual' | 'auto' | 'yolo' = 'manual') {
  const session = {
    setPermission: vi.fn(async () => {}),
  };
  const host = {
    requireSession: vi.fn(() => session),
    state: {
      appState: {
        theme: 'dark',
        permissionMode: mode,
        disablePasteBurst: false,
        editorCommand: null,
        notifications: { enabled: true, condition: 'unfocused' },
        upgrade: { autoInstall: true },
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
      },
      centerModalStack: [] as readonly unknown[],
    },
    setAppState: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(host.state.appState, patch);
    }),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    showError: vi.fn(),
    showNotice: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost & {
    requireSession: ReturnType<typeof vi.fn>;
    state: { appState: { permissionMode: string }; centerModalStack: readonly unknown[] };
    setAppState: ReturnType<typeof vi.fn>;
    mountCenterModal: ReturnType<typeof vi.fn>;
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
    expect(host.mountCenterModal).toHaveBeenCalledTimes(1);
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.requireSession).not.toHaveBeenCalled();
  });

  it('sets a valid mode directly and persists it', async () => {
    const previousHome = process.env['SUPERLIORA_HOME'];
    const home = await mkdtemp(join(tmpdir(), 'liora-permission-'));
    process.env['SUPERLIORA_HOME'] = home;
    try {
      const { host, session } = makeHost('manual');
      await handlePermissionCommand(host, 'yolo');
      expect(session.setPermission).toHaveBeenCalledWith('yolo');
      expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'yolo' });
      expect((await loadTuiConfig()).permissionMode).toBe('yolo');
      expect(host.mountEditorReplacement).not.toHaveBeenCalled();
    } finally {
      await rm(home, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env['SUPERLIORA_HOME'];
      else process.env['SUPERLIORA_HOME'] = previousHome;
    }
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
    expect(host.mountCenterModal).toHaveBeenCalledTimes(1);
  });
});
