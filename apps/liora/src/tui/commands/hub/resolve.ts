import {
  findBuiltInSlashCommand,
  resolveSlashCommandAvailability,
  type BuiltinSlashCommand,
  type BuiltinSlashCommandName,
} from './registry';
import { ttui } from '../../utils/tui-i18n';
import { parseSlashInput } from './parse';
import type { SlashCommandBusyReason } from '../types';

export type SlashCommandIntent =
  | { readonly kind: 'not-command' }
  | {
      readonly kind: 'builtin';
      readonly command: BuiltinSlashCommand;
      readonly name: BuiltinSlashCommandName;
      readonly args: string;
    }
  | { readonly kind: 'message'; readonly input: string }
  | {
      readonly kind: 'blocked';
      readonly commandName: string;
      readonly reason: SlashCommandBusyReason;
    };

export interface ResolveSlashCommandInput {
  readonly input: string;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
}

export function resolveSlashCommandInput(options: ResolveSlashCommandInput): SlashCommandIntent {
  const parsed = parseSlashInput(options.input);
  if (parsed === null) return { kind: 'not-command' };

  const command = findBuiltInSlashCommand(parsed.name);
  if (command !== undefined) {
    const busyReason = slashCommandBusyReason(options);
    if (
      busyReason !== undefined &&
      resolveSlashCommandAvailability(command, parsed.args) === 'idle-only'
    ) {
      return {
        kind: 'blocked',
        commandName: parsed.name,
        reason: busyReason,
      };
    }
    return {
      kind: 'builtin',
      command,
      name: command.name,
      args: parsed.args,
    };
  }


  return {
    kind: 'message',
    input: options.input,
  };
}


export function slashCommandBusyReason(
  options: Pick<ResolveSlashCommandInput, 'isStreaming' | 'isCompacting'>,
): SlashCommandBusyReason | undefined {
  if (options.isStreaming) return 'streaming';
  if (options.isCompacting) return 'compacting';
  return undefined;
}

export function slashBusyMessage(
  commandName: string,
  reason: SlashCommandBusyReason,
): string {
  if (reason === 'streaming') {
    return ttui('tui.hub.busy.streaming', { name: commandName });
  }
  return ttui('tui.hub.busy.compacting', { name: commandName });
}
