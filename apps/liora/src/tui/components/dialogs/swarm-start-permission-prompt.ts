import { ttui } from '#/tui/utils/tui-i18n';

import {
  StartPermissionPromptComponent,
  type StartPermissionOption,
} from './start-permission-prompt';

export type SwarmStartPermissionChoice = 'auto' | 'yolo' | 'manual';

export interface SwarmStartPermissionPromptOptions {
  readonly onSelect: (choice: SwarmStartPermissionChoice) => void;
  readonly onCancel: () => void;
}

function swarmStartOptions(): StartPermissionOption<SwarmStartPermissionChoice>[] {
  return [
    {
      value: 'auto',
      label: ttui('tui.swarm.start.option.auto'),
      description: ttui('tui.swarm.start.option.auto.desc'),
    },
    {
      value: 'yolo',
      label: ttui('tui.swarm.start.option.yolo'),
      description: ttui('tui.swarm.start.option.yolo.desc'),
    },
    {
      value: 'manual',
      label: ttui('tui.swarm.start.option.manual'),
      description: ttui('tui.swarm.start.option.manual.desc'),
    },
  ];
}

export class SwarmStartPermissionPromptComponent extends StartPermissionPromptComponent<SwarmStartPermissionChoice> {
  constructor(opts: SwarmStartPermissionPromptOptions) {
    super({
      title: ttui('tui.swarm.start.title'),
      noticeLines: [
        ttui('tui.swarm.start.notice.1'),
        ttui('tui.swarm.start.notice.2'),
        ttui('tui.swarm.start.notice.3'),
      ],
      options: swarmStartOptions(),
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
