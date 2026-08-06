import { buildSettingsJumpHubItems } from '../../../commands/config/settings-hub-jumps';
import type { CommandHubItem } from './command-hub-types';

export function buildDefaultCommandHubItems(state: {
  readonly planMode?: boolean;
  readonly premiumQualityMode?: boolean;
  readonly permissionMode?: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly streamingPhase?: string;
  readonly isCompacting?: boolean;
  /** True when a provider/model is already connected. */
  readonly signedIn?: boolean;
}): CommandHubItem[] {
  const onOff = (on: boolean | undefined): string => (on === true ? 'ON' : 'off');
  const streaming =
    (state.streamingPhase !== undefined && state.streamingPhase !== 'idle') ||
    state.isCompacting === true;
  const items: CommandHubItem[] = [];

  if (streaming) {
    items.push(
      {
        id: 'now.steer',
        section: 'Now',
        label: 'Steer',
        description: 'Close Hub, type guidance, then Ctrl-S',
        kind: 'open',
      },
      {
        id: 'now.stop',
        section: 'Now',
        label: 'Stop turn',
        description: 'Interrupt the agent now',
        kind: 'open',
      },
      {
        id: 'now.undo',
        section: 'Now',
        label: 'Undo last prompt',
        description: 'Withdraw the last user message',
        kind: 'open',
      },
      {
        id: 'now.compact',
        section: 'Now',
        label: 'Compact context',
        description: 'Shrink the working set mid-run',
        kind: 'open',
      },
    );
  }

  items.push(
    {
      id: 'modes.plan',
      section: 'Modes',
      label: 'Plan mode',
      description: 'Space flips · Enter flips & close · think first',
      badge: onOff(state.planMode),
      kind: 'toggle',
    },
    {
      id: 'modes.goals',
      section: 'Modes',
      label: 'Manage goal queue',
      description: 'Upcoming goals · pause / resume / reorder',
      keywords: ['goal', 'queue', 'ralph', 'next'],
    },
    {
      id: 'modes.premium',
      section: 'Modes',
      label: 'Visual Quality',
      description: 'Space flips · Enter flips & close · higher effort',
      badge: onOff(state.premiumQualityMode),
      kind: 'toggle',
    },
    {
      id: 'modes.permission',
      section: 'Modes',
      label: 'Permission mode',
      description: 'Space cycles · Enter opens picker',
      badge: state.permissionMode,
      kind: 'cycle',
    },
  );

  items.push(
    {
      id: 'start.new',
      section: 'Start',
      label: 'New session',
      description: 'Start a fresh chat',
    },
    {
      id: 'start.sessions',
      section: 'Start',
      label: 'Resume sessions',
      description: 'Browse and switch sessions',
    },
    {
      id: 'start.export',
      section: 'Start',
      label: 'Export Markdown',
      description: 'Save this chat as a Markdown file',
    },
    {
      id: 'start.fork',
      section: 'Start',
      label: 'Fork session',
      description: 'Branch this chat (`/fork --worktree` for git isolation)',
      keywords: ['fork', 'worktree', 'branch'],
    },
    {
      id: 'chat.model',
      section: 'Chat',
      label: 'Model',
      description: 'Switch the LLM',
      badge: state.model !== undefined && state.model.length > 0 ? state.model : undefined,
    },
    {
      id: 'chat.thinking',
      section: 'Chat',
      label: 'Thinking effort',
      description: 'How hard the model thinks',
      badge:
        state.thinkingLevel !== undefined && state.thinkingLevel.length > 0
          ? state.thinkingLevel
          : undefined,
    },
    {
      id: 'chat.retry',
      section: 'Chat',
      label: 'Retry last turn',
      description: 'Resend your last message',
    },
  );

  if (!streaming) {
    items.push(
      {
        id: 'chat.undo',
        section: 'Chat',
        label: 'Undo last prompt',
        description: 'Withdraw the last user message',
      },
      {
        id: 'chat.rewind',
        section: 'Chat',
        label: 'Rewind files',
        description: 'Restore files from the last write/edit snapshot',
        keywords: ['rewind', 'snapshot', 'restore'],
      },
      {
        id: 'chat.compact',
        section: 'Chat',
        label: 'Compact context',
        description: 'Shrink the working set',
      },
    );
  }

  items.push(
    {
      id: 'chat.btw',
      section: 'Chat',
      label: 'Side question (btw)',
      description: 'Ask a forked side agent',
    },
    {
      id: 'chat.loops',
      section: 'Chat',
      label: 'Conversation loops',
      description: 'List or stop in-chat periodic prompts',
      keywords: ['loop', 'interval', 'repeat'],
    },
    {
      id: 'workspace.files',
      section: 'Workspace',
      label: 'Files',
      description: 'Browse the project tree',
    },
    {
      id: 'workspace.search',
      section: 'Workspace',
      label: 'Search project',
      description: 'Find text across files',
    },
    {
      id: 'workspace.diff',
      section: 'Workspace',
      label: 'Diff',
      description: 'Review git changes',
    },
    {
      id: 'workspace.log',
      section: 'Workspace',
      label: 'Commits',
      description: 'Browse git history',
    },
    {
      id: 'workspace.errors',
      section: 'Workspace',
      label: 'Errors',
      description: 'Browse errors from this session transcript',
      keywords: ['problems', 'errors'],
    },
    {
      id: 'workspace.tasks',
      section: 'Workspace',
      label: 'Background tasks',
      description: 'Open the tasks browser',
    },
    {
      id: 'workspace.missionControl',
      section: 'Workspace',
      label: 'Mission Control',
      description: 'Cycle the subagent monitor dock — auto · pinned · hidden',
      keywords: ['agents', 'subagent', 'monitor', 'dock', 'workers', 'mission'],
    },
    {
      id: 'workspace.jobDeck',
      section: 'Workspace',
      label: 'Job Deck monitor',
      description: 'Interactive Conductor deck — worker transcripts, tokens, elapsed',
      keywords: ['conductor', 'deck', 'monitor', 'worker', 'transcript'],
    },
    {
      id: 'workspace.jobOps',
      section: 'Workspace',
      label: 'Job ops',
      description: 'List · inbox · resume · cancel · inspect · schedule · GC',
      keywords: ['job', 'conductor', 'inbox', 'resume', 'cancel', 'gc'],
    },
    {
      id: 'workspace.cron',
      section: 'Workspace',
      label: 'Cron jobs',
      description: 'List or delete scheduled jobs',
      keywords: ['cron', 'schedule', 'scheduled'],
    },
    {
      id: 'workspace.status',
      section: 'Workspace',
      label: 'Status',
      description: 'Session, usage, quota, tools',
    },
    {
      id: 'extend.extensions',
      section: 'Extend',
      label: 'Extensions',
      description: 'Manage plugins, skills, MCP · Settings glances stay searchable',
      keywords: ['plugins', 'mcp', 'skills', 'hooks', 'marketplace'],
    },
    {
      id: 'appearance.theme',
      section: 'Appearance',
      label: 'Theme',
      description: 'Dark, light, or custom',
    },
    {
      id: 'appearance.appearance',
      section: 'Appearance',
      label: 'Appearance',
      description: 'Motion, density, background',
    },
    {
      id: 'account.login',
      section: 'Account',
      label: state.signedIn === true ? 'Add provider' : 'Login',
      description:
        state.signedIn === true ? 'Connect another provider' : 'Connect a provider to start',
      badge: state.signedIn === true ? 'ready' : undefined,
    },
    {
      id: 'account.accounts',
      section: 'Account',
      label: 'Accounts',
      description: 'Manage OAuth account pools',
    },
    {
      id: 'account.logout',
      section: 'Account',
      label: 'Logout',
      description: 'Disconnect a configured provider',
      keywords: ['logout', 'disconnect', 'sign out'],
    },
    {
      id: 'account.upgrade',
      section: 'Account',
      label: 'Update',
      description: 'Upgrade Studio — check and install CLI updates (/update · /upgrade)',
      keywords: ['upgrade', 'update', 'version', 'install', 'release', 'liora update'],
    },
    {
      id: 'help.shortcuts',
      section: 'Help',
      label: 'Shortcuts',
      description: 'Keyboard cheatsheet · type above to search settings / slash / skills',
      keywords: ['palette', 'omnibox', 'fuzzy', 'slash', 'command palette', 'hub', 'search'],
    },
    {
      id: 'help.commands',
      section: 'Help',
      label: 'All slash commands',
      description: 'Power-user list · prefer Hub search for everyday actions',
    },
    ...buildSettingsJumpHubItems(),
  );
  return items;
}
