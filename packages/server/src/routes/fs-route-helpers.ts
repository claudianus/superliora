import {
  FsAlreadyExistsError,
  FsGitUnavailableError,
  FsGrepTimeoutError,
  FsIsBinaryError,
  FsIsDirectoryError,
  FsPathEscapesError,
  FsPathNotFoundError,
  FsTooLargeError,
  FsTooManyResultsError,
  SessionNotFoundError,
} from '@superliora/agent-core';
import { ErrorCode } from '@superliora/protocol';

import { errEnvelope } from '../envelope';

export function sendMappedError(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  err: unknown,
): void {
  if (err instanceof FsPathEscapesError) {
    reply.send(errEnvelope(ErrorCode.FS_PATH_ESCAPES_SESSION, err.message, requestId));
    return;
  }
  if (err instanceof FsPathNotFoundError) {
    reply.send(errEnvelope(ErrorCode.FS_PATH_NOT_FOUND, err.message, requestId));
    return;
  }
  if (err instanceof FsIsDirectoryError) {
    reply.send(errEnvelope(ErrorCode.FS_IS_DIRECTORY, err.message, requestId));
    return;
  }
  if (err instanceof FsAlreadyExistsError) {
    reply.send(errEnvelope(ErrorCode.FS_ALREADY_EXISTS, err.message, requestId));
    return;
  }
  if (err instanceof FsIsBinaryError) {
    reply.send(errEnvelope(ErrorCode.FS_IS_BINARY, err.message, requestId));
    return;
  }
  if (err instanceof FsTooLargeError) {
    reply.send(errEnvelope(ErrorCode.FS_TOO_LARGE, err.message, requestId));
    return;
  }
  if (err instanceof FsTooManyResultsError) {
    reply.send(errEnvelope(ErrorCode.FS_TOO_MANY_RESULTS, err.message, requestId));
    return;
  }
  if (err instanceof FsGrepTimeoutError) {
    reply.send(errEnvelope(ErrorCode.FS_GREP_TIMEOUT, err.message, requestId));
    return;
  }
  if (err instanceof FsGitUnavailableError) {
    reply.send(errEnvelope(ErrorCode.FS_GIT_UNAVAILABLE, err.message, requestId));
    return;
  }
  if (err instanceof SessionNotFoundError) {
    reply.send(errEnvelope(ErrorCode.SESSION_NOT_FOUND, err.message, requestId));
    return;
  }
  throw err;
}

export function buildValidationEnvelope(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  requestId: string,
): {
  code: number;
  msg: string;
  data: null;
  request_id: string;
  details: { path: string; message: string }[];
} {
  const details = issues.map((i) => ({
    path: i.path.map((p) => String(p)).join('.'),
    message: i.message,
  }));
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

export function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function parseRangeHeader(
  raw: string | undefined,
  size: number,
): { start: number; end: number; length: number } | null {
  if (raw === undefined) return null;
  if (!raw.startsWith('bytes=')) return null;
  const spec = raw.slice('bytes='.length);
  if (spec.includes(',')) return null;
  const dash = spec.indexOf('-');
  if (dash < 0) return null;
  const leftRaw = spec.slice(0, dash);
  const rightRaw = spec.slice(dash + 1);
  if (leftRaw === '' && rightRaw === '') return null;
  let start: number;
  let end: number;
  if (leftRaw === '') {

    const suffix = Number.parseInt(rightRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    const a = Number.parseInt(leftRaw, 10);
    if (!Number.isFinite(a) || a < 0) return null;
    start = a;
    if (rightRaw === '') {
      end = size - 1;
    } else {
      const b = Number.parseInt(rightRaw, 10);
      if (!Number.isFinite(b) || b < a) return null;
      end = Math.min(b, size - 1);
    }
  }
  if (start >= size || start > end) return null;
  return { start, end, length: end - start + 1 };
}

export function sanitizeFilename(rel: string): string {
  const segs = rel.split('/');
  const base = segs[segs.length - 1] ?? rel;
  return base.replace(/"/g, '\\"');
}
