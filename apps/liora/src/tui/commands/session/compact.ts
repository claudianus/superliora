import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import type { SlashCommandHost } from '../hub/dispatch';

/** Compact the active session through its real SDK operation. */
export async function handleCompactCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE());
    return;
  }
  await session.compact({ instruction: args.trim() || undefined });
}
