import type { Component } from '#/tui/renderer';
import { visibleWidth } from '#/tui/renderer';
import { describe, expect, it } from 'vitest';

import { ToolOutputViewportComponent } from '#/tui/components/messages/tool-output-viewport';
import {
  createToolOutputViewportState,
  type ToolOutputViewportState,
} from '#/tui/utils/tool-output-viewport';

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

class LinesComponent implements Component {
  constructor(private readonly lines: readonly string[]) {}

  render(): string[] {
    return [...this.lines];
  }

  invalidate(): void {}
}

function setup(lines: readonly string[], expanded = false): {
  component: ToolOutputViewportComponent;
  state: () => ToolOutputViewportState;
} {
  let state = createToolOutputViewportState();
  return {
    component: new ToolOutputViewportComponent({
      child: new LinesComponent(lines),
      getState: () => state,
      setState: (next) => {
        state = next;
      },
      expanded,
    }),
    state: () => state,
  };
}

describe('ToolOutputViewportComponent', () => {
  it('keeps short output unchanged without a rail', () => {
    const { component } = setup(['one', 'two']);
    expect(component.render(8)).toEqual(['one', 'two']);
    expect(component.overflowing).toBe(false);
  });

  it('keeps the collapsed preview at three rows and adds no vertical row', () => {
    const { component } = setup(['one', 'two', 'three', 'four', 'five']);
    const rendered = component.render(8);
    expect(rendered).toHaveLength(3);
    expect(rendered.map((line) => line.replace(ANSI_PATTERN, '').slice(0, -1))).toEqual([
      'one    ',
      'two    ',
      'three  ',
    ]);
    expect(rendered.at(-1)?.replace(ANSI_PATTERN, '').endsWith('╂')).toBe(true);
  });

  it('scrolls its line window independently and paints thumb/grip on the rail', () => {
    const { component, state } = setup(['one', 'two', 'three', 'four', 'five']);
    component.render(8);
    expect(component.scroll(1)).toBe(true);
    component.setHovered(true);
    const rendered = component.render(8);
    expect(state().offset).toBe(1);
    expect(rendered[0]?.replace(ANSI_PATTERN, '').startsWith('two')).toBe(true);
    expect(rendered.some((line) => line.replace(ANSI_PATTERN, '').endsWith('┃'))).toBe(true);
    expect(component.isGripRow(2)).toBe(true);
  });

  it('bypasses slicing and the rail when explicitly expanded', () => {
    const { component } = setup(['one', 'two', 'three', 'four'], true);
    expect(component.render(8)).toEqual(['one', 'two', 'three', 'four']);
    expect(component.overflowing).toBe(false);
  });

  it('clips ANSI content to visible width and degrades gracefully at one cell', () => {
    const { component } = setup([
      '\u001B[31mabcdef\u001B[0m',
      'ghijkl',
      'mnopqr',
      'stuvwx',
    ]);
    const rendered = component.render(4);
    expect(rendered).toHaveLength(3);
    expect(rendered.every((line) => visibleWidth(line) === 4)).toBe(true);

    const narrow = component.render(1);
    expect(narrow).toHaveLength(3);
    expect(narrow.every((line) => visibleWidth(line) <= 1)).toBe(true);
  });
});
