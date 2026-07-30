import type { PermissionMode } from '@superliora/sdk';

import { saveTuiConfig } from '../../config';
import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import { PermissionSelectorComponent } from '../../components/dialogs/picker/permission-selector';
import { ttui } from '#/tui/utils/tui-i18n';
import type { SlashCommandHost } from '../dispatch';
import { tuiConfigFromHost } from './tui-persist';

/** Fire-and-forget persistence of the current permission mode to tui.toml. */
function persistPermissionMode(host: SlashCommandHost): Promise<void> {
  return saveTuiConfig(tuiConfigFromHost(host));
}

export async function handleYoloCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const currentMode = host.state.appState.permissionMode;

  if (subcmd === 'on') {
    if (currentMode === 'yolo') {
      host.showNotice(ttui('tui.permission.yolo.alreadyOn'));
      return;
    }
    await session.setPermission('yolo');
    host.setAppState({ permissionMode: 'yolo' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.yolo.on.title'), ttui('tui.permission.yolo.on.detail'), { coalesceKey: 'permission-mode-yolo' });
    return;
  }

  if (subcmd === 'off') {
    if (currentMode !== 'yolo') {
      host.showNotice(ttui('tui.permission.yolo.alreadyOff'));
      return;
    }
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.yolo.off.title'), undefined, { coalesceKey: 'permission-mode-yolo' });
    return;
  }

  // toggle
  if (currentMode === 'yolo') {
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.yolo.off.title'), undefined, { coalesceKey: 'permission-mode-yolo' });
  } else {
    await session.setPermission('yolo');
    host.setAppState({ permissionMode: 'yolo' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.yolo.on.title'), ttui('tui.permission.yolo.on.detail'), { coalesceKey: 'permission-mode-yolo' });
  }
}

export async function handleAutoCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const currentMode = host.state.appState.permissionMode;

  if (subcmd === 'on') {
    if (currentMode === 'auto') {
      host.showNotice(ttui('tui.permission.auto.alreadyOn'));
      return;
    }
    await session.setPermission('auto');
    host.setAppState({ permissionMode: 'auto' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.auto.on.title'), ttui('tui.permission.auto.on.detail'), { coalesceKey: 'permission-mode-auto' });
    return;
  }

  if (subcmd === 'off') {
    if (currentMode !== 'auto') {
      host.showNotice(ttui('tui.permission.auto.alreadyOff'));
      return;
    }
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.auto.off.title'), undefined, { coalesceKey: 'permission-mode-auto' });
    return;
  }

  // toggle
  if (currentMode === 'auto') {
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.auto.off.title'), undefined, { coalesceKey: 'permission-mode-auto' });
  } else {
    await session.setPermission('auto');
    host.setAppState({ permissionMode: 'auto' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.auto.on.title'), ttui('tui.permission.auto.on.detail'), { coalesceKey: 'permission-mode-auto' });
  }
}

export function showPermissionPicker(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new PermissionSelectorComponent({
      currentValue: host.state.appState.permissionMode,
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyPermissionChoice(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Permission' },
  );
}

function isPermissionModeArg(value: string): value is PermissionMode {
  return value === 'manual' || value === 'auto' || value === 'yolo';
}

/**
 * `/permission [manual|auto|yolo]` — set the mode directly, or open the picker
 * when no valid mode token is provided.
 */
export async function handlePermissionCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const token = args.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (token.length === 0) {
    showPermissionPicker(host);
    return;
  }
  if (!isPermissionModeArg(token)) {
    host.showError(
      `Unknown permission mode: ${token}. Use manual, auto, or yolo (or omit args for the picker).`,
    );
    return;
  }
  await applyPermissionChoice(host, token);
}

async function applyPermissionChoice(host: SlashCommandHost, mode: PermissionMode): Promise<void> {
  if (mode === host.state.appState.permissionMode) {
    host.showStatus(ttui('tui.permission.mode.unchanged', { mode }));
    return;
  }

  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to set permission mode: ${msg}`);
    return;
  }

  host.setAppState({ permissionMode: mode });
  host.showNotice(ttui('tui.permission.mode.set', { mode }));
}
