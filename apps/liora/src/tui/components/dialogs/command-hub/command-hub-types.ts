export type CommandHubActionId =
  | 'now.steer'
  | 'now.stop'
  | 'now.undo'
  | 'now.compact'
  | 'start.new'
  | 'start.sessions'
  | 'start.export'
  | 'start.fork'
  | 'start.conductorHowto'
  | 'modes.plan'
  | 'modes.ask'
  | 'modes.goals'
  | 'modes.premium'
  | 'modes.permission'
  | 'modes.conductorProject'
  | 'modes.reduceParallelism'
  | 'modes.transcriptRegion'
  | 'chat.model'
  | 'chat.thinking'
  | 'chat.retry'
  | 'chat.undo'
  | 'chat.rewind'
  | 'chat.compact'
  | 'chat.btw'
  | 'chat.loops'
  | 'workspace.files'
  | 'workspace.search'
  | 'workspace.diff'
  | 'workspace.log'
  | 'workspace.errors'
  | 'workspace.tasks'
  | 'workspace.missionControl'
  | 'workspace.jobDeck'
  | 'workspace.jobInbox'
  | 'workspace.jobOps'
  | 'workspace.cron'
  | 'workspace.status'
  | 'extend.extensions'
  | 'appearance.theme'
  | 'appearance.appearance'
  | 'account.login'
  | 'account.accounts'
  | 'account.logout'
  | 'account.upgrade'
  | 'help.shortcuts'
  | 'help.commands'

  | 'settings.open'
  | `settings.${string}`
  /** Slash / skill One-search rows (`searchOnly`). */
  | `slash.${string}`;

/** How activation behaves in the Hub. */
export type CommandHubItemKind = 'toggle' | 'cycle' | 'open';

export interface CommandHubItem {
  readonly id: CommandHubActionId;
  /** i18n key; resolved at render/search time so locale switches apply. */
  readonly sectionKey?: string;
  readonly labelKey?: string;
  readonly descriptionKey?: string;
  readonly section: string;
  readonly label: string;
  readonly description: string;
  /** Optional live badge, e.g. "on" / model name. */
  readonly badge?: string;
  readonly kind?: CommandHubItemKind;
  /** Hide from the idle list; shown when the filter query matches. */
  readonly searchOnly?: boolean;
  /** Extra filter tokens (freeze, DDG, FTS, …); never rendered. */
  readonly keywords?: readonly string[];
}

export type CommandHubSelectMode = 'enter' | 'space';

export interface CommandHubOptions {
  readonly items: readonly CommandHubItem[];
  readonly onSelect: (item: CommandHubItem, mode: CommandHubSelectMode) => void;
  readonly onCancel: () => void;
  readonly title?: string;
  readonly initialQuery?: string;
  /** First-run coach overlay. */
  readonly intro?: boolean;
  readonly onIntroDismiss?: () => void;
  /** Terminal row count for the list page size. Defaults to stdout. */
  readonly terminalRows?: () => number;
}
