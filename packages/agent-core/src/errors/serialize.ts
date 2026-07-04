import {
  APIConnectionError,
  APIEmptyResponseError,
  APIStatusError,
  APITimeoutError,
  ChatProviderError,
} from '@superliora/kosong';

import { LioraError } from './classes';
import { ErrorCodes, KIMI_ERROR_INFO, type LioraErrorCode } from './codes';

/**
 * Wire-safe payload of a Kimi error.
 *
 * The structure passed across process / language boundaries (RPC, events,
 * telemetry, SDK wrappers). Class identity does not survive the boundary;
 * downstream code must branch on `code` rather than `instanceof`.
 *
 * `details` is JSON-serialized. `cause` is intentionally absent -- it is
 * local-only diagnostic state and must not cross the boundary.
 */
export interface LioraErrorPayload {
  readonly code: LioraErrorCode;
  readonly message: string;
  readonly name?: string;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
}

/** Type guard for LioraError. */
export function isKimiError(error: unknown): error is LioraError {
  return error instanceof LioraError;
}

/**
 * Build a LioraErrorPayload directly from a code + message (no Error instance
 * needed). Use this for synthetic error events that are signaled, not thrown
 * -- e.g. "turn busy" or "compaction failed". `retryable` is filled from
 * KIMI_ERROR_INFO so callers cannot drift out of sync with the registry.
 */
export function makeErrorPayload(
  code: LioraErrorCode,
  message: string,
  options?: { readonly details?: Record<string, unknown>; readonly name?: string },
): LioraErrorPayload {
  return {
    code,
    message,
    name: options?.name,
    details: options?.details,
    retryable: KIMI_ERROR_INFO[code].retryable,
  };
}

/**
 * Normalize any value into a LioraErrorPayload.
 *
 * Recognized errors:
 * - `LioraError`: passthrough.
 * - `APIStatusError`: 429 -> rate_limit, 401 -> auth_error, otherwise -> api_error.
 * - `APIConnectionError` / `APITimeoutError`: connection_error.
 * - `ChatProviderError`: api_error.
 *
 * Anything else collapses to `internal`. We never echo `cause` or stack on
 * the wire.
 */
export function toKimiErrorPayload(error: unknown): LioraErrorPayload {
  if (isKimiError(error)) {
    return {
      code: error.code,
      message: error.message,
      name: error.name,
      details: error.details,
      retryable: KIMI_ERROR_INFO[error.code].retryable,
    };
  }

  if (error instanceof APIStatusError) {
    const code: LioraErrorCode =
      error.statusCode === 429
        ? ErrorCodes.PROVIDER_RATE_LIMIT
        : error.statusCode === 401
          ? ErrorCodes.PROVIDER_AUTH_ERROR
          : ErrorCodes.PROVIDER_API_ERROR;
    return {
      code,
      message: sanitizeStatusErrorMessage(error.message),
      name: error.name,
      details: {
        statusCode: error.statusCode,
        requestId: error.requestId,
      },
      retryable: KIMI_ERROR_INFO[code].retryable,
    };
  }

  if (error instanceof APIConnectionError || error instanceof APITimeoutError) {
    return {
      code: ErrorCodes.PROVIDER_CONNECTION_ERROR,
      message: error.message,
      name: error.name,
      retryable: KIMI_ERROR_INFO[ErrorCodes.PROVIDER_CONNECTION_ERROR].retryable,
    };
  }

  if (error instanceof APIEmptyResponseError) {
    return {
      code: ErrorCodes.PROVIDER_API_ERROR,
      message: error.message,
      name: error.name,
      details: {
        finishReason: error.finishReason,
        rawFinishReason: error.rawFinishReason,
      },
      retryable: KIMI_ERROR_INFO[ErrorCodes.PROVIDER_API_ERROR].retryable,
    };
  }

  if (error instanceof ChatProviderError) {
    return {
      code: ErrorCodes.PROVIDER_API_ERROR,
      message: error.message,
      name: error.name,
      retryable: KIMI_ERROR_INFO[ErrorCodes.PROVIDER_API_ERROR].retryable,
    };
  }

  if (error instanceof Error) {
    return {
      code: ErrorCodes.INTERNAL,
      message: error.message,
      name: error.name,
      retryable: KIMI_ERROR_INFO[ErrorCodes.INTERNAL].retryable,
    };
  }

  return {
    code: ErrorCodes.INTERNAL,
    message: String(error),
    retryable: KIMI_ERROR_INFO[ErrorCodes.INTERNAL].retryable,
  };
}

/**
 * Provider status errors can carry an HTML error page instead of structured
 * JSON. Surface the page title when possible and strip carriage returns so
 * terminal renderers do not show the status line as blank.
 */
function sanitizeStatusErrorMessage(message: string): string {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(message);
  const title = titleMatch?.[1]?.trim();
  const normalized = title !== undefined && title.length > 0 ? title : message;
  return normalized.replaceAll('\r', '');
}

/**
 * Rehydrate a LioraErrorPayload into a LioraError. Used by SDK boundary code
 * receiving errors over RPC to re-surface them with a real class so
 * in-process consumers can still use `instanceof`.
 */
export function fromKimiErrorPayload(payload: LioraErrorPayload): LioraError {
  return new LioraError(payload.code, payload.message, {
    details: payload.details,
  });
}
