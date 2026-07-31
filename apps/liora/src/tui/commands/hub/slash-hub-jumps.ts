/**
 * Command Hub One-search entries for slash commands + skills (searchOnly).
 */

import type { LioraSlashCommand } from '../types';
import type { CommandHubItem } from '../../components/dialogs/command-hub/command-hub-types';

export function isSlashHubActionId(id: string): id is `slash.${string}` {
  return id.startsWith('slash.') && id.length > 'slash.'.length;
}

export function slashNameFromHubId(id: `slash.${string}`): string {
  return id.slice('slash.'.length);
}

/** Advanced slash + skill commands as Hub searchOnly rows (idle list stays curated). */
export function buildSlashJumpHubItems(
  commands: readonly LioraSlashCommand[],
  skillNames: ReadonlySet<string> = new Set(),
): CommandHubItem[] {
  return commands.map((command) => {
    const isSkill = skillNames.has(command.name);
    return {
      id: `slash.${command.name}`,
      section: isSkill ? 'Skills' : 'Commands',
      label: `/${command.name}`,
      description: command.description,
      searchOnly: true,
      keywords: [
        'slash',
        'command',
        ...(isSkill ? (['skill'] as const) : []),
        ...(command.aliases ?? []),
      ],
    };
  });
}
