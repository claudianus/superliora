import type { ContentPart } from '@superliora/kosong';

import type { ExecutableToolResult, LoopToolIntendEvent } from '../../loop';

export const TOOL_ERROR_STATUS = '<system>ERROR: Tool execution failed.</system>';
export const TOOL_EMPTY_STATUS = '<system>Tool output is empty.</system>';
export const TOOL_EMPTY_ERROR_STATUS =
  '<system>ERROR: Tool execution failed. Tool output is empty.</system>';
const TOOL_OUTPUT_EMPTY_TEXT = 'Tool output is empty.';
export const TOOL_INTERRUPTED_ON_RESUME_OUTPUT =
  'Tool execution was interrupted before its result was recorded. Do not assume the tool completed successfully.';

/**
 * Message synthesized on resume for a tool call that logged an intent but was
 * interrupted before its ack/result. Because a durable side effect may have
 * partially or fully applied, the model is told to verify before redoing the
 * work. For file writes, point it at the intended paths so it re-reads them.
 */
export function interruptedWithIntentMessage(intend: LoopToolIntendEvent): string {
  const paths = intend.writePaths;
  if (paths !== undefined && paths.length > 0) {
    const listed = paths.map((p) => `  - ${p}`).join('\n');
    return (
      `Tool "${intend.name}" was interrupted mid-execution after its side effect ` +
      `was started. The write to the following path(s) may have partially or fully applied:\n${listed}\n` +
      `Re-read the file(s) to check the current contents before retrying — the change may already be present.`
    );
  }
  return (
    `Tool "${intend.name}" was interrupted mid-execution after it was started. ` +
    `Its side effect may have partially or fully applied. Do not assume it either completed or did nothing — ` +
    `verify the resulting state before retrying.`
  );
}

export function toolResultOutputForModel(result: ExecutableToolResult): string | ContentPart[] {
  const output = result.output;
  if (typeof output === 'string') {
    if (result.isError === true) {
      if (output.length === 0) return TOOL_EMPTY_ERROR_STATUS;
      if (output.trimStart().startsWith('<system>ERROR:')) return output;
      return `${TOOL_ERROR_STATUS}\n${output}`;
    }
    return isEmptyOutputText(output) ? TOOL_EMPTY_STATUS : output;
  }

  if (isEmptyEquivalentContentArray(output)) {
    return [
      {
        type: 'text',
        text: result.isError === true ? TOOL_EMPTY_ERROR_STATUS : TOOL_EMPTY_STATUS,
      },
    ];
  }
  if (result.isError === true) {
    return [{ type: 'text', text: TOOL_ERROR_STATUS }, ...output];
  }
  return output;
}

function isEmptyEquivalentContentArray(output: readonly ContentPart[]): boolean {
  return output.every((part) => part.type === 'text' && part.text.trim().length === 0);
}

function isEmptyOutputText(output: string): boolean {
  return output.trim().length === 0 || output.trim() === TOOL_OUTPUT_EMPTY_TEXT;
}
