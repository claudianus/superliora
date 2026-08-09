import { ttui } from '#/tui/utils/tui-i18n';
import type { ChoiceOption } from '#/tui/components/dialogs/picker/choice-picker';

export interface SettingsOptionDef {
  readonly value: string;
  readonly sectionKey: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly keywords?: readonly string[];
}

export function resolveSettingsOption(option: SettingsOptionDef): ChoiceOption {
  return {
    value: option.value,
    section: ttui(option.sectionKey),
    label: ttui(option.labelKey),
    description: ttui(option.descriptionKey),
    keywords: option.keywords !== undefined ? [...option.keywords] : [],
  };
}
