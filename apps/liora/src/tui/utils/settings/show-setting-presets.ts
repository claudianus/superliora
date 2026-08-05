/**
 * Mount a searchable preset ChoicePicker for a Settings pane.
 */

import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import { dismissPickerDialog, mountPickerDialog } from '../ui/mount-picker';

import {
  findSettingPreset,
  settingPresetChoiceOptions,
  type SettingPreset,
} from './setting-presets';

export function showSettingPresetsPicker<TId extends string, TPatch>(
  host: SlashCommandHost,
  options: {
    readonly title: string;
    readonly catalog: readonly SettingPreset<TId, TPatch>[];
    readonly currentId?: string;
    readonly onApply: (preset: SettingPreset<TId, TPatch>) => void | Promise<void>;
  },
): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: options.title,
      hint: '↑↓←→ · Enter apply · Esc',
      searchable: true,
      layout: 'grid',
      currentValue: options.currentId,
      options: [...settingPresetChoiceOptions(options.catalog)],
      onSelect: (value) => {
        dismissPickerDialog(host);
        const preset = findSettingPreset(options.catalog, value);
        if (preset === undefined) return;
        void options.onApply(preset);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: options.title },
  );
}

/** Standard top-row option for Settings panes. */
export const SETTINGS_PRESETS_ROW = {
  value: 'presets',
  label: 'Presets…',
  description: 'Named packs — apply one, then fine-tune below.',
} as const;
