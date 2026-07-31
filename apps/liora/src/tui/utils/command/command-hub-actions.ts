import type { CommandHubActionId } from '#/tui/components/dialogs/command-hub/index';

type LiteralHubActionId = Exclude<CommandHubActionId, `settings.${string}` | `slash.${string}`>;

/** Map a Hub action to a slash command string, or undefined when the host handles it. */
export function commandHubActionToSlash(id: CommandHubActionId): string | undefined {
  if (id.startsWith('slash.')) return `/${id.slice('slash.'.length)}`;
  if (id === 'settings.open') return '/settings';
  if (id.startsWith('settings.')) return undefined;

  switch (id as LiteralHubActionId) {
    case 'start.new':
      return '/new';
    case 'start.sessions':
      return '/sessions';
    case 'start.export':
      return '/export-md';
    case 'modes.plan':
      return '/plan';
    case 'modes.swarm':
      return '/swarm';
    case 'modes.ultrawork':
      return '/ultrawork';
    case 'modes.premium':
      return '/premium';
    case 'modes.permission':
      return '/permission';
    case 'chat.model':
      return '/model';
    case 'chat.thinking':
      return '/thinking';
    case 'chat.retry':
      return '/retry';
    case 'chat.undo':
    case 'now.undo':
      return '/undo';
    case 'chat.compact':
    case 'now.compact':
      return '/compact';
    case 'workspace.files':
      return '/files';
    case 'workspace.diff':
      return '/diff';
    case 'workspace.log':
      return '/log';
    case 'workspace.tasks':
      return '/tasks';
    case 'workspace.status':
      return '/status';
    case 'extend.extensions':
      return '/extensions';
    case 'appearance.theme':
      return '/theme';
    case 'appearance.appearance':
      return '/appearance';
    case 'account.login':
      return '/login';
    case 'account.accounts':
      return '/accounts';
    case 'account.upgrade':
      return '/upgrade';
    case 'chat.btw':
    case 'workspace.search':
    case 'help.shortcuts':
    case 'help.commands':
    case 'help.searchTip':
    case 'now.steer':
    case 'now.stop':
      return undefined;
    default: {
      const _exhaustive: never = id as never;
      return _exhaustive;
    }
  }
}
