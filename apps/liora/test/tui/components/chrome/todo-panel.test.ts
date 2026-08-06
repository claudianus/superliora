import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TodoPanelComponent, type TodoItem } from '#/tui/components/chrome/todo/todo-panel';
import {
  boardNeedsMarquee,
  marqueeFitAnsi,
} from '#/tui/components/chrome/todo/todo-panel-render';
import { visibleWidth } from '#/tui/renderer';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme, darkColors } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
  SETTLE_FLASH_MS,
} from '#/tui/features/appearance/appearance-effects';

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

describe('TodoPanelComponent virtual scroll', () => {
  // 48 terminal rows -> floor(48 / 3) - 6 chrome = 10 board rows viewport.
  function scrollPanel(): TodoPanelComponent {
    return new TodoPanelComponent({ terminalRows: () => 48 });
  }

  function pendingCards(count: number): TodoItem[] {
    return Array.from({ length: count }, (_, i) =>
      todo(`c${String(i).padStart(2, '0')}`, 'pending'),
    );
  }

  it('windows lanes past the height budget and summarizes hidden cards', () => {
    advanceAppearanceAnimationClock(700_000);
    const panel = scrollPanel();
    panel.setTodos(pendingCards(14));

    const text = stripAnsi(panel.render(WIDTH).join('\n'));
    for (let i = 0; i < 10; i++) {
      expect(text).toContain(`c${String(i).padStart(2, '0')}`);
    }
    for (let i = 10; i < 14; i++) {
      expect(text).not.toContain(`c${String(i).padStart(2, '0')}`);
    }
    expect(text).toContain('↓ 4 more (4 pending)');
    expect(text).toContain('ctrl+t to expand');
    expect(text).not.toContain('↑');
    expect(panel.getScrollSnapshot()).toEqual({ offset: 0, viewport: 10, total: 14 });
  });

  it('moves the anchor one row per wheel line delta and pages by viewport', () => {
    advanceAppearanceAnimationClock(710_000);
    const panel = scrollPanel();
    panel.setTodos(pendingCards(14));
    panel.render(WIDTH);

    // Wheel down tick: the first row scrolls out, the eleventh scrolls in.
    expect(panel.scrollBoard('line-down')).toBe(true);
    let text = stripAnsi(panel.render(WIDTH).join('\n'));
    expect(text).not.toContain('c00');
    expect(text).toContain('c01');
    expect(text).toContain('c10');
    expect(text).toContain('↑ 1 more');
    expect(text).toContain('↓ 3 more (3 pending)');
    expect(panel.getScrollSnapshot().offset).toBe(1);

    // Wheel up tick restores the first row.
    expect(panel.scrollBoard('line-up')).toBe(true);
    text = stripAnsi(panel.render(WIDTH).join('\n'));
    expect(text).toContain('c00');
    expect(text).not.toContain('c10');

    // Keyboard: page-down jumps a viewport minus one (clamped to the end),
    // page-up back to the top, and bottom / top reach the edges.
    expect(panel.scrollBoard('page-down')).toBe(true);
    expect(panel.getScrollSnapshot().offset).toBe(4);
    expect(panel.scrollBoard('page-up')).toBe(true);
    expect(panel.getScrollSnapshot().offset).toBe(0);
    expect(panel.scrollBoard('bottom')).toBe(true);
    expect(panel.getScrollSnapshot().offset).toBe(4);
    expect(panel.scrollBoard('top')).toBe(true);
    expect(panel.getScrollSnapshot().offset).toBe(0);
  });

  it('reports per-direction hidden counts across uneven lanes', () => {
    advanceAppearanceAnimationClock(720_000);
    const panel = scrollPanel();
    panel.setTodos([...pendingCards(12), todo('d0', 'done'), todo('d1', 'done')]);

    // Offset 0: the pending lane overflows by two; the done lane (2 rows)
    // fits the viewport, so the floor summary carries no ↑ half.
    let text = stripAnsi(panel.render(WIDTH).join('\n'));
    expect(text).toContain('↓ 2 more (2 pending)');
    expect(text).not.toContain('↑');

    // At the very end nothing hides below. The pending lane hides two
    // above and the short done lane (rows 0-1) scrolled out entirely, so
    // the ceiling summary counts four.
    expect(panel.scrollBoard('bottom')).toBe(true);
    text = stripAnsi(panel.render(WIDTH).join('\n'));
    expect(text).toContain('↑ 4 more');
    expect(text).not.toContain('↓');
    expect(text).toContain('ctrl+t to expand');
  });

  it('clamps at both scroll ends and refuses to consume input there', () => {
    advanceAppearanceAnimationClock(730_000);
    const panel = scrollPanel();
    panel.setTodos(pendingCards(14));
    panel.render(WIDTH);

    expect(panel.scrollBoard('top')).toBe(false);
    expect(panel.scrollBoard('line-up')).toBe(false);
    expect(panel.getScrollSnapshot().offset).toBe(0);

    expect(panel.scrollBoard('bottom')).toBe(true);
    expect(panel.scrollBoard('bottom')).toBe(false);
    expect(panel.scrollBoard('line-down')).toBe(false);
    expect(panel.getScrollSnapshot().offset).toBe(4);
  });

  it('keeps legacy bytes when cards fit the budget or no budget exists', () => {
    advanceAppearanceAnimationClock(740_000);
    const cards = pendingCards(4);

    // 4 cards fit any viewport: the windowed panel and the legacy panel
    // render identical bytes, with no scroll indicator on either.
    const windowed = new TodoPanelComponent({ terminalRows: () => 48 });
    windowed.setTodos(cards);
    const legacy = new TodoPanelComponent();
    legacy.setTodos(cards);
    const windowedLines = windowed.render(WIDTH);
    expect(windowedLines.join('\n')).toBe(legacy.render(WIDTH).join('\n'));
    expect(stripAnsi(windowedLines.join('\n'))).not.toMatch(/↑|↓|more/);

    // Without a height budget the legacy +N more footer stays, arrow-free.
    const unbudgeted = new TodoPanelComponent();
    unbudgeted.setTodos(pendingCards(8));
    const legacyText = stripAnsi(unbudgeted.render(WIDTH).join('\n'));
    expect(legacyText).toContain('+3 more (3 pending)');
    expect(legacyText).not.toMatch(/↑|↓/);
  });

  it('keeps anchor and indicator bytes stable with quality off', () => {
    advanceAppearanceAnimationClock(750_000);
    const panel = scrollPanel();
    panel.setTodos(pendingCards(14));
    advanceAppearanceAnimationClock(751_000);
    expect(panel.scrollBoard('line-down')).toBe(true);
    expect(panel.scrollBoard('line-down')).toBe(true);

    // CI forces effects off: a scrolled frame memoizes like a resting one,
    // and the indicator counts match the anchor exactly.
    const lines = assertSettledFrameStable((renderWidth) => panel.render(renderWidth), {
      width: WIDTH,
    });
    const text = stripAnsi(lines.join('\n'));
    expect(text).toContain('↑ 2 more');
    expect(text).toContain('↓ 2 more (2 pending)');
    expect(text).not.toMatch(/▴|▾/);
  });

  it('settles #568 move cues after scrolling once the motion window expires', () => {
    enablePremiumAmbient();
    advanceAppearanceAnimationClock(760_000);
    const panel = scrollPanel();
    const base = pendingCards(12);
    panel.setTodos(base);
    advanceAppearanceAnimationClock(762_000);
    panel.render(WIDTH);

    // Move c00 to the bottom of the pending lane and scroll to the end in
    // the same beat; the moved card stays inside the window.
    panel.setTodos([...base.slice(1), todo('c00', 'pending')]);
    expect(panel.scrollBoard('bottom')).toBe(true);
    expect(stripAnsi(panel.render(WIDTH).join('\n'))).toContain('c00');

    // Past the move / flash window the board settles: no directional glyphs
    // and resting bytes memoize again, scroll offset included.
    advanceAppearanceAnimationClock(762_000 + SETTLE_FLASH_MS * 3);
    const settled = panel.render(WIDTH);
    const settledText = stripAnsi(settled.join('\n'));
    expect(settledText).not.toMatch(/▴|▾/);
    expect(settledText).toContain('c00');
    expect(panel.render(WIDTH)).toBe(settled);
  });
});


describe('board cell marquee', () => {
  it('fits short cells without scrolling', () => {
    const out = marqueeFitAnsi('short', 12, 0, 'seed');
    expect(visibleWidth(out)).toBe(12);
    expect(stripAnsi(out)).toContain('short');
  });

  it('loops long titles across time so the full text is eventually visible', () => {
    enablePremiumAmbient();
    const title = 'Rewrite the kanban board so narrow terminals still show every word of the card title';
    const width = 18;
    const samples = new Set<string>();
    // Cycle length scales with title width (~20s+); sample past one full loop.
    for (let t = 0; t < 40_000; t += 250) {
      const painted = marqueeFitAnsi(title, width, t, 'card-a');
      expect(visibleWidth(painted)).toBe(width);
      samples.add(stripAnsi(painted));
    }
    // Over a full cycle the window must move — many unique frames.
    expect(samples.size).toBeGreaterThan(8);
    // Reconstruct by joining unique windows: head and tail tokens both appear.
    const joined = [...samples].join(' ');
    expect(joined).toContain('Rewrite');
    expect(joined).toContain('kanban');
    expect(joined).toContain('title');
  });

  it('detects when the 3-column board needs a marquee', () => {
    enablePremiumAmbient();
    const long = 'A very long card title that will not fit in a narrow board column';
    expect(boardNeedsMarquee([{ title: long, status: 'pending' }], 90)).toBe(true);
    expect(boardNeedsMarquee([{ title: 'ok', status: 'pending' }], 90)).toBe(false);
    // Below board min width the panel falls back to wrapped lanes.
    expect(boardNeedsMarquee([{ title: long, status: 'pending' }], 40)).toBe(false);
  });

  it('keeps the board time-driven while a title is overflowing', () => {
    enablePremiumAmbient();
    const panel = new TodoPanelComponent();
    panel.setTodos([
      {
        title: 'Overflowing card title for silk marquee on the doing lane of the board',
        status: 'in_progress',
      },
      { title: 'next item', status: 'pending' },
    ]);
    advanceAppearanceAnimationClock(50_000);
    const a = panel.render(WIDTH).join('\n');
    advanceAppearanceAnimationClock(900);
    const b = panel.render(WIDTH).join('\n');
    // Marquee animation must not freeze on the memoized frame.
    expect(a).not.toEqual(b);
  });
});
