import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TodoPanelComponent, type TodoItem } from '#/tui/components/chrome/todo-panel';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme, darkColors } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
} from '#/tui/utils/appearance-effects';

import { assertSettledFrameStable, stripAnsi } from '../../utils/frame-stability-helpers';

// Force CI mode to disable ambient effects for deterministic rendering.
process.env['CI'] = '1';

const previousEnv = {
  TERM: process.env['TERM'],
  CI: process.env['CI'],
  NO_COLOR: process.env['NO_COLOR'],
};

// Standard profile, wide enough for the 3-column board (interior 94 >= 72).
const WIDTH = 100;

function todo(title: string, status: TodoItem['status']): TodoItem {
  return { title, status };
}

beforeEach(() => {
  currentTheme.setPalette(darkColors);
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
});

afterEach(() => {
  currentTheme.setPalette(darkColors);
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('TodoPanelComponent', () => {
  it('reuses the same lines array while state is unchanged within a second', () => {
    advanceAppearanceAnimationClock(100_000);
    const panel = new TodoPanelComponent();
    panel.setTodos([todo('ship fix', 'in_progress'), todo('write tests', 'pending')]);

    // Settling moves past the flash window; both renders then share the same
    // wall-clock second bucket and must reuse the memoized lines array.
    const lines = assertSettledFrameStable((renderWidth) => panel.render(renderWidth), {
      width: WIDTH,
    });

    expect(lines.length).toBeGreaterThan(0);
    expect(stripAnsi(lines.join('\n'))).toContain('Todo Board');
  });

  it('holds board height when cards leave a lane, then shrinks after the hold', () => {
    advanceAppearanceAnimationClock(200_000);
    const panel = new TodoPanelComponent();
    panel.setExpanded(true);
    panel.setTodos([
      todo('wip', 'in_progress'),
      todo('p1', 'pending'),
      todo('p2', 'pending'),
      todo('p3', 'pending'),
      todo('p4', 'pending'),
    ]);
    const tallHeight = panel.render(WIDTH).length;

    // Raw maxRows drops 4 -> 1; the shrink hold must keep the previous height.
    advanceAppearanceAnimationClock(200_100);
    panel.setTodos([todo('wip', 'in_progress'), todo('p1', 'pending')]);
    const held = panel.render(WIDTH);
    expect(held.length).toBe(tallHeight);
    // Held rows are padded with empty cells rather than real cards.
    expect(stripAnsi(held.join('\n'))).toContain('No cards');

    // Once the hold window elapses the board may shrink.
    advanceAppearanceAnimationClock(200_100 + 1_500);
    const shrunk = panel.render(WIDTH);
    expect(shrunk.length).toBeLessThan(tallHeight);
  });

  it('renders a reordered board byte-stable immediately when motion is off (CI)', () => {
    advanceAppearanceAnimationClock(500_000);
    const panel = new TodoPanelComponent();
    panel.setTodos([
      todo('alpha', 'pending'),
      todo('beta', 'pending'),
      todo('gamma', 'pending'),
    ]);
    advanceAppearanceAnimationClock(510_000);
    panel.render(WIDTH);

    panel.setTodos([
      todo('gamma', 'pending'),
      todo('alpha', 'pending'),
      todo('beta', 'pending'),
    ]);
    // CI forces motion off: no directional glyphs, and consecutive renders at
    // the same clock are byte-identical — nothing time-driven leaks in.
    const first = panel.render(WIDTH);
    expect(stripAnsi(first.join('\n'))).not.toMatch(/▴|▾/);
    expect(panel.render(WIDTH).join('\n')).toBe(first.join('\n'));

    // A panel with the same history and change instant matches exactly.
    const reference = new TodoPanelComponent();
    reference.setTodos([
      todo('alpha', 'pending'),
      todo('beta', 'pending'),
      todo('gamma', 'pending'),
    ]);
    reference.setTodos([
      todo('gamma', 'pending'),
      todo('alpha', 'pending'),
      todo('beta', 'pending'),
    ]);
    expect(reference.render(WIDTH).join('\n')).toBe(first.join('\n'));

    // Past the summary window both settle to the same resting bytes.
    advanceAppearanceAnimationClock(520_000);
    expect(panel.render(WIDTH).join('\n')).toBe(reference.render(WIDTH).join('\n'));
  });

  it('grows the board immediately when a lane gains cards', () => {
    advanceAppearanceAnimationClock(300_000);
    const panel = new TodoPanelComponent();
    panel.setExpanded(true);
    panel.setTodos([todo('wip', 'in_progress'), todo('p1', 'pending')]);
    const smallHeight = panel.render(WIDTH).length;

    advanceAppearanceAnimationClock(300_100);
    panel.setTodos([
      todo('wip', 'in_progress'),
      todo('p1', 'pending'),
      todo('p2', 'pending'),
      todo('p3', 'pending'),
    ]);
    const grownHeight = panel.render(WIDTH).length;
    expect(grownHeight).toBeGreaterThan(smallHeight);
  });
});
