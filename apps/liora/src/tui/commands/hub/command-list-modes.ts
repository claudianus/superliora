/**
 * Declarative slash command metadata — modes, settings, and harness controls.
 */

import type { LioraSlashCommand } from '../types';
import { ttui } from '#/tui/utils/tui-i18n';
import { toggleOnOffArgumentCompletions, permissionArgumentCompletions } from './completion-specs';

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
    name: 'settings',
    aliases: ['config'],
    description: slashDesc('settings'),
    priority: 100,
    availability: 'always',
  },
] as const satisfies readonly LioraSlashCommand[];
}
