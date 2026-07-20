import { describe, expect, it } from 'vitest';

import { displayClusterWidth } from '../src';

describe('displayClusterWidth kitty placeholders', () => {
  it('measures a placeholder with row/column diacritics as one cell', () => {
    expect(displayClusterWidth('\u{10EEEE}\u{0305}\u{030D}')).toBe(1);
  });

  it('measures a bare placeholder as one cell', () => {
    expect(displayClusterWidth('\u{10EEEE}')).toBe(1);
  });
});
