import type { CommandHubActionId } from './command-hub-types';


export function isCommandHubCycleId(id: CommandHubActionId): boolean {
  return (
    id === 'modes.permission' ||
    id === 'modes.transcriptRegion'
  );
}


/** Nested center-modal pickers — Esc returns to Hub. */
export function commandHubNestsPicker(id: CommandHubActionId): boolean {
  if (id === 'settings.open' || id.startsWith('settings.')) return true;
  switch (id) {
    case 'start.folder':
    case 'start.sessions':
    case 'chat.model':
    case 'chat.thinking':
    case 'modes.permission':
    case 'appearance.theme':
    case 'appearance.appearance':
    case 'workspace.jobOps':
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

export function cycleTranscriptRegionMode(
  current: string | undefined,
): 'chat' | 'timeline' {
  return current === 'timeline' ? 'chat' : 'timeline';
}
