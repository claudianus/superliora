/**
 * Loop26b — surface mutation idempotency replays in the TUI.
 *
 * agent-core short-circuits identical Edit/Write/ApplyPatch within a turn and
 * appends `IDEMPOTENCY_REPLAY` to the tool output. Without a notice the operator
 * only sees a successful tool card and may miss that a second write was skipped.
 */

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
    title: 'Idempotent write replayed',
    detail: `Identical ${tool} args already applied this turn (code=${IDEMPOTENCY_REPLAY_CODE}). Prior result was replayed — no second write. Change args if you need a new mutation.`,
    status: `Idempotent replay on ${tool} (no second write)`,
    coalesceKey: 'idempotency-replay',
  };
}
