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
    const message = sanitizeStatusErrorMessage(error.message);
    const permanentQuota = isPermanentQuotaOrBillingMessage(message);
    const looksLikeRateLimit =
      !permanentQuota &&
      (error.statusCode === 429 || isQuotaOrRateLimitMessage(message));

    let resolvedCode: LioraErrorCode;
    if (error.statusCode === 401) {
      resolvedCode = ErrorCodes.PROVIDER_AUTH_ERROR;
    } else if (permanentQuota) {
      // Exhausted plan/credits/payment — surface as API error, never auto-retry.
      resolvedCode = ErrorCodes.PROVIDER_API_ERROR;
    } else if (looksLikeRateLimit) {
      resolvedCode = ErrorCodes.PROVIDER_RATE_LIMIT;
    } else if (error.statusCode === 429) {
      resolvedCode = ErrorCodes.PROVIDER_RATE_LIMIT;
    } else {
      resolvedCode = ErrorCodes.PROVIDER_API_ERROR;
    }

    const retryable =
      permanentQuota
        ? false
        : resolvedCode === ErrorCodes.PROVIDER_RATE_LIMIT
          ? true
          : resolvedCode === ErrorCodes.PROVIDER_API_ERROR && error.statusCode >= 500
            ? true
            : KIMI_ERROR_INFO[resolvedCode].retryable;
    return {
      code: resolvedCode,
      message,
      name: error.name,
      details: {
        statusCode: error.statusCode,
        requestId: error.requestId,
        ...(permanentQuota ? { permanentQuota: true } : {}),
      },
      retryable,
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
      // Empty responses are almost always transient stream glitches.
      retryable: true,
    };
  }

  if (error instanceof ChatProviderError) {
    const message = error.message;
    const permanentQuota = isPermanentQuotaOrBillingMessage(message);
    const looksLikeRateLimit = !permanentQuota && isQuotaOrRateLimitMessage(message);
    return {
      code: permanentQuota
        ? ErrorCodes.PROVIDER_API_ERROR
        : looksLikeRateLimit
          ? ErrorCodes.PROVIDER_RATE_LIMIT
          : ErrorCodes.PROVIDER_API_ERROR,
      message,
      name: error.name,
      details: permanentQuota ? { permanentQuota: true } : undefined,
      retryable: permanentQuota
        ? false
        : looksLikeRateLimit
          ? true
          : KIMI_ERROR_INFO[ErrorCodes.PROVIDER_API_ERROR].retryable,
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
 * Permanent quota / billing exhaustion. Waiting will not help until the user
 * tops up, changes plan, or the billing window resets — never auto-retry these.
 */
const PERMANENT_QUOTA_OR_BILLING_MESSAGE_PATTERNS = [
  /insufficient[_\s-]?quota/i,
  /quota\s+exceed/i,
  /exceed(?:ed|s|ing)?\s+(?:your\s+)?(?:current\s+)?quota/i,
  /credit[_\s-]?balance[_\s-]?too[_\s-]?low/i,
  /credit balance is too low/i,
  /insufficient.*(?:credit|balance|funds|quota)/i,
  /(?:credit|credits).*(?:exhausted|depleted|expired|limit|spent)/i,
  /(?:no|zero)\s+(?:credit|credits)\s+(?:remaining|left|available)/i,
  /usage.*limit.*(?:reached|exceed)/i,
  /spend.*limit.*(?:reached|exceed)/i,
  /billing.*(?:limit|quota|credit|payment)/i,
  /monthly.*(?:budget|spend).*limit/i,
  /hard[_\s-]?limit/i,
  /no\s+payment\s+method/i,
  /add\s+a\s+payment\s+method/i,
  /payment\s+required/i,
  /payment\s+method/i,
] as const;

/** Transient throttling — short waits / failover can recover. */
const TRANSIENT_RATE_LIMIT_MESSAGE_PATTERNS = [
  /rate[_\s-]?limit/i,
  /too many requests/i,
  /provider\.rate_limit/i,
] as const;

export function isPermanentQuotaOrBillingMessage(message: string | undefined): boolean {
  if (message === undefined || message.trim().length === 0) return false;
  return PERMANENT_QUOTA_OR_BILLING_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

export function isQuotaOrRateLimitMessage(message: string): boolean {
  return (
    isPermanentQuotaOrBillingMessage(message) ||
    TRANSIENT_RATE_LIMIT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
  );
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
