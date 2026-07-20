import { describe, expect, it, vi } from 'vitest';

import { FileViewerComponent } from '#/tui/components/dialogs/file-viewer';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const DOWN = '\u001B[B';
const UP = '\u001B[A';
const PAGE_UP = '\u001B[5~';
const PAGE_DOWN = '\u001B[6~';
const ESC = '\u001B';

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function makeContent(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line ${String(i + 1)}`).join('\n');
}

interface MakeOptions {
  readonly relativePath?: string;
  readonly content?: string;
  readonly bytes?: number;
  readonly onClose?: () => void;
  readonly maxVisible?: number;
}

function makeViewer(options: MakeOptions = {}): FileViewerComponent {
  const content = options.content ?? makeContent(30);
  return new FileViewerComponent({
    relativePath: options.relativePath ?? 'src/app.ts',
    content,
    bytes: options.bytes ?? Buffer.byteLength(content),
    onClose: options.onClose ?? vi.fn(),
    maxVisible: options.maxVisible ?? 8, // inner body height = 6 rows
  });
}

function renderedLines(viewer: FileViewerComponent, width = 100): string[] {
  return viewer.render(width).map(strip);
}

/** Body content rows only (drops header, frame borders, footer). */
function bodyLines(viewer: FileViewerComponent, width = 100): string[] {
  return renderedLines(viewer, width).slice(2, -2);
}

describe('FileViewerComponent', () => {
  it('renders the header with basename, relative path, lang, and line count', () => {
    const viewer = makeViewer();
    const header = renderedLines(viewer)[0] ?? '';

    expect(header).toContain('app.ts');
    expect(header).toContain('src/app.ts');
    expect(header).toContain('typescript');
    expect(header).toContain('30 lines');
  });

  it('labels unknown extensions as plain text in the header', () => {
    const viewer = makeViewer({ relativePath: 'Makefile', content: 'all:\n\techo hi' });
    const header = renderedLines(viewer)[0] ?? '';

    expect(header).toContain('Makefile');
    expect(header).toContain('text ·');
    expect(header).toContain('2 lines');
  });

  it('renders right-aligned line numbers followed by the │ separator', () => {
    const viewer = makeViewer();
    const body = bodyLines(viewer);

    expect(body[0]).toContain(' 1 │ line 1');
    expect(body[1]).toContain(' 2 │ line 2');
    // Gutter width tracks the digit count of the last line (30 → 2 digits).
    expect(body[5]).toContain(' 6 │ line 6');
  });

  it('scrolls down by one line with j and arrow keys', () => {
    const viewer = makeViewer();
    viewer.handleInput('j');
    expect(bodyLines(viewer)[0]).toContain('2 │ line 2');

    viewer.handleInput(DOWN);
    expect(bodyLines(viewer)[0]).toContain('3 │ line 3');
  });

  it('scrolls up with k and up arrow, clamped at the top', () => {
    const viewer = makeViewer();
    viewer.handleInput('k'); // already at the top — stays put
    expect(bodyLines(viewer)[0]).toContain('1 │ line 1');

    viewer.handleInput('j');
    viewer.handleInput('k');
    expect(bodyLines(viewer)[0]).toContain('1 │ line 1');

    viewer.handleInput('j');
    viewer.handleInput(UP);
    expect(bodyLines(viewer)[0]).toContain('1 │ line 1');
  });

  it('pages by the body height with pgdn/pgup and ctrl-d/ctrl-u', () => {
    const viewer = makeViewer(); // 6 visible rows
    viewer.handleInput(PAGE_DOWN);
    expect(bodyLines(viewer)[0]).toContain('7 │ line 7');

    viewer.handleInput(PAGE_UP);
    expect(bodyLines(viewer)[0]).toContain('1 │ line 1');

    viewer.handleInput('\u0004'); // Ctrl-D
    expect(bodyLines(viewer)[0]).toContain('7 │ line 7');

    viewer.handleInput('\u0015'); // Ctrl-U
    expect(bodyLines(viewer)[0]).toContain('1 │ line 1');
  });

  it('jumps to the bottom with G and back to the top with g', () => {
    const viewer = makeViewer(); // 30 lines, 6 visible → first shown line 25 at bottom
    viewer.handleInput('G');

    let body = bodyLines(viewer);
    expect(body[0]).toContain('25 │ line 25');
    expect(body[5]).toContain('30 │ line 30');

    viewer.handleInput('g');
    body = bodyLines(viewer);
    expect(body[0]).toContain('1 │ line 1');
  });

  it('clamps scrolling at the bottom of the file', () => {
    const viewer = makeViewer();
    for (let i = 0; i < 100; i += 1) viewer.handleInput('j');

    const body = bodyLines(viewer);
    expect(body[5]).toContain('30 │ line 30');
  });

  it('closes on esc and q', () => {
    const onCloseEsc = vi.fn();
    makeViewer({ onClose: onCloseEsc }).handleInput(ESC);
    expect(onCloseEsc).toHaveBeenCalledTimes(1);

    const onCloseQ = vi.fn();
    makeViewer({ onClose: onCloseQ }).handleInput('q');
    expect(onCloseQ).toHaveBeenCalledTimes(1);
  });

  it('renders the scroll hint footer', () => {
    const footer = renderedLines(makeViewer()).at(-1) ?? '';

    expect(footer).toContain('scroll');
    expect(footer).toContain('page');
    expect(footer).toContain('top/bottom');
    expect(footer).toContain('close');
  });
});
