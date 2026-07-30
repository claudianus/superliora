import { UpdatePreferenceSelectorComponent } from '../../components/dialogs/picker/update-preference-selector';
import { saveTuiConfig } from '../../config';
import { formatErrorMessage } from '../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import type { SlashCommandHost } from '../hub/dispatch';
import { tuiConfigFromHost } from './tui-persist';

type UpdatePreferenceHost = {
  readonly state: {
    readonly appState: Pick<
      SlashCommandHost['state']['appState'],
      'theme' | 'editorCommand' | 'notifications' | 'upgrade' | 'appearance' | 'disablePasteBurst' | 'permissionMode'
    >;
  };
  setAppState(patch: Pick<SlashCommandHost['state']['appState'], 'upgrade'>): void;
  showStatus(msg: string, color?: string): void;
  track: SlashCommandHost['track'];
};

export function showUpdatePreferencePicker(host: SlashCommandHost): void {
  mountPickerDialog(host,
    new UpdatePreferenceSelectorComponent({
      currentValue: host.state.appState.upgrade.autoInstall,
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyUpdatePreferenceChoice(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
}

export async function applyUpdatePreferenceChoice(
  host: UpdatePreferenceHost,
  autoInstall: boolean,
): Promise<void> {
  if (autoInstall === host.state.appState.upgrade.autoInstall) {
    host.showStatus(`Automatic updates already ${autoInstall ? 'enabled' : 'disabled'}.`);
    return;
  }

  const upgrade = { autoInstall };
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { upgrade }));
  } catch (error) {
    host.showStatus(
      `Failed to save automatic update setting: ${formatErrorMessage(error)}`,
      'error',
    );
    return;
  }

  host.setAppState({ upgrade });
  host.track('upgrade_preference_changed', { auto_install: autoInstall });
  host.showStatus(`Automatic updates ${autoInstall ? 'enabled' : 'disabled'}.`);
}
