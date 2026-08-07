import type { CommandHubActionId } from './command-hub-types';

const TOGGLE_IDS = new Set<CommandHubActionId>([
  'modes.plan',
  'modes.ask',
  'modes.premium',
]);

export function isCommandHubToggleId(id: CommandHubActionId): boolean {
  return TOGGLE_IDS.has(id);
}

export function isCommandHubCycleId(id: CommandHubActionId): boolean {
  return id === 'modes.permission';
}

/** Keep Hub open for toggles/cycles; nest or navigate for the rest. */
export function commandHubKeepsOpen(id: CommandHubActionId): boolean {
  return isCommandHubToggleId(id) || isCommandHubCycleId(id);
}

/** Nested center-modal pickers — Esc returns to Hub. */
export function commandHubNestsPicker(id: CommandHubActionId): boolean {
  if (id === 'settings.open' || id.startsWith('settings.')) return true;
  switch (id) {
    case 'start.sessions':
    case 'chat.model':
    case 'chat.thinking':
    case 'chat.loops':
    case 'modes.permission':
    case 'extend.extensions':
    case 'appearance.theme':
    case 'appearance.appearance':
    case 'workspace.jobOps':
    case 'workspace.cron':
    case 'help.shortcuts':
    case 'help.commands':
      return true;
    default:
      return false;
  }
}

export function cyclePermissionMode(
  current: string | undefined,
): 'manual' | 'auto' | 'yolo' {
  switch (current) {
    case 'manual':
      return 'auto';
    case 'auto':
      return 'yolo';
    case 'yolo':
      return 'manual';
    default:
      return 'auto';
  }
}
