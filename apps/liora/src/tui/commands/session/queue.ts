import type { SlashCommandHost } from '../hub/dispatch';
import { ttui } from '#/tui/utils/tui-i18n';

/**
 * `/queue clear` — drop every queued follow-up at once.
 *
 * Before this command the only way to unqueue was pressing ↑ repeatedly and
 * deleting each recalled draft by hand, and the recall path could lose the
 * message outright. Clearing is a pure TUI-side buffer operation, so it stays
 * available mid-turn.
 */
export function handleQueueCommand(host: SlashCommandHost, args: string): void {
  const trimmed = args.trim();
  if (trimmed.length > 0 && trimmed !== 'clear') {
    host.showError(ttui('tui.queue.usage'));
    return;
  }

  const count = host.state.queuedMessages.length;
  if (count === 0) {
    host.showStatus(ttui('tui.queue.empty'), 'textMuted');
    return;
  }

  host.clearQueuedMessages();
  host.showStatus(ttui('tui.queue.cleared', { count }), 'primary');
}
