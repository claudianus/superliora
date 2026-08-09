import { afterEach, describe, expect, it } from 'vitest';

import {
  clearHoverRegion,
  getHoverRegionId,
  hubRowHoverId,
  isHoverRegion,
  missionWorkerHoverId,
  setHoverRegion,
} from '#/tui/features/mission-control/worker-hover';
import {
  HOVER_ROW_PAD,
  paintWorkerRowChrome,
} from '#/tui/features/mission-control/worker-row-paint';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from '#/tui/config';
import { SELECT_POINTER } from '#/tui/constant/symbols';

const OFF: AppearancePreferences = {
  ...DEFAULT_APPEARANCE_PREFERENCES,
  profile: 'off',
};

const FULL: AppearancePreferences = {
  ...DEFAULT_APPEARANCE_PREFERENCES,
  profile: 'premium',
};

function strip(text: string): string {
  return text.replaceAll(/\u001b\[[0-9;]*m/g, '');
}

afterEach(() => {
  clearHoverRegion();
});

describe('mission-control hover plumbing', () => {
  it('tracks a single active hover region id', () => {
    expect(getHoverRegionId()).toBeUndefined();
    expect(setHoverRegion(missionWorkerHoverId('w1'), 1_000)).toBe(true);
    expect(getHoverRegionId()).toBe('mc:worker:w1');
    expect(isHoverRegion(missionWorkerHoverId('w1'))).toBe(true);
    expect(isHoverRegion(hubRowHoverId(0))).toBe(false);
    // Same id is a no-op.
    expect(setHoverRegion(missionWorkerHoverId('w1'), 1_001)).toBe(false);
    expect(setHoverRegion(hubRowHoverId(3), 1_002)).toBe(true);
    expect(getHoverRegionId()).toBe('hub:row:3');
    expect(clearHoverRegion()).toBe(true);
    expect(getHoverRegionId()).toBeUndefined();
  });

  it('paints exact static chrome under profile off', () => {
    setHoverRegion(missionWorkerHoverId('w2'), 500);
    const selected = strip(
      paintWorkerRowChrome({
        workerId: 'w2',
        selected: true,
        appearance: OFF,
        animated: false,
      }),
    );
    expect(selected).toBe(`${SELECT_POINTER} `);

    const idle = strip(
      paintWorkerRowChrome({
        workerId: 'other',
        selected: false,
        appearance: OFF,
        animated: false,
      }),
    );
    expect(idle).toBe('');
  });

  it('paints hover pad (not SELECT_POINTER) when the region matches', () => {
    setHoverRegion(missionWorkerHoverId('hover-me'), 900);
    const hover = strip(
      paintWorkerRowChrome({
        workerId: 'hover-me',
        selected: false,
        appearance: FULL,
        animated: true,
      }),
    );
    expect(hover).toBe(`${HOVER_ROW_PAD} `);
    expect(hover.includes(SELECT_POINTER)).toBe(false);
  });

  it('same-frame selected pointer and different-row hover never dual-paint ❯', () => {
    // Selected worker A + hover worker B in one paint frame.
    setHoverRegion(missionWorkerHoverId('worker-b'), 1_200);
    const selectedChrome = strip(
      paintWorkerRowChrome({
        workerId: 'worker-a',
        selected: true,
        appearance: OFF,
        animated: false,
      }),
    );
    const hoverChrome = strip(
      paintWorkerRowChrome({
        workerId: 'worker-b',
        selected: false,
        appearance: OFF,
        animated: false,
      }),
    );

    expect(selectedChrome).toBe(`${SELECT_POINTER} `);
    expect(hoverChrome).toBe(`${HOVER_ROW_PAD} `);
    expect(hoverChrome.includes(SELECT_POINTER)).toBe(false);

    const combined = selectedChrome + hoverChrome;
    expect(combined.split(SELECT_POINTER).length - 1).toBe(1);
  });
});
