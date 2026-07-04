import type { LioraErrorCode } from './codes';

export interface LioraErrorOptions {
  /** JSON-serializable structured details. */
  readonly details?: Record<string, unknown>;
  /** Original error or value. Local-only; never serialized to the wire. */
  readonly cause?: unknown;
}

/**
 * The single Kimi error class.
 *
 * Discrimination is always by `code`. Cross-process consumers receive
 * `LioraErrorPayload` and must branch on `code` rather than class identity.
 */
export class LioraError extends Error {
  readonly code: LioraErrorCode;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(code: LioraErrorCode, message: string, options: LioraErrorOptions = {}) {
    super(message);
    this.name = 'LioraError';
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
  }
}
