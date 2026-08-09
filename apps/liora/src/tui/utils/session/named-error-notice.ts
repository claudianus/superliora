/**
 * Loop28a — named recovery copy for terminal context/compaction error codes.
 *
 * Engine emits ErrorEvent with codes like `context.overflow` / `compaction.unable`.
 * Generic showError dumps the raw message; operators need a recovery path.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export type NamedErrorNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: string;
};

export function formatNamedSessionErrorNotice(
  code: string | undefined,
  message: string | undefined,
): NamedErrorNotice | undefined {
  if (code === 'context.overflow') {
    return {
      title: ttui('tui.notice.contextOverflow.title'),
      detail:
        message !== undefined && message.length > 0
          ? message
          : ttui('tui.notice.contextOverflow.detail'),
      status: ttui('tui.notice.contextOverflow.status'),
      coalesceKey: 'context-overflow-terminal',
    };
  }
  if (code === 'compaction.unable') {
    return {
      title: ttui('tui.notice.compactionUnable.title'),
      detail:
        message !== undefined && message.length > 0
          ? message
          : ttui('tui.notice.compactionUnable.detail'),
      status: ttui('tui.notice.compactionUnable.status'),
      coalesceKey: 'compaction-unable',
    };
  }
  return undefined;
}
