import { ttui } from '#/tui/utils/tui-i18n';

import {
  StartPermissionPromptComponent,
  type StartPermissionOption,
} from './start-permission-prompt';

export type GoalStartPermissionChoice = 'auto' | 'yolo' | 'manual' | 'cancel';

export interface GoalStartPermissionPromptOptions {
  readonly mode: 'manual' | 'yolo';
  readonly onSelect: (choice: GoalStartPermissionChoice) => void;
  readonly onCancel: () => void;
}

export function goalStartOptions(mode: 'manual' | 'yolo'): readonly StartPermissionOption[] {
  const auto: StartPermissionOption = {
    value: 'auto',
    label: ttui('tui.goal.start.option.auto'),
    description: ttui('tui.goal.start.option.auto.desc'),
  };
  const cancel: StartPermissionOption = {
    value: 'cancel',
    label: ttui('tui.goal.start.option.cancel'),
    description: ttui('tui.goal.start.option.cancel.desc'),
  };
  if (mode === 'yolo') {
    return [
      auto,
      {
        value: 'yolo',
        label: ttui('tui.goal.start.option.keepYolo'),
        description: ttui('tui.goal.start.option.keepYolo.desc'),
      },
      cancel,
    ];
  }
  return [
    auto,
    {
      value: 'yolo',
      label: ttui('tui.goal.start.option.yolo'),
      description: ttui('tui.goal.start.option.yolo.desc'),
    },
    {
      value: 'manual',
      label: ttui('tui.goal.start.option.manual'),
      description: ttui('tui.goal.start.option.manual.desc'),
    },
    cancel,
  ];
}

export const GOAL_START_MANUAL_OPTIONS: readonly StartPermissionOption[] = goalStartOptions('manual');
export const GOAL_START_YOLO_OPTIONS: readonly StartPermissionOption[] = goalStartOptions('yolo');

export class GoalStartPermissionPromptComponent extends StartPermissionPromptComponent {
  constructor(opts: GoalStartPermissionPromptOptions) {
    super({
      title:
        opts.mode === 'yolo'
          ? ttui('tui.goal.start.title.yolo')
          : ttui('tui.goal.start.title.manual'),
      noticeLines:
        opts.mode === 'yolo'
          ? [
              ttui('tui.goal.start.notice.yolo.1'),
              ttui('tui.goal.start.notice.yolo.2'),
              ttui('tui.goal.start.notice.yolo.3'),
            ]
          : [
              ttui('tui.goal.start.notice.manual.1'),
              ttui('tui.goal.start.notice.manual.2'),
              ttui('tui.goal.start.notice.manual.3'),
            ],
      options: goalStartOptions(opts.mode),
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
