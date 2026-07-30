import { visibleWidth, wrapTextWithAnsi } from '#/tui/renderer';

/**
 * Push `content` to `lines`, wrapping it to fit `width` with a hanging
 * indent. The first physical line starts with `firstPrefix`; continuation
 * lines get `continuationPrefix`. Pass `tone` to wrap every emitted line
 * in a single ANSI span (cleaner for selection highlights and matches the
 * pre-wrap rendering tests expect); leave it undefined when the prefixes
 * already carry their own mixed styling.
 */
export function appendWrapped(
  lines: string[],
  firstPrefix: string,
  continuationPrefix: string,
  content: string,
  width: number,
  tone?: (s: string) => string,
): void {
  const prefixWidth = Math.max(visibleWidth(firstPrefix), visibleWidth(continuationPrefix));
  const contentWidth = Math.max(1, width - prefixWidth);
  const wrapped = wrapTextWithAnsi(content, contentWidth);
  const styleLine = tone ?? ((s: string) => s);
  if (wrapped.length === 0) {
    lines.push(styleLine(firstPrefix));
    return;
  }
  lines.push(styleLine(`${firstPrefix}${wrapped[0] ?? ''}`));
  for (let i = 1; i < wrapped.length; i++) {
    lines.push(styleLine(`${continuationPrefix}${wrapped[i] ?? ''}`));
  }
}
