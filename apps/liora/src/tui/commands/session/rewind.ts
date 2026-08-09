/**
 * `/rewind` — restore disk files from the latest (or specified) sealed turn
 * snapshot. Conversation history is not rewritten; pair with `/undo` if needed.
 */

import { formatErrorMessage } from '../../utils/event-payload';
import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { ttui } from '../../utils/tui-i18n';
import type { SlashCommandHost } from '../hub/dispatch';

export async function handleRewindCommand(
  host: SlashCommandHost,
  args: string = '',
): Promise<void> {
  if (host.state.appState.streamingPhase !== 'idle') {
    host.showError(ttui('tui.rewind.streamingBlocked'));
    return;
  }

  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE());
    return;
  }

  const trimmed = args.trim();
  const turnId = trimmed.length === 0 ? undefined : trimmed;

  try {
    const result = await session.rewindFiles(turnId !== undefined ? { turnId } : {});
    const restored = result.restored.length;
    const deleted = result.deleted.length;
    const skipped = result.skippedSensitive.length;
    const errors = result.errors.length;
    const parts = [
      ttui('tui.rewind.turnComplete', { turnId: result.turnId }),
      ttui('tui.rewind.restored', { count: String(restored) }),
      ttui('tui.rewind.deleted', { count: String(deleted) }),
    ];
    if (skipped > 0) {
      parts.push(ttui('tui.rewind.skippedSensitive', { count: String(skipped) }));
    }
    if (errors > 0) parts.push(ttui('tui.rewind.errors', { count: String(errors) }));
    host.showStatus(parts.join(' · '));
    if (errors > 0) {
      const detail = result.errors
        .slice(0, 3)
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ');
      host.showError(ttui('tui.rewind.partialFailed', { detail }));
    }
  } catch (error) {
    host.showError(ttui('tui.rewind.failed', { message: formatErrorMessage(error) }));
  }
}
