export interface ToolbarTip {
  /**
   * i18n key under `tui.tip.*` (or any catalog key resolved via `ttui`).
   * Resolved at render time so locale switches apply without rebuilding the list.
   */
  readonly key: string;
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
  { key: 'tui.tip.ctrlS', priority: 2, solo: true },
  { key: 'tui.tip.tasks', priority: 2 },
  { key: 'tui.tip.init', priority: 2 },
  { key: 'tui.tip.pluginsSuperpowers', solo: true, priority: 3 },
  { key: 'tui.tip.pluginsDatasource', solo: true, priority: 3 },
  { key: 'tui.tip.schedule', solo: true, priority: 3 },
  { key: 'tui.tip.sessions', solo: true },
  { key: 'tui.tip.outcome', priority: 2, solo: true },
  { key: 'tui.tip.goalNext', solo: true },
  { key: 'tui.tip.shiftTab', solo: true, priority: 3 },
  { key: 'tui.tip.mention', priority: 2 },
  { key: 'tui.tip.shell', priority: 2 },
  { key: 'tui.tip.ctrlO', priority: 2 },
  { key: 'tui.tip.ctrlB', priority: 2 },
];

export const ALL_TIPS: readonly ToolbarTip[] = [
  ...WORKING_TIPS,
  { key: 'tui.tip.shiftEnter' },
  { key: 'tui.tip.ctrlC' },
  { key: 'tui.tip.theme' },
  { key: 'tui.tip.aquarium', priority: 2 },
  { key: 'tui.tip.feed', priority: 2 },
  { key: 'tui.tip.auto' },
  { key: 'tui.tip.yolo' },
  { key: 'tui.tip.help' },
  { key: 'tui.tip.compact', priority: 2 },
  { key: 'tui.tip.status', priority: 3, solo: true },
  { key: 'tui.tip.context', priority: 3, solo: true },
  { key: 'tui.tip.mediaKeys', priority: 2, solo: true },
  { key: 'tui.tip.research', priority: 2, solo: true },
  { key: 'tui.tip.office', priority: 2, solo: true },
  { key: 'tui.tip.websearch', priority: 1, solo: true },
  { key: 'tui.tip.bench', priority: 2, solo: true },
  { key: 'tui.tip.browser', priority: 2, solo: true },
  { key: 'tui.tip.firstRun', priority: 3, solo: true },
  { key: 'tui.tip.footerBadges', priority: 2, solo: true },
  { key: 'tui.tip.contextLadder', priority: 3, solo: true },
  { key: 'tui.tip.toolTrim', priority: 2, solo: true },
  { key: 'tui.tip.reasoningGlance', priority: 2, solo: true },
  { key: 'tui.tip.contextBar', priority: 1, solo: true },
  { key: 'tui.tip.particleRails', priority: 1, solo: true },
  { key: 'tui.tip.toolDescs', priority: 1, solo: true },
  { key: 'tui.tip.autoDream', priority: 1, solo: true },
  { key: 'tui.tip.microBadges', priority: 1, solo: true },
  { key: 'tui.tip.mediaZeroConfig', priority: 1, solo: true },
  { key: 'tui.tip.mediaFooter', priority: 1, solo: true },
  { key: 'tui.tip.backgroundAgent', priority: 1, solo: true },
  { key: 'tui.tip.shiftTabOff', priority: 2 },
  { key: 'tui.tip.model', priority: 2 },
  { key: 'tui.tip.loginMedia', priority: 2, solo: true },
  { key: 'tui.tip.glances', priority: 2, solo: true },
  { key: 'tui.tip.recall', priority: 1, solo: true },
];
