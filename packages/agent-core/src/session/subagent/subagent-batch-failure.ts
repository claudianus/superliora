import { isTransientProviderError } from '@superliora/kosong';

import { isSubagentMaxTokensError } from './subagent-errors';
import type { SubagentResult } from './subagent-batch-types';

/** Classify an observed terminal failure; classification never triggers a retry. */
export function classifySubagentFailureReason(
  error: unknown,
  status: SubagentResult['status'],
): SubagentResult['failureReason'] {
  if (status === 'aborted') return 'aborted';
  if (isSubagentMaxTokensError(error)) return 'max_tokens';
  if (isTransientProviderError(error)) return 'transient';
  return 'other';
}
