import { truncateAnsiDisplayText, visibleWidth } from './text-component';
import type { RendererTranscriptContentWidthOptions, RendererTranscriptLineBlockOptions } from './transcript-types';
import {
  normalizeMinContentWidth,
  normalizeTranscriptWidth,
} from './transcript-normalize';

export function trimRendererTrailingEmptyLines(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1];
    if (line === undefined || line.length > 0) break;
    end--;
  }
  return lines.slice(0, end);
}

export function measureRendererTranscriptContentWidth(
  options: RendererTranscriptContentWidthOptions,
): number {
  const width = normalizeTranscriptWidth(options.width);
  const minContentWidth = normalizeMinContentWidth(options.minContentWidth);
  if (width <= 0) return 0;
  return Math.max(minContentWidth, width - visibleWidth(options.prefix ?? ''));
}

export function renderRendererTranscriptLineBlock(
  options: RendererTranscriptLineBlockOptions,
): string[] {
  const width = normalizeTranscriptWidth(options.width);
  if (width <= 0) return [''];

  const prefix = options.prefix ?? '';
  const continuationPrefix = options.continuationPrefix ?? ' '.repeat(visibleWidth(prefix));
  const truncateMark = options.truncateMark ?? '...';
  const rendered: string[] = options.leadingBlank === true ? [''] : [];

  for (let i = 0; i < options.lines.length; i++) {
    const line = options.lines[i] ?? '';
    rendered.push((i === 0 ? prefix : continuationPrefix) + line);
  }

  return rendered.map((line, index) =>
    options.preserveLine?.(line, index) === true
      ? line
      : truncateAnsiDisplayText(line, width, truncateMark),
  );
}
