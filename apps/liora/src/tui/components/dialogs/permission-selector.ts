import type { PermissionMode } from '@superliora/sdk';

import { ttui } from '#/tui/utils/tui-i18n';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

function permissionOptions(): ChoiceOption[] {
  return [
    {
      value: 'manual',
      label: ttui('tui.permission.manual.label'),
      description: ttui('tui.permission.manual.desc'),
    },
    {
      value: 'auto',
      label: ttui('tui.permission.auto.label'),
      description: ttui('tui.permission.auto.desc'),
    },
    {
      value: 'yolo',
      label: ttui('tui.permission.yolo.label'),
      description: ttui('tui.permission.yolo.desc'),
    },
  ];
}

function isPermissionModeChoice(value: string): value is PermissionMode {
  return value === 'manual' || value === 'auto' || value === 'yolo';
}

export interface PermissionSelectorOptions {
  readonly currentValue: PermissionMode;
  readonly onSelect: (mode: PermissionMode) => void;
  readonly onCancel: () => void;
}

export class PermissionSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PermissionSelectorOptions) {
    super({
      title: ttui('tui.permission.selector.title'),
      options: permissionOptions(),
      currentValue: opts.currentValue,
      onSelect: (value) => {
        if (isPermissionModeChoice(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
