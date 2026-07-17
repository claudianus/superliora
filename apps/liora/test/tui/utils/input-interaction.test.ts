import { afterEach, describe, expect, it } from 'vitest';

import {
  isTUIInputInteractionActive,
  noteTUIInputInteraction,
  resetTUIInputInteractionForTests,
} from '#/tui/utils/input-interaction';

describe('input interaction holdoff', () => {
  afterEach(() => {
    resetTUIInputInteractionForTests();
  });

  it('is inactive before any keystroke', () => {
    expect(isTUIInputInteractionActive(1_000)).toBe(false);
  });

  it('stays active only inside the typing holdoff window', () => {
    noteTUIInputInteraction(1_000);
    expect(isTUIInputInteractionActive(1_000)).toBe(true);
    expect(isTUIInputInteractionActive(1_199)).toBe(true);
    expect(isTUIInputInteractionActive(1_200)).toBe(false);
  });
});
