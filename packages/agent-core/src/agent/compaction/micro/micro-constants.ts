/**
 * Keep at most this many non-mutating tool results per tool name inside the
 * micro-clearable window; newer same-family results clear first so the
 * prompt-cache prefix (oldest bytes) stays stable.
 */
export const MICRO_TOOL_RESULT_FAMILY_KEEP = 3;
export const MICRO_TOOL_RESULT_FAMILY_KEEP_LOW_PRESSURE = 6;

/**
 * Never micro-clear tool results in the first N messages of the conversation.
 * Protects the long-lived prompt-cache prefix even under heavy family pressure.
 * Protected tail (recent turns) is separate — this is the *prefix* shield.
 */
export const MICRO_PREFIX_PROTECT_MESSAGES = 24;
