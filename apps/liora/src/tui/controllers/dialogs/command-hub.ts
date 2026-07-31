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
  CommandPaletteComponent,
  rankPaletteEntries,
  type PaletteEntry,
} from '../../components/dialogs/command-hub/command-palette';
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
  type SettingsKeywordSelection,
} from '../../commands/config/settings-keywords';
import { buildSettingsJumpPaletteEntries } from '../../commands/config/settings-hub-jumps';
import { commandHubActionToSlash } from '../../utils/command/command-hub-actions';
import { noteSuccessFeedback } from '../../utils/render/feedback-vfx';
import { requestTUIContentRender } from '../../utils/render/frame-render';
import { hubRecencyScore, noteHubActionUse } from '../../utils/command/hub-recents';
import type { ModalShellDelegate } from './modal-shell';
import {
  closeAllCenterModals,
  closeCenterModal,
  mountCenterModal,
  restoreInputText,
} from './modal-shell';
import { openHistorySearch } from './search';
import type { DialogsHost } from './types';

export interface CommandHubDelegate extends ModalShellDelegate {
  showCommandHub(options?: { readonly initialQuery?: string; readonly intro?: boolean }): void;
  showCommandPaletteOmnibox(): void;
  showTranscriptSearch(): void;
}

/** Open the beginner Command Hub (replaces the old Ctrl-Space palette). */
export function showCommandPalette(delegate: CommandHubDelegate): void {
  delegate.showCommandHub();
}

/**
 * Power-user omnibox: fuzzy-search every slash command, skill, and a few
 * session actions, then run the selection. Opened from the Hub
 * (Help → Command palette); Esc returns to the Hub when it is stacked
 * below. Recently run entries float to the top via Hub recency scoring.
 */
export function showCommandPaletteOmnibox(host: DialogsHost, delegate: CommandHubDelegate): void {
  if (
    host.state.activeDialog !== null &&
    host.state.activeDialog !== 'center-modal' &&
    host.state.activeDialog !== 'help'
  ) {
    return;
  }
  const entries = rankPaletteEntries(buildPaletteEntries(host), (entry) =>
    hubRecencyScore(paletteRecencyKey(entry)),
  );
  const palette = new CommandPaletteComponent({
    entries,
    onSelect: (entry) => {
      closeAllCenterModals(host);
      runPaletteEntry(host, delegate, entry);
    },
    onCancel: () => {
      closeCenterModal(host, delegate);
    },
  });
  mountCenterModal(host, delegate, palette, { mode: 'push', label: 'Palette' });
}

function buildPaletteEntries(host: DialogsHost): PaletteEntry[] {
  const skillNames = new Set(host.skillCommands.map((command) => command.name));
  const commands: PaletteEntry[] = host.getSlashCommands('advanced').map((command) => ({
    kind: skillNames.has(command.name) ? 'skill' : 'command',
    value: command.name,
    label: `/${command.name}`,
    description: command.description,
    aliases: command.aliases,
  }));
  const actions: PaletteEntry[] = [
    {
      kind: 'action',
      value: 'hub',
      label: 'Command Hub',
      description: 'Open the guided dashboard',
    },
    {
      kind: 'action',
      value: 'shortcuts',
      label: 'Keyboard shortcuts',
      description: 'Keybinding cheatsheet',
    },
    {
      kind: 'action',
      value: 'transcript-search',
      label: 'Search transcript',
      description: 'Find text in this chat',
    },
    {
      kind: 'action',
      value: 'history',
      label: 'Input history',
      description: 'Reuse a past prompt',
    },
    ...buildSettingsJumpPaletteEntries(),
  ];
  return [...actions, ...commands];
}

function runPaletteEntry(host: DialogsHost, delegate: CommandHubDelegate, entry: PaletteEntry): void {
  noteHubActionUse(paletteRecencyKey(entry));
  noteSuccessFeedback();
  if (entry.kind === 'action') {
    if (entry.value.startsWith('settings:')) {
      openSettingsPane(host, entry.value.slice('settings:'.length) as SettingsKeywordSelection);
      return;
    }
    switch (entry.value) {
      case 'hub':
        delegate.showCommandHub();
        return;
      case 'shortcuts':
        mountCenterModal(
          host,
          delegate,
          new ShortcutsPanelComponent({
            onClose: () =>{  closeCenterModal(host, delegate); },
          }),
          { mode: 'push', label: 'Shortcuts' },
        );
        return;
      case 'transcript-search':
        delegate.showTranscriptSearch();
        return;
      case 'history':
        void openHistorySearch(host, delegate);
        return;
      default:
        return;
    }
  }
  host.dispatchSlash(`/${entry.value}`);
}

/** Namespaced so palette runs never match Hub item ids in recency lookups. */
function paletteRecencyKey(entry: PaletteEntry): string {
  return `palette:${entry.kind}:${entry.value}`;
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
  return buildDefaultCommandHubItems({
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
  });
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
  if (item.id === 'help.palette') {
    delegate.showCommandPaletteOmnibox();
    return;
  }
  if (item.id === 'settings.open') {
    showSettingsSelector(host);
    return;
  }
  if (isSettingsHubActionId(item.id)) {
    openSettingsPane(host, settingsSelectionFromHubId(item.id));
    return;
  }
  if (item.id === 'help.shortcuts') {
    mountCenterModal(
      host,
      delegate,
      new ShortcutsPanelComponent({
        onClose: () =>{  closeCenterModal(host, delegate); },
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
