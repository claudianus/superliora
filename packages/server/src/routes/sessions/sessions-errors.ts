import {
  ErrorCodes,
  LioraError,
  SessionNotFoundError,
  SessionUndoUnavailableError,
  WorkspaceNotFoundError,
} from '@superliora/agent-core';
import { ErrorCode } from '@superliora/protocol';

import { errEnvelope } from '../../envelope';

export function sendMappedError(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  err: unknown,
): void {
  if (err instanceof SessionNotFoundError) {
    reply.send(errEnvelope(ErrorCode.SESSION_NOT_FOUND, err.message, requestId));
    return;
  }
  if (err instanceof WorkspaceNotFoundError) {
    reply.send(errEnvelope(ErrorCode.WORKSPACE_NOT_FOUND, err.message, requestId));
    return;
  }
  if (isForkActiveTurnError(err)) {
    reply.send(errEnvelope(ErrorCode.SESSION_BUSY, formatErrorMessage(err), requestId));
    return;
  }
  if (err instanceof LioraError && err.code === ErrorCodes.COMPACTION_UNABLE) {
    reply.send(errEnvelope(ErrorCode.COMPACTION_UNABLE, err.message, requestId));
    return;
  }
  if (err instanceof SessionUndoUnavailableError) {
    reply.send(errEnvelope(ErrorCode.SESSION_UNDO_UNAVAILABLE, err.message, requestId));
    return;
  }

  throw err;
}


function isForkActiveTurnError(err: unknown): boolean {
  if (err instanceof LioraError && err.code === ErrorCodes.SESSION_FORK_ACTIVE_TURN) {
    return true;
  }
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { readonly code?: unknown }).code === ErrorCodes.SESSION_FORK_ACTIVE_TURN
  );
}

function formatErrorMessage(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { readonly message?: unknown }).message === 'string'
  ) {
    return (err as { readonly message: string }).message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function buildValidationEnvelope(
  details: { path: string; message: string }[],
  requestId: string,
): {
  code: number;
  msg: string;
  data: null;
  request_id: string;
  details: { path: string; message: string }[];
} {
  const first = details[0];
  const msg = first === undefined
    ? 'validation failed'
    : first.path === ''
      ? first.message
      : `${first.path}: ${first.message}`;
  return {
    code: ErrorCode.VALIDATION_FAILED,
    msg,
    data: null,
    request_id: requestId,
    details,
  };
}
