import { describe, expect, it } from 'vitest';

import {
  Spinner,
  TASK_SPINNER_STYLES,
  createTaskSpinner,
  spinnerStyleForTask,
  type SpinnerStyle,
  type SpinnerTaskKind,
} from '#/tui/utils/progress-indicator';

// Pictographic emoji (incl. the old 🌑–🌘 moons / 🌍–🌏 globes) and
// dingbats (✦✧✺) are banned — only monospace-safe glyphs may reach the grid.
const EMOJI_OR_DINGBAT = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const ALL_STYLES: readonly SpinnerStyle[] = [
  'dots',
  'line',
  'circle',
  'bounce',
  'arrow',
  'pulse',
  'moon',
  'earth',
];

describe('Spinner frames', () => {
  it('contains no emoji or dingbat glyphs in any style', () => {
    for (const style of ALL_STYLES) {
      const spinner = new Spinner('working', style);
      for (const frame of spinner.getFrames()) {
        expect(frame, `style=${style} frame=${frame}`).not.toMatch(EMOJI_OR_DINGBAT);
      }
    }
  });

  it('replaces emoji moon phases with brand geometric glyphs', () => {
    expect(new Spinner('working', 'moon').getFrames()).toEqual(['◐', '◓', '◑', '◒']);
  });

  it('replaces emoji earth with a monospace-safe rotation', () => {
    expect(new Spinner('working', 'earth').getFrames()).toEqual(['●', '◐', '○', '◑']);
  });

  it('cycles frames through tick()', () => {
    const spinner = new Spinner('working', 'moon');
    expect(spinner.currentFrame).toBe('◐');
    spinner.tick();
    expect(spinner.currentFrame).toBe('◓');
    spinner.tick();
    spinner.tick();
    spinner.tick();
    expect(spinner.currentFrame).toBe('◐');
  });
});

describe('task-aware spinner mapping', () => {
  it('maps thinking → circle, tool → arrow, waiting → pulse', () => {
    expect(spinnerStyleForTask('thinking')).toBe('circle');
    expect(spinnerStyleForTask('tool')).toBe('arrow');
    expect(spinnerStyleForTask('waiting')).toBe('pulse');
    expect(TASK_SPINNER_STYLES).toEqual({
      thinking: 'circle',
      tool: 'arrow',
      waiting: 'pulse',
    });
  });

  it('downgrades every task to the minimal line style when motion is off', () => {
    const kinds: readonly SpinnerTaskKind[] = ['thinking', 'tool', 'waiting'];
    for (const kind of kinds) {
      expect(spinnerStyleForTask(kind, false), `kind=${kind}`).toBe('line');
    }
  });

  it('creates spinners whose frames match the task kind', () => {
    const thinking = createTaskSpinner('Thinking', 'thinking');
    expect(thinking.getFrames()).toEqual(['◐', '◓', '◑', '◒']);

    const tool = createTaskSpinner('Running tool', 'tool');
    tool.tick();
    expect(tool.currentFrame).toBe('↖');

    const waiting = createTaskSpinner('Waiting', 'waiting');
    expect(waiting.getFrames()).toEqual(['█', '▓', '▒', '░', '▒', '▓']);
  });

  it('creates a static-friendly spinner when motion is not allowed', () => {
    const spinner = createTaskSpinner('Thinking', 'thinking', false);
    expect(spinner.getFrames()).toEqual(['─', '│', '─', '│']);
  });
});
