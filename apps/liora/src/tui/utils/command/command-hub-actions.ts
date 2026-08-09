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
    case 'start.fork':
      return '/fork';
    case 'start.conductorHowto':
      return undefined;
    case 'modes.plan':
      return '/plan';
    case 'modes.ask':
      return '/ask';
    case 'modes.goals':
      return '/goal next manage';
    case 'modes.premium':
      return '/premium';
    case 'modes.permission':
      return '/permission';
    case 'modes.conductorProject':
    case 'modes.reduceParallelism':
    case 'modes.transcriptRegion':
      return undefined;
    case 'chat.model':
      return '/model';
    case 'chat.thinking':
      return '/thinking';
    case 'chat.retry':
      return '/retry';
    case 'chat.undo':
    case 'now.undo':
      return '/undo';
    case 'chat.rewind':
      return '/rewind';
    case 'chat.compact':
    case 'now.compact':
      return '/compact';
    case 'chat.loops':
    case 'workspace.jobOps':
    case 'workspace.cron':
      return undefined;
    case 'workspace.files':
      return '/files';
    case 'workspace.diff':
      return '/diff';
    case 'workspace.log':
      return '/log';
    case 'workspace.errors':
      return '/errors';
    case 'workspace.tasks':
      return '/tasks';
    case 'workspace.missionControl':
      return '/workers';
    case 'workspace.jobDeck':
      return '/jobs deck';
    case 'workspace.jobInbox':
      return '/job inbox';
    case 'workspace.status':
      return '/status';
    case 'extend.extensions':
      return undefined;
    case 'appearance.theme':
      return '/theme';
    case 'appearance.appearance':
      return '/appearance';
    case 'account.login':
      return '/login';
    case 'account.accounts':
      return '/accounts';
    case 'account.logout':
      return '/logout';
    case 'account.upgrade':
      return '/upgrade';
    case 'chat.btw':
    case 'workspace.search':
    case 'help.shortcuts':
    case 'help.commands':
    case 'now.steer':
    case 'now.stop':
      return undefined;
    default: {
      const _exhaustive: never = id as never;
      return _exhaustive;
    }
  }
}
