import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export async function handlePremiumQualityCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const current = host.state.appState.premiumQualityMode === true;

  if (subcmd === 'on') {
    if (current) {
      host.showNotice('Premium Quality mode is already on');
      return;
    }
    await applyPremiumQuality(host, true);
    return;
  }

  if (subcmd === 'off') {
    if (!current) {
      host.showNotice('Premium Quality mode is already off');
      return;
    }
    await applyPremiumQuality(host, false);
    return;
  }

  if (subcmd === 'status' || subcmd.length === 0) {
    host.showNotice(
      current ? 'Premium Quality mode: ON' : 'Premium Quality mode: OFF',
      current
        ? 'Elevating visuals, UX, code, performance, accessibility, and evidence on every step.'
        : 'Use /premium on to enable continuous premium-quality pursuit.',
    );
    return;
  }

  host.showError('Usage: /premium [on|off|status]');
}

export async function applyPremiumQuality(
  host: SlashCommandHost,
  enabled: boolean,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  try {
    await session.setPremiumQuality(enabled);
    host.setAppState({ premiumQualityMode: enabled });
    host.showNotice(
      enabled ? 'Premium Quality mode: ON' : 'Premium Quality mode: OFF',
      enabled
        ? 'Continuous multi-lens quality elevation is active for this session.'
        : undefined,
      { coalesceKey: 'premium-quality-mode' },
    );
  } catch (error) {
    host.showError(`Failed to set Premium Quality mode: ${formatErrorMessage(error)}`);
  }
}
