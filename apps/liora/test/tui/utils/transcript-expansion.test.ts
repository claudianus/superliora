import { describe, expect, it } from 'vitest';

import {
  nextScrollRevealState,
  transcriptRevealActive,
} from '#/tui/utils/transcript-expansion';

describe('nextScrollRevealState', () => {
  it('reveals on every upward gesture', () => {
    for (const action of ['line-up', 'page-up', 'top'] as const) {
      expect(
        nextScrollRevealState({
          action,
          changed: true,
          followOutput: false,
          offsetFromBottom: 12,
          previousReveal: false,
        }),
      ).toBe(true);
    }
  });

  it('reveals on a no-op wheel-up when the content fits the viewport', () => {
    // The transcript never overflows, so the viewport cannot move; the upward
    // intent alone must expand previews in place ("scroll to expand" promise).
    expect(
      nextScrollRevealState({
        action: 'line-up',
        changed: false,
        followOutput: true,
        offsetFromBottom: 0,
        previousReveal: false,
      }),
    ).toBe(true);
  });

  it('collapses on an explicit jump to bottom', () => {
    expect(
      nextScrollRevealState({
        action: 'bottom',
        changed: true,
        followOutput: true,
        offsetFromBottom: 0,
        previousReveal: true,
      }),
    ).toBe(false);
  });

  it('collapses on a down gesture while pinned to the tail', () => {
    expect(
      nextScrollRevealState({
        action: 'line-down',
        changed: false,
        followOutput: true,
        offsetFromBottom: 0,
        previousReveal: true,
      }),
    ).toBe(false);
  });

  it('keeps the reveal on down gestures mid-history', () => {
    expect(
      nextScrollRevealState({
        action: 'page-down',
        changed: true,
        followOutput: false,
        offsetFromBottom: 8,
        previousReveal: true,
      }),
    ).toBe(true);
  });
});

describe('transcriptRevealActive', () => {
  it('ORs the ctrl+o pin and scroll reveal', () => {
    expect(transcriptRevealActive({ toolOutputExpanded: false, scrollReveal: false })).toBe(false);
    expect(transcriptRevealActive({ toolOutputExpanded: true, scrollReveal: false })).toBe(true);
    expect(transcriptRevealActive({ toolOutputExpanded: false, scrollReveal: true })).toBe(true);
    expect(transcriptRevealActive({ toolOutputExpanded: true, scrollReveal: true })).toBe(true);
  });
});
