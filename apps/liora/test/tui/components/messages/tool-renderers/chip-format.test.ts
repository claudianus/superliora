import { describe, expect, it } from 'vitest';

import {
  computeEditStats,
  formatEditChip,
  pluralize,
} from '#/tui/components/messages/tool-renderers/chip-format';

describe('chip-format helpers', () => {
  it('computeEditStats counts diff lines', () => {
    expect(computeEditStats({ old_string: 'a\nb', new_string: 'a\nB\nc' })).toEqual({
      added: 2,
      removed: 1,
    });
  });

  it('formatEditChip joins add/remove counts', () => {
    expect(formatEditChip({ added: 2, removed: 1 })).toBe('+2 -1');
  });

  it('pluralize handles singular and plural', () => {
    expect(pluralize(1, 'line')).toBe('1 line');
    expect(pluralize(3, 'match', 'matches')).toBe('3 matches');
  });
});
