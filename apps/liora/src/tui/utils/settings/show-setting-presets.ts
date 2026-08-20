/**
 * Mount a searchable preset ChoicePicker for a Settings pane.
 */

import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import { dismissPickerDialog, mountPickerDialog } from '../ui/mount-picker';
import { ttui } from '#/tui/utils/tui-i18n';

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
      hint: ttui('tui.settings.presets.hint'),
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
export function settingsPresetsRow(): {
  readonly value: 'presets';
  readonly label: string;
  readonly description: string;
} {
  return {
    value: 'presets',
    label: ttui('tui.settings.presets.label'),
    description: ttui('tui.settings.presets.desc'),
  };
}

