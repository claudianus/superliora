import { describe, expect, it } from 'vitest';

import { isActivityCueHit } from '#/tui/features/transcript/activity-cue-mouse';

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
