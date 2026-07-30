import type { ContentPart } from '@superliora/kosong';

import type { ExecutableToolResult } from './types';

const TOOL_OUTPUT_EMPTY = 'Tool output is empty.';
const TOOL_OUTPUT_NON_TEXT = 'Tool returned non-text content.';

function isMediaContentPart(part: ContentPart): boolean {
  return part.type === 'image_url' || part.type === 'audio_url' || part.type === 'video_url';
}

/**
 * Validate a tool's raw return against the {@link ExecutableToolResult} contract.
 * A tool that returns `undefined`, a primitive, or an object without a valid
 * `output` field is coerced into an `isError: true` result so the loop can still
 * emit a paired `tool.result` event. This is the trust boundary between
 * arbitrary tool implementations and the rest of the loop.
 */
export function coerceToolResult(value: unknown, toolName: string): ExecutableToolResult {
  if (value === null || value === undefined) {
    return { output: `Tool "${toolName}" returned no result.`, isError: true };
  }
  if (typeof value !== 'object') {
    return {
      output: `Tool "${toolName}" returned a ${typeof value} instead of a tool result.`,
      isError: true,
    };
  }
  const candidate = value as { output?: unknown };
  if (typeof candidate.output !== 'string' && !Array.isArray(candidate.output)) {
    return {
      output: `Tool "${toolName}" returned a result with a missing or malformed "output" field.`,
      isError: true,
    };
  }
  return value as ExecutableToolResult;
}

export function normalizeToolResult(r: ExecutableToolResult): ExecutableToolResult {
  let output: ExecutableToolResult['output'];
  if (typeof r.output === 'string') {
    output = r.output.length > 0 ? r.output : TOOL_OUTPUT_EMPTY;
  } else if (r.output.length === 0) {
    output = TOOL_OUTPUT_EMPTY;
  } else {
    const hasMediaBlock = r.output.some(isMediaContentPart);
    if (hasMediaBlock) {
      const hasNonEmptyText = r.output.some((c) => c.type === 'text' && c.text.length > 0);
      output = hasNonEmptyText
        ? r.output
        : [{ type: 'text', text: TOOL_OUTPUT_NON_TEXT }, ...r.output];
    } else {
      const textJoined = r.output
        .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
        .map((c) => c.text)
        .join('');
      output = textJoined.length > 0 ? textJoined : TOOL_OUTPUT_EMPTY;
    }
  }
  if (r.isError === true) {
    return r.truncated === true
      ? { output, isError: true, truncated: true }
      : { output, isError: true };
  }
  return r.truncated === true ? { output, truncated: true } : { output };
}
