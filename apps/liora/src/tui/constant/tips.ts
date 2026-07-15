export interface ToolbarTip {
  readonly text: string;
  /**
   * Long/important tips render on their own. They never pair with a
   * neighbour and never appear as the second half of someone else's pair.
   */
  readonly solo?: boolean;
  /**
   * Rotation weight: a higher value makes the tip recur more often. Defaults
   * to 1. Used to give newer/important features more airtime.
   */
  readonly priority?: number;
}

/**
 * Subset of toolbar tips shown behind the composing spinner.
 */
export const WORKING_TIPS: readonly ToolbarTip[] = [
  { text: 'ctrl-s to add guidance without waiting for the turn to finish', priority: 2, solo: true },
  { text: '/tasks to check progress and status for background tasks', priority: 2 },
  { text: '/init: generate AGENTS.md', priority: 2 },
  { text: '/plugins: manage plugins — try the "superpowers" plugin', solo: true, priority: 3 },
  {
    text: '/plugins: manage plugins — try the "Liora Datasource" for reliable financial, economic, and academic data',
    solo: true,
    priority: 3,
  },
  { text: 'ask Liora to schedule tasks, e.g. "remind me at 5pm"', solo: true, priority: 3 },
  { text: '/sessions to browse and resume earlier sessions', solo: true },
  { text: 'describe the outcome and Liora will keep the work organized', priority: 2, solo: true },
  { text: '/goal next to queue follow-up work while the current goal keeps running', solo: true },
  { text: 'shift-tab toggles Ultrawork and off', solo: true, priority: 3 },
  { text: '@: mention files', priority: 2 },
  { text: '! to run a shell command', priority: 2 },
];

export const ALL_TIPS: readonly ToolbarTip[] = [
  ...WORKING_TIPS,
  { text: 'shift+enter: newline' },
  { text: 'ctrl+c: cancel' },
  { text: '/theme to switch the terminal UI theme' },
  { text: '/auto when you want Liora to handle approvals and keep going unattended' },
  { text: '/yolo to skip most approvals for trusted batch work, only use it in repos you trust' },
  { text: '/help: show commands' },
  { text: '/compact compresses context when it gets long', priority: 2 },
  { text: '/status shows context, Context OS continuity, and micro-clear health at a glance', priority: 3, solo: true },
  { text: '/context diagnoses memory continuity, evidence, and privacy (ZDR) posture', priority: 3, solo: true },
  { text: 'media: GenerateImage/GenerateVideo with OPENAI_API_KEY or GOOGLE_API_KEY — no MCP setup', priority: 2, solo: true },
  { text: 'footer badges warn when context is high or durable evidence went missing after compact', priority: 2, solo: true },
  { text: 'ctrl-o to hide or reveal tool output switching between a clean chat view and full execution details', priority: 2 },
  { text: 'shift-tab again turns Ultrawork back off', priority: 2 },
  { text: '/model: switch model', priority: 2 },
];
