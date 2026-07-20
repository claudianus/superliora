import { describe, expect, it } from 'vitest';

import { RendererTextInput, type RendererCellStyle } from '../src';

const ghostStyle: RendererCellStyle = { fg: '#666666', dim: true };
const baseStyle: RendererCellStyle = { fg: '#ffffff' };

function lineText(line: unknown): string {
  if (!Array.isArray(line)) return '';
  return line.map((cell: { readonly char?: string }) => cell.char ?? '').join('');
}

function lineStyles(line: unknown): readonly (RendererCellStyle | undefined)[] {
  if (!Array.isArray(line)) return [];
  return line.map((cell: { readonly style?: RendererCellStyle }) => cell.style);
}

describe('RendererTextInput ghost text', () => {
  it('renders ghost text after the cursor with ghost style', () => {
    const input = new RendererTextInput({ text: 'hello', style: baseStyle });
    input.setCursor({ line: 0, column: 5 });

    const frame = input.render({ width: 20, ghostText: ' world', ghostStyle });

    expect(lineText(frame.lines[0])).toBe('hello world');
    // First 5 cells use base style, ghost cells use ghostStyle
    const styles = lineStyles(frame.lines[0]);
    expect(styles[0]).toEqual(baseStyle);
    expect(styles[5]).toEqual(ghostStyle);
  });

  it('renders ghost text at cursor position mid-line', () => {
    const input = new RendererTextInput({ text: 'hello world', style: baseStyle });
    input.setCursor({ line: 0, column: 5 });

    const frame = input.render({ width: 30, ghostText: ' beautiful', ghostStyle });

    // Ghost is inserted at cursor x=5, after 'hello'
    const text = lineText(frame.lines[0]);
    expect(text).toContain('hello');
    expect(text).toContain('beautiful');
  });

  it('truncates ghost text to fit within width', () => {
    const input = new RendererTextInput({ text: 'hi', style: baseStyle });
    input.setCursor({ line: 0, column: 2 });

    const frame = input.render({ width: 6, ghostText: ' this is a very long ghost text', ghostStyle });

    // Width is 6, cursor at x=2, so only 4 chars of ghost fit
    expect(lineText(frame.lines[0]).length).toBeLessThanOrEqual(6);
  });

  it('does not render ghost text when there is a selection', () => {
    const input = new RendererTextInput({ text: 'hello', style: baseStyle });
    input.setCursor({ line: 0, column: 5 });
    // Selection uses text offsets: anchor=0, head=5 selects 'hello'
    input.setSelection({ anchor: 0, head: 5 });

    const frame = input.render({ width: 20, ghostText: ' world', ghostStyle });

    expect(lineText(frame.lines[0])).not.toContain('world');
  });

  it('does not render ghost text when ghostText is empty', () => {
    const input = new RendererTextInput({ text: 'hello', style: baseStyle });
    input.setCursor({ line: 0, column: 5 });

    const frame = input.render({ width: 20, ghostText: '', ghostStyle });

    expect(lineText(frame.lines[0])).toBe('hello');
  });

  it('renders ghost on the correct visual line for multiline text', () => {
    const input = new RendererTextInput({ text: 'first\nsecond', style: baseStyle });
    input.setCursor({ line: 1, column: 6 });

    const frame = input.render({ width: 20, ghostText: ' line', ghostStyle });

    expect(lineText(frame.lines[0])).toBe('first');
    expect(lineText(frame.lines[1])).toContain('second');
    expect(lineText(frame.lines[1])).toContain('line');
  });

  it('handles CJK wide characters in ghost text within width budget', () => {
    const input = new RendererTextInput({ text: 'hi', style: baseStyle });
    input.setCursor({ line: 0, column: 2 });

    // Width 6: cursor at x=2, 4 columns left. CJK chars are width 2 each.
    const frame = input.render({ width: 6, ghostText: '你好世界', ghostStyle });

    const text = lineText(frame.lines[0]);
    // Should fit at most 2 CJK chars (4 columns) after 'hi'
    expect(text.length).toBeLessThanOrEqual(6);
  });

  it('uses default style when ghostStyle is undefined', () => {
    const input = new RendererTextInput({ text: 'hello', style: baseStyle });
    input.setCursor({ line: 0, column: 5 });

    const frame = input.render({ width: 20, ghostText: ' world' });

    expect(lineText(frame.lines[0])).toBe('hello world');
  });
});
