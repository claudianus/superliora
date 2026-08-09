/**
 * Declarative slash command metadata — modes, settings, and harness controls.
 */

import type { LioraSlashCommand } from '../types';
import { ttui } from '#/tui/utils/tui-i18n';
import {
  toggleOnOffArgumentCompletions,
  permissionArgumentCompletions,
  contextArgumentCompletions,
  premiumArgumentCompletions,
  askArgumentCompletions,
  planArgumentCompletions,
  thinkingArgumentCompletions,
  helpArgumentCompletions,
  extensionsArgumentCompletions,
  cronArgumentCompletions,
  memoryArgumentCompletions,
  addDirArgumentCompletions,
  loopArgumentCompletions,
  goalArgumentCompletions,
  editorArgumentCompletions,
  themeArgumentCompletions,
  appearanceArgumentCompletions,
  personaArgumentCompletions,
  profileArgumentCompletions,
} from './completion-specs';
import { pluginsArgumentCompletions } from '../plugins/plugins';
import { transcriptArgumentCompletions } from '../session/transcript';

function slashDesc(name: string): string {
  return ttui(`tui.slash.${name}`);
}

export function getBuiltinSlashCommandsModes(): readonly LioraSlashCommand[] {
  return [

  {
    name: 'yolo',
    aliases: ['yes'],
    description: slashDesc('yolo'),
    priority: 50,
    argumentHint: '[on|off]',
    completeArgs: toggleOnOffArgumentCompletions,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'auto',
    aliases: [],
    description: slashDesc('auto'),
    priority: 50,
    argumentHint: '[on|off]',
    completeArgs: toggleOnOffArgumentCompletions,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'permission',
    aliases: [],
    description: slashDesc('permission'),
    priority: 100,
    argumentHint: '[manual|auto|yolo]',
    completeArgs: permissionArgumentCompletions,
    availability: 'always',
  },
  {
    name: 'profile',
    aliases: [],
    description: slashDesc('profile'),
    priority: 95,
    argumentHint: '[status|core|agent|superliora-full]',
    completeArgs: profileArgumentCompletions,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'settings',
    aliases: ['config'],
    description: slashDesc('settings'),
    priority: 100,
    availability: 'always',
  },
  {
    name: 'context',
    aliases: ['working-set', 'workingset'],
    description: slashDesc('context'),
    priority: 90,
    argumentHint: '[economy|balanced|deep|full|status]',
    completeArgs: contextArgumentCompletions,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'premium',
    aliases: ['pq'],
    description: slashDesc('premium'),
    priority: 100,
    argumentHint: '[on|off|status]',
    completeArgs: premiumArgumentCompletions,
    availability: 'always',
  },
  {
    name: 'plan',
    aliases: [],
    description: slashDesc('plan'),
    priority: 80,
    argumentHint: '[on|off|clear]',
    completeArgs: planArgumentCompletions,
    availability: (args) => (args.trim().toLowerCase() === 'clear' ? 'idle-only' : 'always'),
  },
  {
    name: 'ask',
    aliases: [],
    description: slashDesc('ask'),
    priority: 79,
    argumentHint: '[on|off]',
    completeArgs: askArgumentCompletions,
    availability: () => 'always',
  },
] as const satisfies readonly LioraSlashCommand[];
}
