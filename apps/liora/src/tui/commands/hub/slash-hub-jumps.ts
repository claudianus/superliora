/**
 * Command Hub One-search entries for slash commands (searchOnly).
 */

import type { LioraSlashCommand } from '../types';
import type { CommandHubItem } from '../../components/dialogs/command-hub/command-hub-types';

export function isSlashHubActionId(id: string): id is `slash.${string}` {
  return id.startsWith('slash.') && id.length > 'slash.'.length;
}

export function slashNameFromHubId(id: `slash.${string}`): string {
  return id.slice('slash.'.length);
}

/** Slash commands as Hub searchOnly rows (idle list stays curated). */
export function buildSlashJumpHubItems(
  commands: readonly LioraSlashCommand[],
): CommandHubItem[] {
  const seen = new Set<string>();
  const items: CommandHubItem[] = [];
  for (const command of commands) {
    // Callers may concat primary/advanced/diagnostics surfaces; keep one row
    // per command name so the Hub search list never shows duplicates.
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    items.push({
      id: `slash.${command.name}`,
      // Localized section key (not a raw English label) so the row description
      // prefix and the section sort rank agree with the curated rows.
      section: 'Commands',
      sectionKey: 'tui.hub.section.commands',
      label: `/${command.name}`,
      description: command.description,
      searchOnly: true,
      keywords: [
        'slash',
        'command',
        ...(command.aliases ?? []),
      ],
    });
  }
  return items;
}
