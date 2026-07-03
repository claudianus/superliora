import {
  RendererTruncatedOutputComponent,
  trimRendererTrailingEmptyLines,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';

import type { ResultRenderer } from './types';
import { PREVIEW_LINES } from './types';

const DEFAULT_INDENT = 2;

export const trimTrailingEmptyLines = trimRendererTrailingEmptyLines;

/**
 * Component that renders tool output with wrap-aware line truncation.
 * Uses the renderer Text component to compute actual visual wrapped lines,
 * then caps at PREVIEW_LINES. This handles long single-line output (e.g.
 * JSON blobs) that would otherwise wrap to dozens of visual rows.
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
    },
  ) {
    super(output, {
      expanded: options.expanded,
      isError: options.isError,
      maxLines: options.maxLines ?? PREVIEW_LINES,
      indent: options.indent ?? DEFAULT_INDENT,
      expandHint: options.expandHint,
      tail: options.tail,
      formatText: (text, context) =>
        context.isError ? currentTheme.fg('error', text) : currentTheme.dim(text),
      formatHint: (hint) => currentTheme.dim(hint),
    });
  }
}

export const renderTruncated: ResultRenderer = (_toolCall, result, ctx) => {
  if (!result.output) return [];
  return [
    new TruncatedOutputComponent(result.output, {
      expanded: ctx.expanded,
      isError: result.is_error ?? false,
    }),
  ];
};
