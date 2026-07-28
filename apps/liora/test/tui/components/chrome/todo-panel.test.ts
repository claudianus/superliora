import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TodoPanelComponent, type TodoItem } from '#/tui/components/chrome/todo-panel';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme, darkColors } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
  SETTLE_FLASH_MS,
} from '#/tui/utils/appearance-effects';

import { assertSettledFrameStable, stripAnsi } from '../../utils/frame-stability-helpers';

// Force CI mode to disable ambient effects for deterministic rendering.
process.env['CI'] = '1';

const previousEnv = {
  TERM: process.env['TERM'],
  CI: process.env['CI'],
  NO_COLOR: process.env['NO_COLOR'],
  SSH_TTY: process.env['SSH_TTY'],
  SSH_CONNECTION: process.env['SSH_CONNECTION'],
  SSH_CLIENT: process.env['SSH_CLIENT'],
};

// Standard profile, wide enough for the 3-column board (interior 94 >= 72).
const WIDTH = 100;

function todo(title: string, status: TodoItem['status']): TodoItem {
  return { title, status };
}

/** Switch the process into a local premium session (motion allowed). */
function enablePremiumAmbient(): void {
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
  setAppearanceRenderHealth('healthy');
  setAppearanceRenderQuality('full');
  setActiveAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium',
    particles: 'premium',
  });
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

describe('TodoPanelComponent subagents strip', () => {
  it('renders one row per active subagent with live counts below the lanes', () => {
    advanceAppearanceAnimationClock(600_000);
    const panel = new TodoPanelComponent();
    panel.setTodos([todo('main work', 'in_progress')]);
    panel.setSubagentTodos({
      subagentId: 'sub-1',
      name: 'explore',
      todos: [
        { title: 'a', status: 'done' },
        { title: 'b', status: 'done' },
        { title: 'c', status: 'in_progress' },
        { title: 'd', status: 'pending' },
        { title: 'e', status: 'pending' },
      ],
    });
    panel.setSubagentTodos({
      subagentId: 'sub-2',
      name: 'code-reviewer',
      todos: [{ title: 'review', status: 'pending' }],
    });

    expect(panel.getSubagentStrip()).toEqual([
      { subagentId: 'sub-1', name: 'explore', done: 2, total: 5 },
      { subagentId: 'sub-2', name: 'code-reviewer', done: 0, total: 1 },
    ]);

    // Settled strip frames memoize like the rest of the board.
    const lines = assertSettledFrameStable((renderWidth) => panel.render(renderWidth), {
      width: WIDTH,
    });
    const text = stripAnsi(lines.join('\n'));
    expect(text).toContain('subagents (2)');
    expect(text).toContain('explore');
    expect(text).toContain('2/5');
    expect(text).toContain('code-reviewer');
    expect(text).toContain('0/1');
    // The strip sits below the lane headers, inside the board frame.
    expect(text.indexOf('subagents (2)')).toBeGreaterThan(text.indexOf('Doing'));
  });

  it('updates counts in place without adding rows', () => {
    advanceAppearanceAnimationClock(610_000);
    const panel = new TodoPanelComponent();
    panel.setTodos([todo('main work', 'in_progress')]);
    panel.setSubagentTodos({
      subagentId: 'sub-1',
      name: 'explore',
      todos: [
        { title: 'a', status: 'pending' },
        { title: 'b', status: 'pending' },
      ],
    });
    panel.setSubagentTodos({
      subagentId: 'sub-1',
      name: 'explore',
      todos: [
        { title: 'a', status: 'done' },
        { title: 'b', status: 'done' },
      ],
    });

    expect(panel.getSubagentStrip()).toEqual([
      { subagentId: 'sub-1', name: 'explore', done: 2, total: 2 },
    ]);
    const text = stripAnsi(
      assertSettledFrameStable((renderWidth) => panel.render(renderWidth), { width: WIDTH }).join(
        '\n',
      ),
    );
    expect(text).toContain('subagents (1)');
    expect(text).toContain('2/2');
    expect(text).not.toContain('0/2');
  });

  it('removes finished subagents and stays byte-static when effects are off', () => {
    advanceAppearanceAnimationClock(620_000);
    const panel = new TodoPanelComponent();
    panel.setTodos([todo('main work', 'in_progress')]);
    panel.setSubagentTodos({
      subagentId: 'sub-1',
      name: 'explore',
      todos: [{ title: 'a', status: 'done' }],
    });
    panel.setSubagentTodos({
      subagentId: 'sub-2',
      name: 'reviewer',
      todos: [{ title: 'b', status: 'pending' }],
    });
    advanceAppearanceAnimationClock(622_000);

    expect(panel.removeSubagent('sub-1')).toBe(true);
    expect(panel.removeSubagent('sub-1')).toBe(false);

    // CI forces effects off: removal feedback adds zero animation bytes —
    // the frame right after removal and well past any flash window match.
    const immediate = panel.render(WIDTH);
    advanceAppearanceAnimationClock(628_000);
    expect(panel.render(WIDTH).join('\n')).toBe(immediate.join('\n'));

    const text = stripAnsi(immediate.join('\n'));
    expect(text).toContain('subagents (1)');
    expect(text).not.toContain('explore');
    expect(text).toContain('reviewer');
  });

  it('bounds the strip when completions never arrive', () => {
    advanceAppearanceAnimationClock(630_000);
    const panel = new TodoPanelComponent();
    panel.setTodos([todo('main work', 'in_progress')]);
    for (let i = 0; i < 10; i++) {
      panel.setSubagentTodos({
        subagentId: `sub-${i}`,
        name: `agent-${i}`,
        todos: [{ title: 'task', status: 'pending' }],
      });
    }

    const strip = panel.getSubagentStrip();
    expect(strip).toHaveLength(6);
    // Earliest-entered rows are evicted; the newest six survive.
    expect(strip.map((row) => row.subagentId)).toEqual([
      'sub-4',
      'sub-5',
      'sub-6',
      'sub-7',
      'sub-8',
      'sub-9',
    ]);
    const text = stripAnsi(panel.render(WIDTH).join('\n'));
    expect(text).toContain('subagents (6)');
    expect(text).not.toContain('agent-0');
    expect(text).toContain('agent-9');
  });

  it('follows board visibility: no strip while the board itself is hidden', () => {
    const panel = new TodoPanelComponent();
    panel.setSubagentTodos({
      subagentId: 'sub-1',
      name: 'explore',
      todos: [{ title: 'a', status: 'done' }],
    });
    expect(panel.render(WIDTH)).toEqual([]);
  });

  it('settles new rows with the entrance flash at premium and statically at off', () => {
    // Off (CI): identical bytes immediately and after the flash window —
    // the entrance settle is skipped entirely.
    advanceAppearanceAnimationClock(640_000);
    const staticPanel = new TodoPanelComponent();
    staticPanel.setTodos([todo('main work', 'pending')]);
    // Let the board's own add summary expire so the comparison isolates the
    // strip (semantic badges are time-gated even with motion off).
    advanceAppearanceAnimationClock(641_000);
    staticPanel.setSubagentTodos({
      subagentId: 'sub-1',
      name: 'explore',
      todos: [{ title: 'a', status: 'pending' }],
    });
    const staticFrame = staticPanel.render(WIDTH).join('\n');
    advanceAppearanceAnimationClock(643_000);
    expect(staticPanel.render(WIDTH).join('\n')).toBe(staticFrame);

    // Premium: the entrance flash makes early frames time-driven, then the
    // row settles to resting bytes and memoizes again.
    enablePremiumAmbient();
    advanceAppearanceAnimationClock(650_000);
    const premiumPanel = new TodoPanelComponent();
    premiumPanel.setTodos([todo('main work', 'pending')]);
    // Let the board's own add flash expire before the strip enters.
    advanceAppearanceAnimationClock(652_000);
    premiumPanel.setSubagentTodos({
      subagentId: 'sub-1',
      name: 'explore',
      todos: [{ title: 'a', status: 'pending' }],
    });
    const flashFrame = premiumPanel.render(WIDTH).join('\n');
    advanceAppearanceAnimationClock(652_000 + SETTLE_FLASH_MS * 3);
    const settled = premiumPanel.render(WIDTH);
    const settledText = stripAnsi(settled.join('\n'));
    // The flash is color-driven: raw bytes differ mid-flash, stripped text
    // stays the same word, and resting bytes return once it expires.
    expect(flashFrame).not.toBe(settled.join('\n'));
    expect(stripAnsi(flashFrame)).toContain('explore');
    expect(settledText).toContain('explore');
    // Resting frames are no longer time-driven once the flash expires.
    expect(premiumPanel.render(WIDTH)).toBe(settled);
  });
});
