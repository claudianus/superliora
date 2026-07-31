import type { AvailableCommand } from '@agentclientprotocol/sdk';
import type { LioraHarness, Session } from '@superliora/sdk';

/**
 * Per-session snapshot returned by the {@link AcpServer} caller's
 * `slashCommands` resolver. Carries both what gets advertised in the
 * `available_commands_update` push and the `skillCommandMap` that
 * {@link AcpSession.prompt} consults to intercept `/skill:<name>`
 * inputs and route them to {@link Session.activateSkill}.
 *
 * `skillCommandMap` is optional for backward compatibility: callers
 * that pre-date slash-command routing (or that only advertise builtin
 * commands) can omit it and get the previous "always passthrough"
 * behavior.
 */
export interface SlashCommandsSnapshot {
  readonly commands: ReadonlyArray<AvailableCommand>;
  readonly skillCommandMap?: ReadonlyMap<string, string>;
}

export type SlashCommandsResolver =
  | ReadonlyArray<AvailableCommand>
  | SlashCommandsSnapshot
  | ((
      session: Session,
    ) =>
      | Promise<ReadonlyArray<AvailableCommand> | SlashCommandsSnapshot>
      | ReadonlyArray<AvailableCommand>
      | SlashCommandsSnapshot);

export interface ResolvedSlashCommands {
  readonly commands: ReadonlyArray<AvailableCommand>;
  readonly skillCommandMap: ReadonlyMap<string, string>;
}

export function toResolvedSlashCommands(
  input: ReadonlyArray<AvailableCommand> | SlashCommandsSnapshot,
): ResolvedSlashCommands {
  if (Array.isArray(input)) {
    return { commands: input, skillCommandMap: new Map() };
  }
  const snap = input as SlashCommandsSnapshot;
  return {
    commands: snap.commands,
    skillCommandMap: snap.skillCommandMap ?? new Map(),
  };
}

export function createSlashCommandsResolver(
  slash: SlashCommandsResolver | undefined,
): (session: Session) => Promise<ResolvedSlashCommands> {
  return typeof slash === 'function'
    ? async (session) => toResolvedSlashCommands(await slash(session))
    : async () => toResolvedSlashCommands(slash ?? []);
}

/**
 * Inline auth gate — moved out of `LioraAuthFacade.hasUsableToken()` so
 * the SDK doesn't have to carry an ACP-specific convenience method.
 * Mirrors the original semantics exactly: any provider with `hasToken`
 * set counts as authed.
 */
export async function harnessIsAuthed(harness: LioraHarness): Promise<boolean> {
  const status = await harness.auth.status();
  return status.providers.some((entry) =>  entry.hasToken);
}
