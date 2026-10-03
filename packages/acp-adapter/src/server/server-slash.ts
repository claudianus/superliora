import type { AvailableCommand } from '@agentclientprotocol/sdk';
import type { LioraHarness, Session } from '@superliora/sdk';
import { ACP_BUILTIN_SLASH_COMMANDS, isAcpBuiltinSlashCommand } from '#/builtin-commands';

export interface SlashCommandsSnapshot {
  readonly commands: ReadonlyArray<AvailableCommand>;
}

export type SlashCommandsResolver =
  | ReadonlyArray<AvailableCommand>
  | SlashCommandsSnapshot
  | ((session: Session) => Promise<ReadonlyArray<AvailableCommand> | SlashCommandsSnapshot>
      | ReadonlyArray<AvailableCommand> | SlashCommandsSnapshot);

export interface ResolvedSlashCommands {
  readonly commands: ReadonlyArray<AvailableCommand>;
}

export function createSlashCommandsResolver(
  slash: SlashCommandsResolver | undefined,
): (session: Session) => Promise<ResolvedSlashCommands> {
  return async (session) => {
    const input = typeof slash === 'function' ? await slash(session) : slash;
    const commands = input === undefined ? ACP_BUILTIN_SLASH_COMMANDS
      : Array.isArray(input) ? input : (input as SlashCommandsSnapshot).commands;
    return { commands: commands.filter((command) => isAcpBuiltinSlashCommand(command.name)) };
  };
}

/** Any configured provider with usable credentials satisfies the native auth gate. */
export async function harnessIsAuthed(harness: LioraHarness): Promise<boolean> {
  const status = await harness.auth.status();
  return status.providers.some((entry) => entry.hasToken);
}
