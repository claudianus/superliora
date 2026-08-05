import type { AutocompleteItem } from '#/tui/renderer';

import { handleAppearanceCommand } from '../config/appearance/appearance';
import { currentAppearance } from '../config/appearance/tui-persist';
import type { SlashCommandHost } from '../hub/dispatch';

/**
 * `/neat` — structured-first tool rendering. Delegates to
 * `/appearance neat <on|off>` so persistence, status output, and Settings share
 * one code path, exactly as `/transcript` does for density.
 */

const NEAT_ARGS = ['on', 'off', 'toggle', 'status'] as const;

const ARG_HINTS: Record<(typeof NEAT_ARGS)[number], string> = {
  on: 'Structured cards for recognized tool results',
  off: 'Raw tool output (previous behavior)',
  toggle: 'Flip the current setting',
  status: 'Show the current setting',
};

export function neatArgumentCompletions(args: string): AutocompleteItem[] {
  const tokens = args.trim().split(/\s+/);
  if (tokens.length > 1) return [];
  const partial = (tokens[0] ?? '').toLowerCase();
  return NEAT_ARGS.filter((arg) => arg.startsWith(partial)).map((arg) => ({
    value: arg,
    label: arg,
    description: ARG_HINTS[arg],
  }));
}

export async function handleNeatCommand(host: SlashCommandHost, args: string): Promise<void> {
  const raw = args.trim().toLowerCase();
  const enabled = currentAppearance(host).neat;

  if (raw === 'status' || raw === 'help') {
    host.showNotice(
      'Neat',
      `Neat cards: ${enabled ? 'on' : 'off'}\n` +
        'Usage: /neat [on|off|toggle]\n' +
        'On renders recognized tool results (tests, typecheck, lint, git, MCP JSON)\n' +
        'as structured cards. Transcript detail `full` keeps the raw body below.',
    );
    return;
  }
  // No args and `toggle` both flip — the common case is a quick escape hatch.
  const next = raw.length === 0 || raw === 'toggle' ? !enabled : raw === 'on' ? true : raw === 'off' ? false : undefined;
  if (next === undefined) {
    host.showError(`Unknown neat argument: ${raw} (expected on|off|toggle|status)`);
    return;
  }
  await handleAppearanceCommand(host, `neat ${next ? 'on' : 'off'}`);
}
