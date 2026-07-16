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
export const ULTRAWORK_START_MODE_OPTIONS: readonly StartPermissionOption<UltraworkStartModeChoice>[] =
  [
    {
      value: 'manual',
      label: 'Manual (default)',
      description:
        'You answer every AskUserQuestion and approve tools, edits, and high-risk gates. Best when you want full control during the Ultrawork interview.',
    },
    {
      value: 'auto',
      label: 'Auto',
      description:
        'SuperLiora auto-answers AskUserQuestion and auto-approves tools. Same interview questions as Manual; only the responder changes.',
    },
    {
      value: 'yolo',
      label: 'YOLO',
      description:
        'SuperLiora auto-answers AskUserQuestion and most tools. Humans still gate delete/destructive actions and credential/secret access.',
    },
  ];

const NOTICE_LINES = [
  'Choose who answers the Ultrawork interview and high-risk gates.',
  'The interview script is the same in every mode — only the responder and tool approvals change.',
  'This choice is not remembered; Manual is selected by default on every new Ultrawork start.',
  'Headless/auto runs without a TUI chooser default to Manual.',
] as const;

export class UltraworkStartModePromptComponent extends StartPermissionPromptComponent<UltraworkStartModeChoice> {
  constructor(opts: UltraworkStartModePromptOptions) {
    super({
      title: 'How should Ultrawork interview and approvals run?',
      noticeLines: NOTICE_LINES,
      options: ULTRAWORK_START_MODE_OPTIONS,
      // Manual is first; keep index explicit for future reordering safety.
      initialSelectedIndex: 0,
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
