import {
  APIConnectionError,
  APITimeoutError,
  ChatProviderError,
  normalizeAPIStatusError,
} from '#/errors';
import { ApiError as GoogleApiError } from '@google/genai';

const NETWORK_RE = /network|connection|connect|disconnect|fetch failed/i;
const TIMEOUT_RE = /timed?\s*out|timeout|deadline/i;

/**
 * Convert a Google GenAI SDK error (or raw Error) to a kosong `ChatProviderError`.
 */
export function convertGoogleGenAIError(error: unknown): ChatProviderError {
  // Google SDK's exported ApiError carries an HTTP status code
  if (error instanceof GoogleApiError) {
    return normalizeAPIStatusError(error.status, error.message);
  }
  if (error instanceof Error) {
    const msg = error.message;
    // Timeout takes priority over network (a timeout is also a connection issue)
    if (TIMEOUT_RE.test(msg)) {
      return new APITimeoutError(msg);
    }
    // Network / fetch errors (e.g. TypeError: fetch failed)
    if (NETWORK_RE.test(msg) || (error instanceof TypeError && msg.includes('fetch'))) {
      return new APIConnectionError(msg);
    }
    // Try to extract status code from unknown error shapes
    const statusCode = (error as { code?: number }).code;
    if (typeof statusCode === 'number') {
      return normalizeAPIStatusError(statusCode, msg);
    }
    return new ChatProviderError(`GoogleGenAI error: ${msg}`);
  }
  return new ChatProviderError(`GoogleGenAI error: ${String(error)}`);
}
