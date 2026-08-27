/**
 * Map Cursor Connect / HTTP errors onto kosong's ChatProviderError hierarchy
 * so the TUI and retry layer see auth, quota, timeout, and connection the
 * same way they do for other providers.
 */

import {
  APIConnectionError,
  APIProviderRateLimitError,
  APIStatusError,
  APITimeoutError,
  ChatProviderError,
  classifyBaseApiError,
  isContextOverflowStatusError,
  APIContextOverflowError,
} from '#/errors';

import { invalidateCursorAgentOriginCache } from './agent-url';

const HTTP_STATUS_RE = /\bHTTP\s+(\d{3})\b/i;
const CONNECT_CODE_RE = /\b(?:code|error)["'\s:=]+([a-z_]+)/i;

const CONNECT_CODE_STATUS: Readonly<Record<string, number>> = {
  canceled: 499,
  unknown: 500,
  invalid_argument: 400,
  deadline_exceeded: 504,
  not_found: 404,
  already_exists: 409,
  permission_denied: 403,
  resource_exhausted: 429,
  failed_precondition: 400,
  aborted: 409,
  out_of_range: 400,
  unimplemented: 501,
  internal: 500,
  unavailable: 503,
  data_loss: 500,
  unauthenticated: 401,
};

const REGION_ERROR_RE = /region is not available|wrong region|this region/i;
const BAD_MODEL_RE = /error_bad_model_name|bad_model_name/i;
const VERSION_ERROR_RE = /outdated|client version|upgrade your|update required/i;

export function isCursorRegionRoutingError(message: string): boolean {
  return REGION_ERROR_RE.test(message);
}

export function isCursorBadModelError(message: string): boolean {
  return BAD_MODEL_RE.test(message);
}

export function isCursorClientVersionError(message: string): boolean {
  return VERSION_ERROR_RE.test(message);
}

function statusFromConnectCode(message: string): number | undefined {
  const match = CONNECT_CODE_RE.exec(message);
  const code = match?.[1]?.toLowerCase();
  if (code === undefined) return undefined;
  return CONNECT_CODE_STATUS[code];
}

function httpStatusFromMessage(message: string): number | undefined {
  const match = HTTP_STATUS_RE.exec(message);
  if (match?.[1] === undefined) return undefined;
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : undefined;
}

function rewriteCursorMessage(message: string): string {
  if (isCursorBadModelError(message)) {
    return `Cursor rejected this model id (ERROR_BAD_MODEL_NAME). Pick a catalog id from /login Cursor, or Auto. ${message}`;
  }
  if (isCursorClientVersionError(message)) {
    return `Cursor rejected this client version. Set SUPERLIORA_CURSOR_CLIENT_VERSION to a current Cursor CLI build. ${message}`;
  }
  if (isCursorRegionRoutingError(message)) {
    return `Cursor routed this account to a different agent region. Retrying with a fresh GetServerConfig lookup. ${message}`;
  }
  if (/no exec result/i.test(message)) {
    return `Cursor closed the Run while a client tool was still pending (No exec result). ${message}`;
  }
  return message;
}

/** Convert a raw Cursor transport / Connect error into a typed provider error. */
export function convertCursorError(error: unknown): ChatProviderError {
  if (error instanceof ChatProviderError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  if (isCursorRegionRoutingError(raw)) {
    invalidateCursorAgentOriginCache();
  }
  const message = rewriteCursorMessage(raw);
  const status = httpStatusFromMessage(raw) ?? statusFromConnectCode(raw);

  if (status === 429) return new APIProviderRateLimitError(message);
  if (status === 401 || status === 403) return new APIStatusError(status, message);
  if (status !== undefined && isContextOverflowStatusError(status, message)) {
    return new APIContextOverflowError(status, message);
  }
  if (status === 464) {
    return new APIConnectionError(
      `Cursor rejected the HTTP protocol (464). AgentService/Run requires HTTP/2. ${message}`,
    );
  }
  if (status !== undefined && status >= 400) return new APIStatusError(status, message);

  if (/timed out|went idle|deadline/i.test(raw)) return new APITimeoutError(message);
  if (
    /premature close|econnreset|enotfound|socket hang up|nghttp2|closed the stream/i.test(raw)
  ) {
    return new APIConnectionError(message);
  }
  return classifyBaseApiError(message);
}
