import {
  buildDefaultCommandHubItems,
  commandHubKeepsOpen,
  CommandHubComponent,
  commandHubNestsPicker,
  cyclePermissionMode,
  isCommandHubCycleId,
  type CommandHubItem,
  type CommandHubSelectMode,
} from '../../components/dialogs/command-hub/index';
import {
  advancedHelpIntro,
  advancedKeyboardShortcuts,
  HelpPanelComponent,
} from '../../components/dialogs/help/help-panel';
import { ShortcutsPanelComponent } from '../../components/dialogs/command-hub/shortcuts-panel';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ONBOARDING_PREFERENCES,
  saveTuiConfig,
} from '../../config';
import { openSettingsPane, showSettingsSelector } from '../../commands/config/settings';
import {
  isSettingsHubActionId,
  settingsSelectionFromHubId,
} from '../../commands/config/settings-keywords';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import {
  buildSlashJumpHubItems,
  isSlashHubActionId,
  slashNameFromHubId,
} from '../../commands/hub/slash-hub-jumps';
import { commandHubActionToSlash } from '../../utils/command/command-hub-actions';
import { noteSuccessFeedback } from '../../utils/render/feedback-vfx';
import { requestTUIContentRender } from '../../utils/render/frame-render';
import { noteHubActionUse } from '../../utils/command/hub-recents';
import type { ModalShellDelegate } from './modal-shell';
import {
  closeAllCenterModals,
  closeCenterModal,
  mountCenterModal,
  restoreInputText,
} from './modal-shell';
import type { DialogsHost } from './types';

export interface CommandHubDelegate extends ModalShellDelegate {
  showCommandHub(options?: { readonly initialQuery?: string; readonly intro?: boolean }): void;
  showTranscriptSearch(): void;
}

export function showCommandHub(
  host: DialogsHost,
  delegate: CommandHubDelegate,
  options: { readonly initialQuery?: string; readonly intro?: boolean } = {},
): void {
  if (
    host.state.activeDialog !== null &&
    host.state.activeDialog !== 'center-modal' &&
    host.state.activeDialog !== 'help'
  ) {
    return;
  }
  closeAllCenterModals(host);
  const hub = new CommandHubComponent({
    items: buildCommandHubItems(host),
    initialQuery: options.initialQuery,
    intro: options.intro === true,
    onIntroDismiss: () => {
      void markHubIntroSeen(host);
    },
    onSelect: (item, mode) => {
      handleCommandHubSelect(host, delegate, item, mode);
    },
    onCancel: () => {
      closeCenterModal(host, delegate);
    },
  });
  host.openCommandHub = hub;
  mountCenterModal(host, delegate, hub, { mode: 'push', label: 'Hub' });
  if (options.intro === true) {
    noteSuccessFeedback();
    host.state.toast.show('Command Hub — Space toggles modes · type to search', 3200);
  }
}

function buildCommandHubItems(host: DialogsHost): CommandHubItem[] {
  const signedIn =
    host.state.appState.model.trim().length > 0 ||
    Object.keys(host.state.appState.availableProviders).length > 0;
  const skillNames = new Set(host.skillCommands.map((command) => command.name));
  return [
    ...buildDefaultCommandHubItems({
      planMode: host.state.appState.planMode,
      swarmMode: host.state.appState.swarmMode,
      ultraworkMode: host.state.appState.ultraworkMode,
      premiumQualityMode: host.state.appState.premiumQualityMode,
      permissionMode: host.state.appState.permissionMode,
      model: host.state.appState.model,
      thinkingLevel: host.state.appState.thinkingLevel,
      streamingPhase: host.state.appState.streamingPhase,
      isCompacting: host.state.appState.isCompacting,
      signedIn,
    }),
    ...buildSlashJumpHubItems(host.getSlashCommands('advanced'), skillNames),
  ];
}

/** Also called directly from `LioraTUI#setAppState` when Hub-visible state changes. */
export function refreshOpenCommandHub(host: DialogsHost): void {
  const hub = host.openCommandHub;
  if (hub === undefined) return;
  hub.setItems(buildCommandHubItems(host));
  requestTUIContentRender(host.state);
}

async function markHubIntroSeen(host: DialogsHost): Promise<void> {
  const previous = host.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES;
  if (previous.hubIntroSeen) return;
  const onboarding = { ...previous, hubIntroSeen: true };
  host.setAppState({ onboarding });
  try {
    await saveTuiConfig({
      theme: host.state.appState.theme,
      permissionMode: host.state.appState.permissionMode,
      disablePasteBurst: host.state.appState.disablePasteBurst ?? false,
      editorCommand: host.state.appState.editorCommand,
      notifications: host.state.appState.notifications,
      upgrade: host.state.appState.upgrade,
      appearance: host.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
      onboarding,
    });
  } catch {
    // Best-effort persistence; intro still dismissed in-session.
  }
}

function handleCommandHubSelect(
  host: DialogsHost,
  delegate: CommandHubDelegate,
  item: CommandHubItem,
  mode: CommandHubSelectMode,
): void {
  noteHubActionUse(item.id);

  // Search tip — stay in Hub; One-search already covers slash/settings/skills.
  if (item.id === 'help.searchTip') {
    noteSuccessFeedback();
    host.state.toast.show('Type to search — settings, slash commands, skills', 2800);
    return;
  }

  if (isSlashHubActionId(item.id)) {
    closeAllCenterModals(host);
    noteSuccessFeedback();
    host.dispatchSlash(`/${slashNameFromHubId(item.id)}`);
    return;
  }

  // Permission: Space cycles in place; Enter opens the picker (nested).
  if (isCommandHubCycleId(item.id)) {
    if (mode === 'space') {
      const next = cyclePermissionMode(host.state.appState.permissionMode);
      host.dispatchSlash(`/permission ${next}`);
      host.openCommandHub?.noteToggleFlash(item.id);
      noteSuccessFeedback();
      host.state.toast.show(`Permission → ${next}`, 1600);
      return;
    }
    host.dispatchSlash('/permission');
    return;
  }

  if (commandHubKeepsOpen(item.id)) {
    const slash = commandHubActionToSlash(item.id);
    if (slash !== undefined) {
      host.dispatchSlash(slash);
    }
    const label = item.label;
    const nextOn = item.badge !== 'ON';
    noteSuccessFeedback();
    host.state.toast.show(`${label} → ${nextOn ? 'ON' : 'off'}`, 1400);
    // Space: stay in Hub and flip more. Enter: apply and return to chat.
    if (mode === 'enter') {
      closeCenterModal(host, delegate);
    } else {
      host.openCommandHub?.noteToggleFlash(item.id);
    }
    return;
  }

  if (item.id === 'now.steer') {
    closeAllCenterModals(host);
    host.state.footer.setTransientHint('Steer: type, then Ctrl-S');
    host.state.toast.show('Type steer text · Ctrl-S to send', 2800);
    requestTUIContentRender(host.state);
    return;
  }
  if (item.id === 'now.stop') {
    closeAllCenterModals(host);
    host.cancelRunningShellCommand();
    void host.session?.cancel({ source: 'ctrl-c' });
    noteSuccessFeedback();
    host.state.toast.show('Stopped', 1400);
    return;
  }

  if (commandHubNestsPicker(item.id)) {
    handleCommandHubAction(host, delegate, item, { nest: true });
    return;
  }

  closeCenterModal(host, delegate);
  handleCommandHubAction(host, delegate, item, { nest: false });
}

function handleCommandHubAction(
  host: DialogsHost,
  delegate: CommandHubDelegate,
  item: CommandHubItem,
  options: { readonly nest: boolean },
): void {
  // Runtime host is LioraTUI (full SlashCommandHost); DialogsHost is the mount slice.
  const slashHost = host as unknown as SlashCommandHost;
  if (item.id === 'settings.open') {
    showSettingsSelector(slashHost);
    return;
  }
  if (isSettingsHubActionId(item.id)) {
    openSettingsPane(slashHost, settingsSelectionFromHubId(item.id));
    return;
  }
  if (item.id === 'help.shortcuts') {
    mountCenterModal(
      host,
      delegate,
      new ShortcutsPanelComponent({
        onClose: () => {
          closeCenterModal(host, delegate);
        },
      }),
      { mode: 'push', label: 'Shortcuts' },
    );
    return;
  }
  if (item.id === 'help.commands') {
    // Nest under Hub so Esc returns (don't wipe the stack).
    mountCenterModal(
      host,
      delegate,
      new HelpPanelComponent({
        commands: host.getSlashCommands('advanced'),
        intro: advancedHelpIntro(),
        commandSectionTitle: 'All slash commands',
        shortcuts: advancedKeyboardShortcuts(),
        onClose: () => {
          closeCenterModal(host, delegate);
        },
      }),
      { mode: options.nest ? 'push' : 'replace', label: 'Commands' },
    );
    return;
  }
  if (item.id === 'workspace.search') {
    restoreInputText(host, delegate, '/search ');
    host.state.toast.show('Type a search pattern after /search', 2200);
    return;
  }
  if (item.id === 'chat.btw') {
    restoreInputText(host, delegate, '/btw ');
    host.state.toast.show('Type your side question after /btw', 2200);
    return;
  }

  const slash = commandHubActionToSlash(item.id);
  if (slash !== undefined) {
    host.dispatchSlash(slash);
  }
}
