import { describe, expect, it } from 'vitest';

import {
  RENDERER_EDITOR_CONTENT_X,
  RENDERER_EDITOR_PROMPT_X,
  RENDERER_EDITOR_SCROLLBAR_THUMB,
  RENDERER_EDITOR_SCROLLBAR_TRACK,
  highlightRendererEditorSlashToken,
  injectRendererEditorArgumentHint,
  injectRendererEditorPromptSymbol,
  measureRendererEditorSurfaceLayout,
  projectRendererEditorArgumentHint,
  projectRendererEditorSurfaceCursor,
  renderRendererEditorFrame,
  renderRendererEditorSurface,
  resolveRendererEditorArgumentHint,
  resolveRendererEditorSurfaceStyles,
  stripRendererEditorSgr,
  wrapRendererEditorSideBorders,
  type RendererCell,
  type RendererRegionLine,
} from '../src';

const paint = (text: string): string => `\u001B[1m${text}\u001B[0m`;

function rowText(line: RendererRegionLine): string {
  if (typeof line === 'string') return stripRendererEditorSgr(line);
  return line.map((cell) => cell.char).join('');
}

describe('renderer editor chrome helpers', () => {
  it('highlights slash command path tokens without changing visible text', () => {
    const line = '/goal next manage\u001B[7m \u001B[0m';
    const highlighted = highlightRendererEditorSlashToken(line, paint);

    expect(highlighted).toBeDefined();
    expect(stripRendererEditorSgr(highlighted!)).toBe(stripRendererEditorSgr(line));
    expect(highlighted).toContain('\u001B[1m/goal\u001B[0m');
    expect(highlighted).toContain('\u001B[1mnext\u001B[0m');
    expect(highlighted).toContain('\u001B[1mmanage\u001B[0m');
    expect(highlighted).toContain('\u001B[7m');
  });

  it('injects prompt symbols and argument hints while preserving line width', () => {
    const line = '    /goal                        ';
    const withPrompt = injectRendererEditorPromptSymbol(line);
    const withHint = injectRendererEditorArgumentHint(withPrompt!, ' [status]', 5, 34, paint);

    expect(withPrompt).toBe('  > /goal                        ');
    expect(stripRendererEditorSgr(withHint)).toContain('/goal [status]');
    expect(stripRendererEditorSgr(withHint)).toHaveLength(line.length);
  });

  it('projects argument hints onto native cell editor lines', () => {
    const hints = new Map([['goal', '[status]']]);

    expect(resolveRendererEditorArgumentHint({
      text: '/goal',
      cursor: { line: 0, col: 5 },
      hints,
    })).toBe(' [status]');

    const projected = projectRendererEditorArgumentHint(
      [[
        { char: '/' },
        { char: 'g' },
        { char: 'o' },
        { char: 'a' },
        { char: 'l' },
      ]],
      {
        text: '/goal',
        cursor: { line: 0, col: 5 },
        hints,
        width: 14,
        style: { fg: '#777777' },
      },
    );

    expect(rowText(projected[0]!)).toBe('/goal [status]');
    expect((projected[0] as RendererCell[])[5]?.style).toEqual({ fg: '#777777' });
  });

  it('wraps legacy editor rows with painted side borders and labels', () => {
    const top = '─'.repeat(24);
    const rows = wrapRendererEditorSideBorders([top, '   x                  ', top], paint, {
      connectedAbove: true,
      label: ' ! shell mode ',
    });

    expect(stripRendererEditorSgr(rows[0]!)).toBe(`├ ! shell mode ${'─'.repeat(8)}┤`);
    expect(stripRendererEditorSgr(rows[1]!)).toBe('│  x                 │');
    expect(stripRendererEditorSgr(rows[2]!)).toBe('╰──────────────────────╯');
  });

  it('renders native editor frame cells with prompt, borders, scrollbar, and cursor', () => {
    const frame = renderRendererEditorFrame({
      width: 12,
      height: 4,
      inputLines: [[{ char: 'h' }, { char: 'i' }]],
      inputCursor: { x: 2, y: 0, visible: true, shape: 'bar' },
      prompt: '!',
      connectedAbove: true,
      scrollbarLines: [RENDERER_EDITOR_SCROLLBAR_THUMB, RENDERER_EDITOR_SCROLLBAR_TRACK],
      borderStyle: { fg: '#111111' },
      promptStyle: { fg: '#222222', bold: true },
      surfaceStyle: { bg: '#333333' },
      scrollbarTrackStyle: { fg: '#444444' },
      scrollbarThumbStyle: { fg: '#555555' },
    });

    expect(frame.lines).toHaveLength(4);
    expect(rowText(frame.lines[0]!)).toBe('├──────────┤');
    expect(rowText(frame.lines[1]!)).toBe('│ ! hi    █│');
    expect(rowText(frame.lines[2]!)).toBe('│         ││');
    expect(rowText(frame.lines[3]!)).toBe('╰──────────╯');
    expect(frame.cursor).toMatchObject({ x: 6, y: 1, visible: true, shape: 'bar' });

    const contentLine = frame.lines[1] as RendererCell[];
    expect(contentLine[RENDERER_EDITOR_PROMPT_X]?.style).toMatchObject({
      fg: '#222222',
      bold: true,
    });
    expect(contentLine[RENDERER_EDITOR_CONTENT_X]?.char).toBe('h');
    expect(contentLine[10]?.style).toEqual({ fg: '#555555' });
  });

  it('renders native editor surfaces with argument hints and overlay lines', () => {
    const surface = renderRendererEditorSurface({
      width: 18,
      content: {
        lines: [[
          { char: '/' },
          { char: 'g' },
          { char: 'o' },
          { char: 'a' },
          { char: 'l' },
        ]],
        cursor: { x: 5, y: 0, visible: true, shape: 'bar' },
        contentRows: 1,
        viewportRow: 0,
      },
      argumentHint: {
        text: '/goal',
        cursor: { line: 0, col: 5 },
        hints: new Map([['goal', '[status]']]),
      },
      overlays: ['→ help'],
    });

    expect(surface.lines.map(rowText)).toEqual([
      '╭────────────────╮',
      '│ > /goal [statu │',
      '╰────────────────╯',
      '→ help',
    ]);
    expect(surface.frameLines.map(rowText)).toEqual([
      '╭────────────────╮',
      '│ > /goal [statu │',
      '╰────────────────╯',
    ]);
    expect(surface.overlayLines).toEqual(['→ help']);
    expect(surface.cursor).toMatchObject({ x: 9, y: 1, visible: true });
  });

  it('projects native editor surface cursors into the frame viewport', () => {
    const surface = renderRendererEditorSurface({
      width: 10,
      content: {
        lines: [[{ char: 'x' }]],
        cursor: { x: 1, y: 0, visible: true, shape: 'bar' },
        contentRows: 1,
        viewportRow: 0,
      },
    });

    expect(projectRendererEditorSurfaceCursor({
      surface,
      rect: { x: 5, y: 7, width: 10, height: 3 },
      viewport: { x: 0, y: 0, width: 20, height: 20 },
    })).toMatchObject({ x: 10, y: 8, visible: true, shape: 'bar' });

    expect(projectRendererEditorSurfaceCursor({
      surface,
      rect: { x: 50, y: 7, width: 10, height: 3 },
      viewport: { x: 0, y: 0, width: 20, height: 20 },
    })).toBeUndefined();
  });

  it('resolves native editor surface styles from semantic palette roles', () => {
    const styles = resolveRendererEditorSurfaceStyles({
      commandMode: true,
      focused: true,
      canvasBackground: true,
      palette: {
        text: '#111111',
        textMuted: '#222222',
        textStrong: '#333333',
        border: '#444444',
        borderFocus: '#555555',
        command: '#666666',
        surfaceSunken: '#777777',
        selectionBg: '#888888',
        selectionText: '#999999',
      },
    });

    expect(styles).toEqual({
      borderStyle: { fg: '#666666' },
      textStyle: { fg: '#111111' },
      promptStyle: { fg: '#666666', bold: true },
      surfaceStyle: { fg: '#111111', bg: '#777777' },
      scrollbarTrackStyle: { fg: '#222222', dim: true },
      scrollbarThumbStyle: { fg: '#333333' },
      placeholderStyle: { fg: '#222222', dim: true },
      selectionStyle: { fg: '#999999', bg: '#888888' },
    });

    expect(resolveRendererEditorSurfaceStyles({
      palette: {
        text: '#111111',
        textMuted: '#222222',
        textStrong: '#333333',
        border: '#444444',
        borderFocus: '#555555',
        command: '#666666',
        surfaceSunken: '#777777',
        selectionBg: '#888888',
        selectionText: '#999999',
      },
      focused: true,
    }).borderStyle).toEqual({ fg: '#555555' });
  });

  it('measures native editor surface rows and renders automatic scrollbars', () => {
    expect(measureRendererEditorSurfaceLayout({
      height: 5,
      overlays: ['one', 'two', 'three'],
    })).toEqual({
      rows: 5,
      frameRows: 3,
      contentRows: 1,
      overlayRows: 2,
      overlayLines: ['one', 'two'],
    });

    const surface = renderRendererEditorSurface({
      width: 10,
      frameRows: 4,
      content: {
        lines: [[{ char: 'a' }], [{ char: 'b' }]],
        cursor: { x: 0, y: 1, visible: true, shape: 'bar' },
        contentRows: 4,
        viewportRow: 2,
      },
      scrollbar: {},
    });

    expect(surface.lines.map(rowText)).toEqual([
      '╭────────╮',
      '│ > a   ││',
      '│   b   █│',
      '╰────────╯',
    ]);
    expect(surface.cursor).toMatchObject({ x: 4, y: 2, visible: true });
  });

  it('keeps native editor cursors out of the scrollbar column', () => {
    const frame = renderRendererEditorFrame({
      width: 8,
      height: 3,
      inputLines: [[{ char: 'x' }]],
      inputCursor: { x: 99, y: 0, visible: true },
      scrollbarLines: [RENDERER_EDITOR_SCROLLBAR_THUMB],
    });

    expect(frame.cursor).toMatchObject({ x: 5, y: 1, visible: true });
  });
});
