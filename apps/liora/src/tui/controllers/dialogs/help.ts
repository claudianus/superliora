import {
  advancedHelpIntro,
  advancedKeyboardShortcuts,
  HelpPanelComponent,
} from '../../components/dialogs/help/help-panel';
import { closeAllCenterModals, closeCenterModal, mountCenterModal } from './modal-shell';
import type { CommandHubDelegate } from './command-hub';
import { helpModeFromArgs, type DialogsHost } from './types';

export function showHelpPanel(
  host: DialogsHost,
  delegate: CommandHubDelegate,
  args = '',
): void {
  const mode = helpModeFromArgs(args);
  // Beginner path: `/help` opens the Command Hub, not a wall of slash names.
  if (mode === 'primary') {
    delegate.showCommandHub();
    return;
  }
  closeAllCenterModals(host);
  mountCenterModal(
    host,
    delegate,
    new HelpPanelComponent({
      commands: host.getSlashCommands(mode),
      intro: mode === 'diagnostics'
        ? 'Advanced QA commands for SuperLiora harness development.'
        : advancedHelpIntro(),
      commandSectionTitle: mode === 'diagnostics'
        ? 'Diagnostic commands'
        : mode === 'advanced'
          ? 'Advanced Mission controls'
          : 'All slash commands',
      shortcuts: mode === 'advanced' ? advancedKeyboardShortcuts() : undefined,
      onClose: () => {
        closeCenterModal(host, delegate);
      },
    }),
  );
}
