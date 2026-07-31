/**
 * Command Hub One-search entries that jump straight into a Settings pane.
 */

import type { CommandHubItem } from '../../components/dialogs/command-hub/command-hub-types';
import {
  SETTINGS_OPTIONS,
  type SettingsSelection,
} from '../../components/dialogs/picker/settings-selector';

import { SETTINGS_SEARCH_KEYWORDS } from './settings-keywords';

export function buildSettingsJumpHubItems(): CommandHubItem[] {
  const browse: CommandHubItem = {
    id: 'settings.open',
    section: 'Settings',
    label: 'All settings',
    description: 'Browse every settings pane · type freeze, DDG, FTS, redaction, …',
  };
  const panes = SETTINGS_OPTIONS.map((option) =>
    settingsJumpHubItem(option.value as SettingsSelection, option),
  );
  return [browse, ...panes];
}

function settingsJumpHubItem(
  selection: SettingsSelection,
  option: { readonly label: string; readonly description?: string },
): CommandHubItem {
  return {
    id: `settings.${selection}`,
    section: 'Settings',
    label: option.label,
    description: option.description ?? '',
    searchOnly: true,
    keywords: [...SETTINGS_SEARCH_KEYWORDS[selection]],
  };
}
