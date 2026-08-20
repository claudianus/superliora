import { ttui } from '../../../utils/tui-i18n';
import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

function updatePreferenceOptions(): ChoiceOption[] {
  return [
    {
      value: 'on',
      label: ttui('tui.picker.update.on'),
      description: ttui('tui.picker.update.onDesc'),
    },
    {
      value: 'off',
      label: ttui('tui.picker.update.off'),
      description: ttui('tui.picker.update.offDesc'),
    },
  ];
}

export interface UpdatePreferenceSelectorOptions {
  readonly currentValue: boolean;
  readonly onSelect: (value: boolean) => void;
  readonly onCancel: () => void;
}

export class UpdatePreferenceSelectorComponent extends ChoicePickerComponent {
  constructor(opts: UpdatePreferenceSelectorOptions) {
    super({
      title: ttui('tui.picker.update.title'),
      options: updatePreferenceOptions(),
      currentValue: opts.currentValue ? 'on' : 'off',
      onSelect: (value) => {
        opts.onSelect(value === 'on');
      },
      onCancel: opts.onCancel,
    });
  }
}
