/**
 * Loop42a — surface same-step tool dedup in the TUI.
 *
 * When the model issues identical (tool,args) twice in one LLM step, agent-core
 * reuses the original result and appends `SAME_STEP_DEDUP:`. Without a notice
 * the operator only sees two green cards and may miss the skip.
 */

export const SAME_STEP_DEDUP_PREFIX = 'SAME_STEP_DEDUP:';

export type SameStepDedupNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'same-step-dedup';
};

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isSameStepDedupOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(SAME_STEP_DEDUP_PREFIX);
}

export function formatSameStepDedupNotice(toolName?: string): SameStepDedupNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: 'Same-step tool dedup',
    detail: `Identical ${tool} args already ran in this step (${SAME_STEP_DEDUP_PREFIX} attached). Prior result was reused — no second execution. Change args if you need a fresh call.`,
    status: `Same-step dedup on ${tool} (reused prior result)`,
    coalesceKey: 'same-step-dedup',
  };
}
