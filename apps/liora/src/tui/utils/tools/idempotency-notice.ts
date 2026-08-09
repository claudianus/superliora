/**
 * Loop26b — surface mutation idempotency replays in the TUI.
 *
 * agent-core short-circuits identical Edit/Write/ApplyPatch within a turn and
 * appends `IDEMPOTENCY_REPLAY` to the tool output. Without a notice the operator
 * only sees a successful tool card and may miss that a second write was skipped.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export const IDEMPOTENCY_REPLAY_CODE = 'IDEMPOTENCY_REPLAY';

export type IdempotencyReplayNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'idempotency-replay';
};

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isIdempotencyReplayOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(IDEMPOTENCY_REPLAY_CODE);
}

export function formatIdempotencyReplayNotice(
  toolName?: string,
): IdempotencyReplayNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: ttui('tui.notice.idempotentWrite.title'),
    detail: ttui('tui.notice.idempotentWrite.detail', {
      tool,
      code: IDEMPOTENCY_REPLAY_CODE,
    }),
    status: ttui('tui.notice.idempotentWrite.status', { tool }),
    coalesceKey: 'idempotency-replay',
  };
}
