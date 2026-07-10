import type { ParsedSlashInput } from './types';

export function parseSlashInput(input: string): ParsedSlashInput | null {
  const commandText = input.trimStart();
  if (!commandText.startsWith('/')) return null;
  const trimmed = commandText.slice(1).trim();
  if (trimmed.length === 0) return null;
  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  if (name.includes('/') && !name.includes(':')) return null;
  return { name, args };
}
