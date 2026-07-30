/**
 * Shared helpers for TUI render-stability assertions.
 *
 * The renderer diffs frames line-by-line; panels that return byte-identical
 * lines while their state is unchanged let that diff skip them during
 * ambient ticks. These helpers standardise the ad-hoc "settle the clock,
 * render twice, compare" pattern previously duplicated across tests.
 */
import { expect } from 'vitest';

import {
  advanceAppearanceAnimationClock,
  appearanceAnimationNow,
} from '#/tui/features/appearance/appearance-effects';

const SGR_SEQUENCE = /\u001B\[[0-9;]*m/g;

/** Strip SGR (colour/style) escape sequences so frame text can be compared. */
export function stripAnsi(text: string): string {
  return text.replaceAll(SGR_SEQUENCE, '');
}

/**
 * Advance the appearance animation clock past every settle window (change
 * flashes, enter beats, fill animations) so the next render is no longer
 * time-driven. Mirrors the manual clock advance tests used before settling.
 */
export function settleAppearanceClock(): void {
  advanceAppearanceAnimationClock(appearanceAnimationNow() + 10_000);
}

export interface AssertSettledFrameStableOptions {
  /** Terminal width used for both renders. Defaults to 80. */
  readonly width?: number;
  /** Settles time-driven state before rendering. Defaults to settleAppearanceClock. */
  readonly settle?: () => void;
}

/**
 * Settle, then render twice at the same width and assert the second call
 * returns the identical array reference (memoized) and identical stripped
 * content. Returns the settled frame so callers can keep their own
 * assertions on the rendered lines.
 */
export function assertSettledFrameStable(
  render: (width: number) => string[],
  options: AssertSettledFrameStableOptions = {},
): string[] {
  const width = options.width ?? 80;
  const settle = options.settle ?? settleAppearanceClock;
  settle();
  const first = render(width);
  const second = render(width);
  const message = frameStabilityMessage(first, second);

  expect(second, message).toBe(first);
  expect(second.map(stripAnsi), message).toEqual(first.map(stripAnsi));
  return second;
}

function frameStabilityMessage(first: string[], second: string[]): string {
  const firstLines = first.map(stripAnsi);
  const secondLines = second.map(stripAnsi);
  const lineCount = Math.max(firstLines.length, secondLines.length);
  for (let index = 0; index < lineCount; index += 1) {
    const before = firstLines[index];
    const after = secondLines[index];
    if (before !== after) {
      return [
        'Settled frame changed between consecutive renders at the same width.',
        `First differing line ${index}:`,
        `  - first:  ${JSON.stringify(before ?? '<missing>')}`,
        `  + second: ${JSON.stringify(after ?? '<missing>')}`,
      ].join('\n');
    }
  }
  return (
    'Settled frame content is identical, but the second render returned a new array reference. ' +
    'Memoize unchanged renders so the renderer line diff can skip this panel during ambient ticks.'
  );
}
