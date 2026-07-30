import { isTransientProviderError } from '@superliora/kosong';

import { isSubagentMaxTokensError } from './subagent-host';
import type { SubagentResult } from './subagent-batch-types';

/**
 * Map a thrown subagent error to a structured `failureReason` for recovery
 * prompts. `max_tokens` is terminal (a retry with the same context window
 * will not help) and should steer the user toward a larger context budget
 * rather than a transient retry. Exported so tests can pin the
 * classification order without spinning up a full batch mock.
 */
export function classifySubagentFailureReason(
  error: unknown,
  status: SubagentResult['status'],
): SubagentResult['failureReason'] {
  if (status === 'aborted') return 'aborted';
  if (isSubagentMaxTokensError(error)) return 'max_tokens';
  if (isTransientProviderError(error)) return 'transient';
  return 'other';
}
