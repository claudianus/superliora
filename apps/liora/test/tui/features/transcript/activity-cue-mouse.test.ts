import { describe, expect, it } from 'vitest';

import {
  isActivityCueHit,
  resolveActivityStatusMouseTarget,
} from '#/tui/features/transcript/activity-cue-mouse';

const rect = { x: 0, y: 10, width: 80, height: 1 };

describe('isActivityCueHit', () => {
  it('hits a left click inside the cue when watchers are live', () => {
    expect(
      isActivityCueHit({
        event: { type: 'mouse', action: 'press', button: 'left', x: 4, y: 10 } as never,
        rect,
        hasWatchers: true,
      }),
    ).toBe(true);
  });

  it('ignores clicks when no watchers are live', () => {
    expect(
      isActivityCueHit({
        event: { type: 'mouse', action: 'press', button: 'left', x: 4, y: 10 } as never,
        rect,
        hasWatchers: false,
      }),
    ).toBe(false);
  });

  it('ignores clicks outside the cue', () => {
    expect(
      isActivityCueHit({
        event: { type: 'mouse', action: 'press', button: 'left', x: 4, y: 20 } as never,
        rect,
        hasWatchers: true,
      }),
    ).toBe(false);
  });
});

describe('resolveActivityStatusMouseTarget', () => {
  it('routes the right-edge chips before the leftover cue', () => {
    expect(
      resolveActivityStatusMouseTarget({
        event: { type: 'mouse', action: 'press', button: 'left', x: 77, y: 10 } as never,
        rect,
        hasWatchers: true,
        showStop: true,
        showBg: true,
      }),
    ).toBe('stop');
    expect(
      resolveActivityStatusMouseTarget({
        event: { type: 'mouse', action: 'press', button: 'left', x: 71, y: 10 } as never,
        rect,
        hasWatchers: true,
        showStop: true,
        showBg: true,
      }),
    ).toBe('bg');
    expect(
      resolveActivityStatusMouseTarget({
        event: { type: 'mouse', action: 'press', button: 'left', x: 4, y: 10 } as never,
        rect,
        hasWatchers: true,
        showStop: true,
        showBg: true,
      }),
    ).toBe('cue');
  });

  it('ignores chip clicks when the row is a calm leftover cue', () => {
    expect(
      resolveActivityStatusMouseTarget({
        event: { type: 'mouse', action: 'press', button: 'left', x: 77, y: 10 } as never,
        rect,
        hasWatchers: true,
        showStop: false,
        showBg: false,
      }),
    ).toBe('cue');
  });
});
