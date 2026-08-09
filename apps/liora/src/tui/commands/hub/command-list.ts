/**
 * Declarative slash command metadata — the single source of truth for all
 * built-in /commands (name, aliases, description, priority, visibility,
 * availability, argument hints, and completion function references).
 */

import type { LioraSlashCommand } from '../types';
import { getBuiltinSlashCommandsModes } from './command-list-modes';
import { getBuiltinSlashCommandsSession } from './command-list-session';

/** Resolves localized slash-command descriptions on each call (locale switch). */
export function getBuiltinSlashCommands(): readonly LioraSlashCommand[] {
  return [...getBuiltinSlashCommandsModes(), ...getBuiltinSlashCommandsSession()];
}

/** @deprecated Prefer {@link getBuiltinSlashCommands} for locale-aware descriptions. */
export const BUILTIN_SLASH_COMMANDS = getBuiltinSlashCommands();

export type BuiltinSlashCommandName =
  | ReturnType<typeof getBuiltinSlashCommandsModes>[number]['name']
  | ReturnType<typeof getBuiltinSlashCommandsSession>[number]['name'];
/** Widened so optional fields like `completeArgs` stay optional across the registry union. */
export type BuiltinSlashCommand = LioraSlashCommand<BuiltinSlashCommandName>;
