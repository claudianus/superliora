import {
  RendererTruncatedOutputComponent,
  trimRendererTrailingEmptyLines,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { formatTranscriptOutput } from '#/tui/utils/transcript/transcript-output-format';

import type { ResultRenderer } from './types';
import { PREVIEW_LINES } from './types';

const DEFAULT_INDENT = 2;

export const trimTrailingEmptyLines = trimRendererTrailingEmptyLines;

/**
 * Component that renders tool output with wrap-aware line truncation.
 * Uses the renderer Text component to compute actual visual wrapped lines,
 * then caps at PREVIEW_LINES. This handles long single-line output (e.g.
 * JSON blobs) that would otherwise wrap to dozens of visual rows.
 *
 * Body text is pretty-printed + lightly highlighted via
 * {@link formatTranscriptOutput} (JSON, JSONL, diff, stack, logs, URLs…).
 */
export class TruncatedOutputComponent extends RendererTruncatedOutputComponent {
  constructor(
    output: string,
    options: {
      expanded: boolean;
      isError: boolean | undefined;
      maxLines?: number;
      indent?: number;
      // When false, the truncation footer omits the "ctrl+o to expand" promise
      // (for contexts whose output is fixed-truncated and never expands).
      expandHint?: boolean;
      // When true, collapsed rendering keeps the latest visual rows instead of
      // the first rows. This is useful for live output from a running command.
      tail?: boolean;
      // Footer wording. Defaults to 'scroll': every app usage lives inside the
      // transcript viewport, where scrolling back auto-expands truncated blocks
      // (scroll reveal), so the hint promises the gesture that actually works
      // there. 'key' restores the legacy ctrl+o wording.
      hintMode?: 'key' | 'scroll';
      /** Prefer this language when the body looks like a code dump. */
      languageHint?: string;
      /** File path used to derive a language when languageHint is absent. */
      pathHint?: string;
    },
  ) {
    super(output, {
      expanded: options.expanded,
      isError: options.isError,
      maxLines: options.maxLines ?? PREVIEW_LINES,
      indent: options.indent ?? DEFAULT_INDENT,
      expandHint: options.expandHint,
      tail: options.tail,
      hintMode: options.hintMode ?? 'scroll',
      formatText: (text, context) =>
        formatTranscriptOutput(text, {
          isError: context.isError,
          languageHint: options.languageHint,
          pathHint: options.pathHint,
          mode: 'tool',
        }),
      formatHint: (hint) => currentTheme.dim(hint),
    });
  }
}

export const renderTruncated: ResultRenderer = (toolCall, result, ctx) => {
  if (!result.output) return [];
  // Best-effort path hint for generic tools (MCP, unknown builtins).
  const pathHint =
    typeof toolCall.args['path'] === 'string'
      ? toolCall.args['path']
      : typeof toolCall.args['file_path'] === 'string'
        ? toolCall.args['file_path']
        : typeof toolCall.args['filePath'] === 'string'
          ? toolCall.args['filePath']
          : undefined;
  return [
    new TruncatedOutputComponent(result.output, {
      expanded: ctx.expanded,
      isError: result.is_error ?? false,
      hintMode: 'key',
      pathHint,
    }),
  ];
};
