import type { PermissionMode } from '@superliora/sdk';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

const PERMISSION_OPTIONS: readonly ChoiceOption[] = [
  {
    value: 'manual',
    label: 'Manual',
    description:
      'Ask before commands, edits, and other risky actions. Read/search tools run directly; session approval rules are respected.',
  },
  {
    value: 'auto',
    label: 'Auto',
    description:
      'Run fully non-interactively. Tool actions are approved automatically, and structured agent questions are auto-answered so it can decide on its own.',
  },
  {
    value: 'yolo',
    label: 'YOLO',
    description:
      'Automatically approve most tool actions and plan transitions. Structured questions are auto-answered; SuperLiora still asks you for delete/destructive or credential/secret access.',
  },
];

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
      title: 'Select permission mode',
      options: [...PERMISSION_OPTIONS],
      currentValue: opts.currentValue,
      onSelect: (value) => {
        if (isPermissionModeChoice(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
