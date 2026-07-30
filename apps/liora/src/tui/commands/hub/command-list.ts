/**
 * Declarative slash command metadata — the single source of truth for all
 * built-in /commands (name, aliases, description, priority, visibility,
 * availability, argument hints, and completion function references).
 */

import type { LioraSlashCommand } from '../../types';
import { BUILTIN_SLASH_COMMANDS_MODES } from './command-list-modes';
import { BUILTIN_SLASH_COMMANDS_SESSION } from './command-list-session';

export const BUILTIN_SLASH_COMMANDS = [
  ...BUILTIN_SLASH_COMMANDS_MODES,
  ...BUILTIN_SLASH_COMMANDS_SESSION,
] as const satisfies readonly LioraSlashCommand[];

export type BuiltinSlashCommandName = (typeof BUILTIN_SLASH_COMMANDS)[number]['name'];
/** Widened so optional fields like `completeArgs` stay optional across the registry union. */
export type BuiltinSlashCommand = LioraSlashCommand<BuiltinSlashCommandName>;
