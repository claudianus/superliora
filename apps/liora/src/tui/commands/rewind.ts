/**
 * `/rewind` — restore disk files from the latest (or specified) sealed turn
 * snapshot. Conversation history is not rewritten; pair with `/undo` if needed.
 */

import { formatErrorMessage } from '../utils/event-payload';
import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import type { SlashCommandHost } from './hub/dispatch';

export async function handleRewindCommand(
  host: SlashCommandHost,
  args: string = '',
): Promise<void> {
  if (host.state.appState.streamingPhase !== 'idle') {
    host.showError('스트리밍 중에는 /rewind를 사용할 수 없습니다. Esc 또는 Ctrl-C로 중단하세요.');
    return;
  }

  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
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
      `턴 ${result.turnId} 파일 복원 완료`,
      `복원 ${String(restored)}`,
      `삭제 ${String(deleted)}`,
    ];
    if (skipped > 0) parts.push(`민감 경로 스킵 ${String(skipped)}`);
    if (errors > 0) parts.push(`오류 ${String(errors)}`);
    host.showStatus(parts.join(' · '));
    if (errors > 0) {
      const detail = result.errors
        .slice(0, 3)
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ');
      host.showError(`일부 파일 복원 실패: ${detail}`);
    }
  } catch (error) {
    host.showError(`파일 되감기 실패: ${formatErrorMessage(error)}`);
  }
}
