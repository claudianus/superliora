import type { FinishReason } from '#/provider';

/**
 * Normalize a Google GenAI (Gemini) `finishReason` value to the unified
 * {@link FinishReason} enum.
 *
 * Source: `candidates[0].finishReason` (works for both stream and
 * non-stream — the SDK normalizes them). Gemini does not emit a
 * `tool_calls`-style reason; tool calls come via `parts[].functionCall`
 * and `finishReason` stays `'completed'` even when the model produces
 * function calls.
 */
export function normalizeGoogleGenAIFinishReason(raw: unknown): {
  finishReason: FinishReason | null;
  rawFinishReason: string | null;
} {
  if (raw === null || raw === undefined) {
    return { finishReason: null, rawFinishReason: null };
  }
  // The SDK normally hands us a plain string but older builds wrap it in
  // an enum-like object. Accept both shapes and uppercase to match the
  // documented constants. Anything else collapses to "no signal" so we
  // never emit a junk `[object Object]` raw value.
  let rawString: string;
  if (typeof raw === 'string') {
    rawString = raw.toUpperCase();
  } else if (typeof raw === 'number' || typeof raw === 'bigint' || typeof raw === 'boolean') {
    rawString = String(raw).toUpperCase();
  } else {
    return { finishReason: null, rawFinishReason: null };
  }
  if (rawString === 'FINISH_REASON_UNSPECIFIED' || rawString === '') {
    return { finishReason: null, rawFinishReason: null };
  }
  switch (rawString) {
    case 'STOP':
      return { finishReason: 'completed', rawFinishReason: rawString };
    case 'MAX_TOKENS':
      return { finishReason: 'truncated', rawFinishReason: rawString };
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'IMAGE_SAFETY':
      return { finishReason: 'filtered', rawFinishReason: rawString };
    case 'MALFORMED_FUNCTION_CALL':
    case 'OTHER':
    case 'LANGUAGE':
      return { finishReason: 'other', rawFinishReason: rawString };
    default:
      return { finishReason: 'other', rawFinishReason: rawString };
  }
}
