import type { Component } from '#/tui/renderer';
import { Container, visibleWidth } from '#/tui/renderer';
import { describe, expect, it, vi } from 'vitest';

import { ToolOutputViewportComponent } from '#/tui/components/messages/tool-output-viewport';
import {
  createToolOutputViewportState,
  type ToolOutputViewportState,
} from '#/tui/utils/tool/tool-output-viewport';

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

  it('keeps the collapsed preview at five rows and adds no vertical row', () => {
    const { component } = setup(['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
    const rendered = component.render(8);
    expect(rendered).toHaveLength(5);
    expect(rendered.map((line) => line.replace(ANSI_PATTERN, '').slice(0, -1))).toEqual([
      'one    ',
      'two    ',
      'three  ',
      'four   ',
      'five   ',
    ]);
    expect(rendered.at(-1)?.replace(ANSI_PATTERN, '').endsWith('╂')).toBe(true);
  });

  it('scrolls its line window independently and paints thumb/grip on the rail', () => {
    const { component, state } = setup(['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
    component.render(8);
    expect(component.scroll(1)).toBe(true);
    component.setHovered(true);
    const rendered = component.render(8);
    expect(state().offset).toBe(1);
    expect(rendered[0]?.replace(ANSI_PATTERN, '').startsWith('two')).toBe(true);
    expect(rendered.some((line) => line.replace(ANSI_PATTERN, '').endsWith('┃'))).toBe(true);
    expect(rendered.some((_, row) => component.isGripRow(row))).toBe(true);
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
    expect(rendered).toHaveLength(4);
    expect(rendered.every((line) => visibleWidth(line) === 4)).toBe(true);

    const narrow = component.render(1);
    expect(narrow).toHaveLength(4);
    expect(narrow.every((line) => visibleWidth(line) <= 1)).toBe(true);
  });

  it('paints only the nested visible window of a huge highlighted body', () => {
    let state = createToolOutputViewportState();
    const render = vi.fn(() => {
      throw new Error('full output paint must not run');
    });
    const paintContentRows = vi.fn((_width: number, start: number, end: number) =>
      Array.from({ length: end - start }, (_, row) =>
        `\u001B[32mline-${start + row}\u001B[0m`),
    );
    const body: Component = {
      render,
      invalidate() {},
      measureContentRows: () => 10_000,
      paintContentRows,
    };
    const nested = new Container();
    nested.addChild(new LinesComponent(['heading']));
    nested.addChild(body);
    const component = new ToolOutputViewportComponent({
      child: nested,
      getState: () => state,
      setState: (next) => { state = next; },
    });
    const first = component.render(20);
    expect(first).toHaveLength(5);
    expect(first[1]).toContain('\u001B[32mline-0');
    expect(paintContentRows).toHaveBeenLastCalledWith(19, 0, 4);

    expect(component.scroll(500)).toBe(true);
    const scrolled = component.render(20);
    expect(scrolled[0]).toContain('line-499');
    expect(paintContentRows).toHaveBeenLastCalledWith(19, 499, 504);
    expect(render).not.toHaveBeenCalled();
    expect(component.measureContentRows(20)).toBe(5);
  });

  it('keeps container-subclass presentation rather than flattening its children', () => {
    class FramedOutput extends Container {
      override render(): string[] { return ['framed-output']; }
    }
    let state = createToolOutputViewportState();
    const child = new FramedOutput();
    child.addChild(new LinesComponent(['unframed-body']));
    const component = new ToolOutputViewportComponent({
      child,
      getState: () => state,
      setState: (next) => { state = next; },
    });
    expect(component.render(20)).toEqual(['framed-output']);
  });
});
