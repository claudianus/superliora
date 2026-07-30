import { ErrorCodes, makeErrorPayload } from '#/errors/index';
import type { AgentEvent } from '#/rpc';

import type { AgentRecord } from './records';

export function buildRecordsWriteErrorEvent(
  error: unknown,
  record?: AgentRecord | undefined,
): AgentEvent {
  const message = error instanceof Error ? error.message : String(error);
  return {
    type: 'error',
    ...makeErrorPayload(
      ErrorCodes.RECORDS_WRITE_FAILED,
      `Failed to write agent records: ${message}`,
      {
        details: { recordType: record?.type },
      },
    ),
  };
}
