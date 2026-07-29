/**
 * Slash command registry — lookup, availability resolution, and sorting.
 *
 * Completion specs live in `./completion-specs.ts`; the declarative command
 * metadata array lives in `./command-list.ts`. This module re-exports both
 * for backward compatibility and provides the registry utility functions.
 */

import type { LioraSlashCommand, SlashCommandAvailability, SlashCommandVisibility } from './types';

// Re-export completion specs and functions (backward compat for `export * from './registry'`).
export * from './completion-specs';
export {
  BUILTIN_SLASH_COMMANDS,
  type BuiltinSlashCommand,
  type BuiltinSlashCommandName,
} from './command-list';

import { BUILTIN_SLASH_COMMANDS, type BuiltinSlashCommand } from './command-list';

export function findBuiltInSlashCommand(commandName: string): BuiltinSlashCommand | undefined {
  const commands = BUILTIN_SLASH_COMMANDS as readonly BuiltinSlashCommand[];
  return commands.find(
    (command) =>
      command.name === commandName ||
      command.aliases.includes(commandName) ||
      (command.hiddenAliases?.includes(commandName) ?? false),
  );
}

export function resolveSlashCommandAvailability(
  command: LioraSlashCommand,
  args: string,
): SlashCommandAvailability {
  const availability = command.availability ?? 'idle-only';
  return typeof availability === 'function' ? availability(args) : availability;
}

export function sortSlashCommands(commands: readonly LioraSlashCommand[]): LioraSlashCommand[] {
  return [...commands].toSorted(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
  );
}

export type SlashCommandHelpMode = 'primary' | 'advanced' | 'diagnostics';

export function slashCommandsForHelp(
  commands: readonly LioraSlashCommand[],
  mode: SlashCommandHelpMode,
): LioraSlashCommand[] {
  const visibility: SlashCommandVisibility = mode === 'diagnostics' ? 'diagnostic' : mode;
  return commands.filter((command) => (command.visibility ?? 'primary') === visibility);
}
