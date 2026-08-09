import { isExperimentalFlagEnabled } from '../../../commands/experimental-flags';
import { buildSettingsJumpHubItems } from '../../../commands/config/settings-hub-jumps';
import type { CommandHubItem } from './command-hub-types';

function hub(
  id: CommandHubItem['id'],
  sectionKey: string,
  labelKey: string,
  descriptionKey: string,
  extra: Omit<
    CommandHubItem,
    'id' | 'sectionKey' | 'labelKey' | 'descriptionKey' | 'section' | 'label' | 'description'
  > = {},
): CommandHubItem {
  return {
    id,
    sectionKey,
    labelKey,
    descriptionKey,
    section: '',
    label: '',
    description: '',
    ...extra,
  };
}

export function buildDefaultCommandHubItems(state: {
  readonly planMode?: boolean;
  readonly askMode?: boolean;
  readonly premiumQualityMode?: boolean;
  readonly permissionMode?: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly streamingPhase?: string;
  readonly isCompacting?: boolean;
  /** True when a provider/model is already connected. */
  readonly signedIn?: boolean;
  readonly conductorProjectMode?: string;
  readonly transcriptRegionMode?: string;
}): CommandHubItem[] {
  const onOff = (on: boolean | undefined): string => (on === true ? 'ON' : 'off');
  const streaming =
    (state.streamingPhase !== undefined && state.streamingPhase !== 'idle') ||
    state.isCompacting === true;
  const conductorUx = isExperimentalFlagEnabled('conductor_ux_v2');
  const items: CommandHubItem[] = [];

  if (streaming) {
    items.push(
      hub('now.steer', 'tui.hub.section.now', 'tui.hub.now.steer.label', 'tui.hub.now.steer.desc', {
        kind: 'open',
      }),
      hub('now.stop', 'tui.hub.section.now', 'tui.hub.now.stop.label', 'tui.hub.now.stop.desc', {
        kind: 'open',
      }),
      hub('now.undo', 'tui.hub.section.now', 'tui.hub.now.undo.label', 'tui.hub.now.undo.desc', {
        kind: 'open',
      }),
      hub(
        'now.compact',
        'tui.hub.section.now',
        'tui.hub.now.compact.label',
        'tui.hub.now.compact.desc',
        { kind: 'open' },
      ),
    );
  }

  items.push(
    hub(
      'modes.plan',
      'tui.hub.section.modes',
      'tui.hub.modes.plan.label',
      'tui.hub.modes.plan.desc',
      { badge: onOff(state.planMode), kind: 'toggle' },
    ),
    hub(
      'modes.ask',
      'tui.hub.section.modes',
      'tui.hub.modes.ask.label',
      'tui.hub.modes.ask.desc',
      {
        keywords: ['ask', 'read', 'research', 'explore'],
        badge: onOff(state.askMode),
        kind: 'toggle',
      },
    ),
    hub(
      'modes.goals',
      'tui.hub.section.modes',
      'tui.hub.modes.goals.label',
      'tui.hub.modes.goals.desc',
      { keywords: ['goal', 'queue', 'ralph', 'next'] },
    ),
    hub(
      'modes.premium',
      'tui.hub.section.modes',
      'tui.hub.modes.premium.label',
      'tui.hub.modes.premium.desc',
      { badge: onOff(state.premiumQualityMode), kind: 'toggle' },
    ),
    hub(
      'modes.permission',
      'tui.hub.section.modes',
      'tui.hub.modes.permission.label',
      'tui.hub.modes.permission.desc',
      { badge: state.permissionMode, kind: 'cycle' },
    ),
    ...(conductorUx
      ? [
          hub(
            'modes.conductorProject',
            'tui.hub.section.modes',
            'tui.hub.modes.conductorProject.label',
            'tui.hub.modes.conductorProject.desc',
            {
              badge: state.conductorProjectMode ?? 'balanced',
              kind: 'cycle',
              keywords: ['conductor', 'pool', 'hotfix', 'greenfield'],
            },
          ),
          hub(
            'modes.reduceParallelism',
            'tui.hub.section.modes',
            'tui.hub.modes.reduceParallelism.label',
            'tui.hub.modes.reduceParallelism.desc',
            {
              badge: state.conductorProjectMode === 'hotfix' ? 'hotfix' : undefined,
              keywords: ['conductor', 'hotfix', 'pool', 'parallel', 'cost', 'throttle'],
            },
          ),
          hub(
            'modes.transcriptRegion',
            'tui.hub.section.modes',
            'tui.hub.modes.transcriptRegion.label',
            'tui.hub.modes.transcriptRegion.desc',
            {
              badge: state.transcriptRegionMode ?? 'chat',
              kind: 'cycle',
              keywords: ['timeline', 'conductor', 'region'],
            },
          ),
        ]
      : []),
  );

  items.push(
    hub('start.new', 'tui.hub.section.start', 'tui.hub.start.new.label', 'tui.hub.start.new.desc'),
    hub(
      'start.sessions',
      'tui.hub.section.start',
      'tui.hub.start.sessions.label',
      'tui.hub.start.sessions.desc',
    ),
    hub(
      'start.export',
      'tui.hub.section.start',
      'tui.hub.start.export.label',
      'tui.hub.start.export.desc',
    ),
    hub(
      'start.fork',
      'tui.hub.section.start',
      'tui.hub.start.fork.label',
      'tui.hub.start.fork.desc',
      { keywords: ['fork', 'worktree', 'branch'] },
    ),
    ...(conductorUx
      ? [
          hub(
            'start.conductorHowto',
            'tui.hub.section.start',
            'tui.hub.start.conductorHowto.label',
            'tui.hub.start.conductorHowto.desc',
            { keywords: ['conductor', 'jobs', 'howto', 'tour', 'onboarding'] },
          ),
        ]
      : []),
    hub('chat.model', 'tui.hub.section.chat', 'tui.hub.chat.model.label', 'tui.hub.chat.model.desc', {
      badge: state.model !== undefined && state.model.length > 0 ? state.model : undefined,
    }),
    hub(
      'chat.thinking',
      'tui.hub.section.chat',
      'tui.hub.chat.thinking.label',
      'tui.hub.chat.thinking.desc',
      {
        badge:
          state.thinkingLevel !== undefined && state.thinkingLevel.length > 0
            ? state.thinkingLevel
            : undefined,
      },
    ),
    hub(
      'chat.retry',
      'tui.hub.section.chat',
      'tui.hub.chat.retry.label',
      'tui.hub.chat.retry.desc',
    ),
  );

  if (!streaming) {
    items.push(
      hub(
        'chat.undo',
        'tui.hub.section.chat',
        'tui.hub.chat.undo.label',
        'tui.hub.chat.undo.desc',
      ),
      hub(
        'chat.rewind',
        'tui.hub.section.chat',
        'tui.hub.chat.rewind.label',
        'tui.hub.chat.rewind.desc',
        { keywords: ['rewind', 'snapshot', 'restore'] },
      ),
      hub(
        'chat.compact',
        'tui.hub.section.chat',
        'tui.hub.chat.compact.label',
        'tui.hub.chat.compact.desc',
      ),
    );
  }

  items.push(
    hub('chat.btw', 'tui.hub.section.chat', 'tui.hub.chat.btw.label', 'tui.hub.chat.btw.desc'),
    hub(
      'chat.loops',
      'tui.hub.section.chat',
      'tui.hub.chat.loops.label',
      'tui.hub.chat.loops.desc',
      { keywords: ['loop', 'interval', 'repeat'] },
    ),
    hub(
      'workspace.files',
      'tui.hub.section.workspace',
      'tui.hub.workspace.files.label',
      'tui.hub.workspace.files.desc',
    ),
    hub(
      'workspace.search',
      'tui.hub.section.workspace',
      'tui.hub.workspace.search.label',
      'tui.hub.workspace.search.desc',
    ),
    hub(
      'workspace.diff',
      'tui.hub.section.workspace',
      'tui.hub.workspace.diff.label',
      'tui.hub.workspace.diff.desc',
    ),
    hub(
      'workspace.log',
      'tui.hub.section.workspace',
      'tui.hub.workspace.log.label',
      'tui.hub.workspace.log.desc',
    ),
    hub(
      'workspace.errors',
      'tui.hub.section.workspace',
      'tui.hub.workspace.errors.label',
      'tui.hub.workspace.errors.desc',
      { keywords: ['problems', 'errors'] },
    ),
    hub(
      'workspace.tasks',
      'tui.hub.section.workspace',
      'tui.hub.workspace.tasks.label',
      'tui.hub.workspace.tasks.desc',
    ),
    hub(
      'workspace.missionControl',
      'tui.hub.section.workspace',
      conductorUx ? 'tui.hub.workspace.workerDock.label' : 'tui.hub.workspace.missionControl.label',
      conductorUx
        ? 'tui.hub.workspace.workerDock.desc'
        : 'tui.hub.workspace.missionControl.desc',
      { keywords: ['agents', 'subagent', 'monitor', 'dock', 'workers', 'mission'] },
    ),
    hub(
      'workspace.jobDeck',
      'tui.hub.section.workspace',
      'tui.hub.workspace.jobDeck.label',
      'tui.hub.workspace.jobDeck.desc',
      { keywords: ['conductor', 'deck', 'monitor', 'worker', 'transcript'] },
    ),
    hub(
      'workspace.jobInbox',
      'tui.hub.section.workspace',
      'tui.hub.workspace.jobInbox.label',
      'tui.hub.workspace.jobInbox.desc',
      { keywords: ['inbox', 'conductor', 'needs_user', 'interrupted', 'unread'] },
    ),
    hub(
      'workspace.jobOps',
      'tui.hub.section.workspace',
      'tui.hub.workspace.jobOps.label',
      'tui.hub.workspace.jobOps.desc',
      { keywords: ['job', 'conductor', 'inbox', 'resume', 'cancel', 'gc'] },
    ),
    hub(
      'workspace.cron',
      'tui.hub.section.workspace',
      'tui.hub.workspace.cron.label',
      'tui.hub.workspace.cron.desc',
      { keywords: ['cron', 'schedule', 'scheduled'] },
    ),
    hub(
      'workspace.status',
      'tui.hub.section.workspace',
      'tui.hub.workspace.status.label',
      'tui.hub.workspace.status.desc',
    ),
    hub(
      'extend.extensions',
      'tui.hub.section.extend',
      'tui.hub.extend.extensions.label',
      'tui.hub.extend.extensions.desc',
      { keywords: ['plugins', 'mcp', 'skills', 'hooks', 'marketplace'] },
    ),
    hub(
      'appearance.theme',
      'tui.hub.section.appearance',
      'tui.hub.appearance.theme.label',
      'tui.hub.appearance.theme.desc',
    ),
    hub(
      'appearance.appearance',
      'tui.hub.section.appearance',
      'tui.hub.appearance.appearance.label',
      'tui.hub.appearance.appearance.desc',
    ),
    hub(
      'account.login',
      'tui.hub.section.account',
      state.signedIn === true ? 'tui.hub.account.addProvider.label' : 'tui.hub.account.login.label',
      state.signedIn === true
        ? 'tui.hub.account.addProvider.desc'
        : 'tui.hub.account.login.desc',
      { badge: state.signedIn === true ? 'ready' : undefined },
    ),
    hub(
      'account.accounts',
      'tui.hub.section.account',
      'tui.hub.account.accounts.label',
      'tui.hub.account.accounts.desc',
    ),
    hub(
      'account.logout',
      'tui.hub.section.account',
      'tui.hub.account.logout.label',
      'tui.hub.account.logout.desc',
      { keywords: ['logout', 'disconnect', 'sign out'] },
    ),
    hub(
      'account.upgrade',
      'tui.hub.section.account',
      'tui.hub.account.upgrade.label',
      'tui.hub.account.upgrade.desc',
      { keywords: ['upgrade', 'update', 'version', 'install', 'release', 'liora update'] },
    ),
    hub(
      'help.shortcuts',
      'tui.hub.section.help',
      'tui.hub.help.shortcuts.label',
      'tui.hub.help.shortcuts.desc',
      {
        keywords: ['palette', 'omnibox', 'fuzzy', 'slash', 'command palette', 'hub', 'search'],
      },
    ),
    hub(
      'help.commands',
      'tui.hub.section.help',
      'tui.hub.help.commands.label',
      'tui.hub.help.commands.desc',
    ),
    ...buildSettingsJumpHubItems(),
  );
  return items;
}
