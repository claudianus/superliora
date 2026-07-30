export type CommandHubActionId =
  | 'now.steer'
  | 'now.stop'
  | 'now.undo'
  | 'now.compact'
  | 'start.new'
  | 'start.sessions'
  | 'start.export'
  | 'modes.plan'
  | 'modes.swarm'
  | 'modes.ultrawork'
  | 'modes.premium'
  | 'modes.permission'
  | 'chat.model'
  | 'chat.thinking'
  | 'chat.retry'
  | 'chat.undo'
  | 'chat.compact'
  | 'chat.btw'
  | 'workspace.files'
  | 'workspace.search'
  | 'workspace.diff'
  | 'workspace.log'
  | 'workspace.tasks'
  | 'workspace.status'
  | 'extend.extensions'
  | 'appearance.theme'
  | 'appearance.appearance'
  | 'account.login'
  | 'account.accounts'
  | 'account.upgrade'
  | 'help.shortcuts'
  | 'help.commands'
  | 'help.palette';

/** How activation behaves in the Hub. */
export type CommandHubItemKind = 'toggle' | 'cycle' | 'open';

export interface CommandHubItem {
  readonly id: CommandHubActionId;
  readonly section: string;
  readonly label: string;
  readonly description: string;
  /** Optional live badge, e.g. "on" / model name. */
  readonly badge?: string;
  readonly kind?: CommandHubItemKind;
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
}
