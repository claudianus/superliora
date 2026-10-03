import { type LioraErrorPayload, toKimiErrorPayload } from '#/errors/index';
import type { TurnEndedEvent } from '../../rpc/events';

export const LLM_NOT_SET_MESSAGE = 'LLM not set, run /login or /provider to connect a model';

export function summarizeTurnError(error: unknown, turnId: number): LioraErrorPayload {
  const payload = toKimiErrorPayload(error);
  return {
    ...payload,
    ...(payload.code === 'model.not_configured' ? { message: LLM_NOT_SET_MESSAGE } : {}),
    details: { ...payload.details, turnId },
  };
}

const ABANDONED_TOOL_CODE = 'ABANDONED_TOOL' as const;
export const ABANDONED_TOOL_WARNING_CODE = 'abandoned-tool-exchange' as const;

export function abandonedToolResultOutput(ended: TurnEndedEvent): string {
  const cause = ended.reason === 'failed'
    ? `the turn failed${ended.error !== undefined ? ` (${ended.error.message})` : ''}`
    : ended.reason === 'cancelled' ? 'the turn was cancelled' : 'the turn ended';
  return `${ABANDONED_TOOL_CODE}: ${cause} before this tool result was recorded. Completion is unknown.`;
}

export function formatAbandonedToolWireTip(closedCount: number, reason: TurnEndedEvent['reason']): string {
  return `${ABANDONED_TOOL_CODE}: closed ${String(closedCount)} unresolved tool exchange${closedCount === 1 ? '' : 's'} (turn ${reason}). Completion is unknown.`;
}
