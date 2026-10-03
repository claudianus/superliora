// ACP intercepts its native built-in commands and reports unknown commands locally.

import {
  ACP_BUILTIN_SLASH_COMMAND_NAMES,
  type AcpBuiltinSlashCommandName,
} from './builtin-commands';

export interface ParsedSlashInput {
  readonly name: string;
  readonly args: string;
}

export type SlashIntent =
  | { readonly kind: 'builtin'; readonly name: AcpBuiltinSlashCommandName; readonly args: string }
  | { readonly kind: 'unknown'; readonly name: string; readonly args: string }
  | { readonly kind: 'passthrough' };

export function parseSlashInput(input: string): ParsedSlashInput | null {
  if (!input.startsWith('/')) return null;
  const trimmed = input.slice(1).trim();
  if (trimmed.length === 0) return null;
  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  if (name.includes('/')) return null;
  return { name, args };
}

export function detectSlashIntent(
  text: string,
  builtinCommandNames: ReadonlySet<string> = ACP_BUILTIN_SLASH_COMMAND_NAMES,
): SlashIntent {
  const parsed = parseSlashInput(text);
  if (parsed === null) return { kind: 'passthrough' };
  if (builtinCommandNames.has(parsed.name)) {
    return { kind: 'builtin', name: parsed.name as AcpBuiltinSlashCommandName, args: parsed.args };
  }
  return { kind: 'unknown', name: parsed.name, args: parsed.args };
}
