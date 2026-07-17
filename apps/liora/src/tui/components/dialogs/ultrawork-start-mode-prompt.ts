import { ttui } from '#/tui/utils/tui-i18n';

import {
  StartPermissionPromptComponent,
  type StartPermissionOption,
} from './start-permission-prompt';

/** Ultrawork start-mode choices (PermissionMode reuse — Option A). */
export type UltraworkStartModeChoice = 'manual' | 'auto' | 'yolo';

export interface UltraworkStartModePromptOptions {
  readonly onSelect: (choice: UltraworkStartModeChoice) => void;
  readonly onCancel: () => void;
}

/**
 * Manual-first order so Enter defaults to Manual without remembering prior
 * Ultrawork starts. Framing is interview-mode: who answers AskUserQuestion and
 * high-risk human gates, not a different interview script.
 */
export function ultraworkStartModeOptions(): StartPermissionOption<UltraworkStartModeChoice>[] {
  return [
    {
      value: 'manual',
      label: ttui('tui.ultrawork.start.option.manual'),
      description: ttui('tui.ultrawork.start.option.manual.desc'),
    },
    {
      value: 'auto',
      label: ttui('tui.ultrawork.start.option.auto'),
      description: ttui('tui.ultrawork.start.option.auto.desc'),
    },
    {
      value: 'yolo',
      label: ttui('tui.ultrawork.start.option.yolo'),
      description: ttui('tui.ultrawork.start.option.yolo.desc'),
    },
  ];
}

export const ULTRAWORK_START_MODE_OPTIONS: readonly StartPermissionOption<UltraworkStartModeChoice>[] =
  ultraworkStartModeOptions();

export class UltraworkStartModePromptComponent extends StartPermissionPromptComponent<UltraworkStartModeChoice> {
  constructor(opts: UltraworkStartModePromptOptions) {
    super({
      title: ttui('tui.ultrawork.start.title'),
      noticeLines: [
        ttui('tui.ultrawork.start.notice.1'),
        ttui('tui.ultrawork.start.notice.2'),
        ttui('tui.ultrawork.start.notice.3'),
      ],
      options: ultraworkStartModeOptions(),
      // Manual is first; keep index explicit for future reordering safety.
      initialSelectedIndex: 0,
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
