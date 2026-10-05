/**
 * /fast slash command — toggles the OpenAI Fast service tier
 * (`service_tier: "fast"`) on the current model's provider. Mirrors the Codex
 * CLI `/fast` toggle: persists `service_tier` on the provider config so every
 * subsequent request uses it.
 */

import { LLM_NOT_SET_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import type { AutocompleteItem } from '../../renderer';
import type { SlashCommandHost } from '../hub/dispatch';

const FAST_ARGS = ['on', 'off', 'status'] as const;
const FAST_ARG_HINTS: Record<(typeof FAST_ARGS)[number], string> = {
  on: 'Enable the Fast service tier (higher credit rate)',
  off: 'Back to the standard service tier',
  status: 'Show the current setting',
};

export function fastArgumentCompletions(args: string): AutocompleteItem[] {
  const tokens = args.trim().split(/\s+/);
  if (tokens.length > 1) return [];
  const partial = (tokens[0] ?? '').toLowerCase();
  return FAST_ARGS.filter((arg) => arg.startsWith(partial)).map((arg) => ({
    value: arg,
    label: arg,
    description: FAST_ARG_HINTS[arg],
  }));
}

type FastArg = 'on' | 'off' | 'status' | '';

function parseFastArg(args: string): FastArg | undefined {
  const arg = args.trim().toLowerCase();
  if (arg === '' || arg === 'on' || arg === 'off' || arg === 'status') return arg;
  return undefined;
}

export async function handleFastCommand(host: SlashCommandHost, args: string): Promise<void> {
  const arg = parseFastArg(args);
  if (arg === undefined) {
    host.showError(`Unknown fast argument: ${args.trim()}. Use on, off, or status.`);
    return;
  }

  const modelAlias = host.state.appState.model.trim();
  if (modelAlias.length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE());
    return;
  }

  let providerId = host.state.appState.availableModels[modelAlias]?.provider;
  const config = await host.harness.getConfig();
  if (providerId === undefined || providerId.length === 0) {
    providerId = config.defaultProvider;
  }
  const provider = providerId === undefined ? undefined : config.providers[providerId];
  if (providerId === undefined || provider === undefined) {
    host.showError('No provider configured for the current model.');
    return;
  }
  if (provider.type !== 'openai_responses' && provider.type !== 'openai') {
    host.showError(
      `Fast mode requires an OpenAI/Codex provider; "${providerId}" uses ${provider.type}.`,
    );
    return;
  }

  const enabled = provider.serviceTier === 'fast';
  const next = arg === 'on' ? true : arg === 'off' ? false : arg === 'status' ? undefined : !enabled;
  if (next === undefined) {
    host.showStatus(
      enabled
        ? `Fast mode is on for ${providerId} (service_tier=fast — higher speed, higher credit rate).`
        : `Fast mode is off for ${providerId}.`,
    );
    return;
  }

  try {
    if (next) {
      await host.harness.setConfig({ providers: { [providerId]: { serviceTier: 'fast' } } });
    } else {
      await host.harness.deleteConfigFields([`providers.${providerId}.serviceTier`]);
    }
  } catch (error) {
    host.showError(`Failed to update fast mode: ${formatErrorMessage(error)}`);
    return;
  }

  host.track('fast_toggle', { enabled: next, provider: providerId });
  host.showStatus(
    next
      ? `Fast mode on for ${providerId} — requests send service_tier=fast (higher credit rate).`
      : `Fast mode off for ${providerId}.`,
  );
}
