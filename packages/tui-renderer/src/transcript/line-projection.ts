import { truncateAnsiDisplayText, wrapAnsiDisplayText } from '../text/component';
import type {
  RendererLinePreviewOptions,
  RendererLinePreviewProjection,
  RendererLineWindowOptions,
  RendererLineWindowProjection,
  RendererNonEmptyLineWindowOptions,
  RendererNonEmptyLineWindowProjection,
  RendererWrappedTextPreviewOptions,
  RendererWrappedTextPreviewProjection,
} from './types';
import {
  normalizeOptionalPreviewLineCount,
  normalizePreviewLineCount,
  normalizeTranscriptWidth,
} from './normalize';

export function projectRendererLinePreview(
  options: RendererLinePreviewOptions,
): RendererLinePreviewProjection {
  // Large measure-mode stubs from `measurePlaceholderLines` are not real
  // arrays — they only carry `.length`. Handle them by length alone so
  // `lines.slice is not a function` never crashes geometry probes.
  if (!Array.isArray(options.lines)) {
    const n =
      typeof (options.lines as unknown as { length?: unknown }).length === 'number'
        ? Math.max(0, (options.lines as unknown as { length: number }).length)
        : 0;
    const maxLines = normalizePreviewLineCount(options.maxLines);
    if (options.expanded === true || n <= maxLines) {
      return { lines: options.lines, hiddenLineCount: 0 };
    }
    const hiddenLineCount = n - maxLines;
    const windowLines = { length: maxLines } as unknown as readonly string[];
    if (options.tail === true) {
      return { lines: windowLines, hiddenLineCount, hintPosition: 'before' };
    }
    return { lines: windowLines, hiddenLineCount, hintPosition: 'after' };
  }
  const maxLines = normalizePreviewLineCount(options.maxLines);
  if (options.expanded === true || options.lines.length <= maxLines) {
    return { lines: options.lines, hiddenLineCount: 0 };
  }

  const hiddenLineCount = options.lines.length - maxLines;
  if (options.tail === true) {
    return {
      lines: options.lines.slice(options.lines.length - maxLines),
      hiddenLineCount,
      hintPosition: 'before',
    };
  }

  return {
    lines: options.lines.slice(0, maxLines),
    hiddenLineCount,
    hintPosition: 'after',
  };
}

export function projectRendererLineWindow<TLine = string>(
  options: RendererLineWindowOptions<TLine>,
): RendererLineWindowProjection<TLine> {
  // Large measure-mode stubs from `measurePlaceholderLines` are not real
  // arrays — they only carry `.length`. Handle them by length alone so
  // `lines.slice is not a function` never crashes geometry probes.
  if (!Array.isArray(options.lines)) {
    const n =
      typeof (options.lines as unknown as { length?: unknown }).length === 'number'
        ? Math.max(0, (options.lines as unknown as { length: number }).length)
        : 0;
    const maxLines = normalizeOptionalPreviewLineCount(options.maxLines);
    if (maxLines === undefined || n <= maxLines) {
      return {
        lines: options.lines,
        hiddenLineCount: 0,
        startIndex: 0,
        endIndex: n,
        anchor: 'all',
      };
    }
    if (maxLines <= 0) {
      const index = options.tail === true ? n : 0;
      return {
        lines: [] as unknown as readonly TLine[],
        hiddenLineCount: n,
        startIndex: index,
        endIndex: index,
        anchor: options.tail === true ? 'tail' : 'head',
      };
    }
    if (options.tail === true) {
      const startIndex = Math.max(0, n - maxLines);
      const windowLines = { length: maxLines } as unknown as readonly TLine[];
      return {
        lines: windowLines,
        hiddenLineCount: startIndex,
        startIndex,
        endIndex: n,
        anchor: 'tail',
      };
    }
    const windowLines = { length: maxLines } as unknown as readonly TLine[];
    return {
      lines: windowLines,
      hiddenLineCount: n - maxLines,
      startIndex: 0,
      endIndex: maxLines,
      anchor: 'head',
    };
  }
  const maxLines = normalizeOptionalPreviewLineCount(options.maxLines);
  if (maxLines === undefined || options.lines.length <= maxLines) {
    return {
      lines: options.lines,
      hiddenLineCount: 0,
      startIndex: 0,
      endIndex: options.lines.length,
      anchor: 'all',
    };
  }

  if (maxLines <= 0) {
    const index = options.tail === true ? options.lines.length : 0;
    return {
      lines: [],
      hiddenLineCount: options.lines.length,
      startIndex: index,
      endIndex: index,
      anchor: options.tail === true ? 'tail' : 'head',
    };
  }

  if (options.tail === true) {
    const startIndex = Math.max(0, options.lines.length - maxLines);
    return {
      lines: options.lines.slice(startIndex),
      hiddenLineCount: startIndex,
      startIndex,
      endIndex: options.lines.length,
      anchor: 'tail',
    };
  }

  return {
    lines: options.lines.slice(0, maxLines),
    hiddenLineCount: options.lines.length - maxLines,
    startIndex: 0,
    endIndex: maxLines,
    anchor: 'head',
  };
}

export function projectRendererNonEmptyLineWindow(
  options: RendererNonEmptyLineWindowOptions,
): RendererNonEmptyLineWindowProjection {
  const lines =
    options.text.length === 0
      ? []
      : options.text
          .split('\n')
          .map((line) => options.trimEnd === false ? line : line.trimEnd())
          .filter((line) => line.trim().length > 0);
  const window = projectRendererLineWindow({
    lines,
    maxLines: options.maxLines,
    tail: options.tail,
  });
  return {
    ...window,
    totalLineCount: lines.length,
  };
}

export function projectRendererWrappedTextPreview(
  options: RendererWrappedTextPreviewOptions,
): RendererWrappedTextPreviewProjection {
  const width = normalizeTranscriptWidth(options.width);
  if (width <= 0) {
    return {
      lines: [''],
      hiddenLineCount: 0,
      startIndex: 0,
      endIndex: 1,
      anchor: 'all',
      wrappedLineCount: 1,
    };
  }

  const text =
    options.normalizeWhitespace === true
      ? options.text.replaceAll(/\s+/g, ' ').trim()
      : options.text;
  const wrapped = wrapAnsiDisplayText(text, width);
  const lines = wrapped.length > 0 ? wrapped : [''];
  const window = projectRendererLineWindow({
    lines,
    maxLines: options.maxLines,
    tail: options.tail,
  });
  const projected = [...window.lines];

  if (window.hiddenLineCount > 0 && options.tail !== true && projected.length > 0) {
    const truncateMark = options.truncateMark ?? '…';
    const lastIndex = projected.length - 1;
    projected[lastIndex] = truncateAnsiDisplayText(
      `${projected[lastIndex] ?? ''}${truncateMark}`,
      width,
      truncateMark,
    );
  }

  return {
    ...window,
    lines: projected,
    wrappedLineCount: lines.length,
  };
}
