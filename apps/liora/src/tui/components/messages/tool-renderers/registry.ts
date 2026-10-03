/**
 * Tool result renderer registry.
 *
 * Each tool name maps to a `ResultRenderer` that turns the tool's
 * `ToolResultBlockData` into renderable Components. Tools without an
 * explicit entry fall through to `renderTruncated` (the original
 * 3-line + ctrl+o behavior).
 *
 * Keep this dispatch flat — tool names live next to the renderer they
 * choose, so adding a new tool means appending one case.
 */

import { formatShellCommandPreview } from '#/tui/components/media/code-highlight';
import { Text } from '#/tui/renderer';

import { renderTruncated } from './truncated';
import type { ResultRenderer } from './types';
import { strArg } from './types';

/**
 * True when a tool has no dedicated renderer and falls back to the generic
 * truncated output for unknown historical calls. Bash and SessionControl
 * are the known runtime surface.
 */
export function isGenericToolResult(toolName: string): boolean {
  return toolName !== 'Bash' && toolName !== 'SessionControl';
}

/**
 * Bash result renderer: syntax-highlighted command + pretty-printed body.
 * Preserves command visibility after result arrival (collapsed and expanded).
 */
const bashResultSummary: ResultRenderer = (toolCall, result, ctx) => {
  const components = [];
  const command = strArg(toolCall.args, 'command');
  if (command) {
    // Same `$ ` prompt + tokenizer as the live shell card (binary / flags /
    // strings / redirects) instead of a single dim line.
    for (const line of formatShellCommandPreview(command)) {
      components.push(new Text(line, 0, 0));
    }
  }
  // TruncatedOutput runs formatTranscriptOutput (JSON / logs / stack / …).
  components.push(...renderTruncated(toolCall, result, ctx));
  return components;
};

export function pickResultRenderer(toolName: string): ResultRenderer {
  return toolName === 'Bash' ? bashResultSummary : renderTruncated;
}

export type { ResultRenderer } from './types';
