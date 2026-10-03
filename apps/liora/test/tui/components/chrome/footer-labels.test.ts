import { describe, expect, it } from 'vitest';

import {
  labelBackgroundBash,
} from '#/tui/components/chrome/footer/footer-labels';
import {
  cycleFooterSlot,
  footerSlotVisible,
} from '#/tui/components/chrome/footer/footer-preferences';

describe('footer plain labels', () => {
  it('uses words in plain mode and short tokens in compact', () => {
    expect(labelBackgroundBash('plain', 2)).toBe('2 shell jobs');
    expect(labelBackgroundBash('compact', 2)).toBe('2 shell jobs running');
  });
});

describe('footerSlotVisible', () => {
  it('respects auto / always / off', () => {
    expect(footerSlotVisible('off', true, true)).toBe(false);
    expect(footerSlotVisible('always', true, false)).toBe(true);
    expect(footerSlotVisible('auto', true, false)).toBe(false);
    expect(footerSlotVisible('auto', true, true)).toBe(true);
    expect(footerSlotVisible('always', false, true)).toBe(false);
  });

  it('cycles auto → always → off → auto', () => {
    expect(cycleFooterSlot('auto')).toBe('always');
    expect(cycleFooterSlot('always')).toBe('off');
    expect(cycleFooterSlot('off')).toBe('auto');
  });
});
