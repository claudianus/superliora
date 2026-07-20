import { describe, expect, it, vi } from 'vitest';

import { FileExplorerComponent } from '#/tui/components/dialogs/file-explorer';
import { buildFileTree } from '#/utils/fs/file-tree';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const DOWN = '\u001B[B';
const UP = '\u001B[A';
const ENTER = '\r';
const ESC = '\u001B';
const POINTER = '❯';

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

interface MakeOptions {
  readonly onPick?: (path: string) => void;
  readonly onClose?: () => void;
  readonly maxVisible?: number;
}

/** Top-level order (dirs first, case-insensitive): src, package.json, README.md. */
function makeExplorer(options: MakeOptions = {}): FileExplorerComponent {
  const nodes = buildFileTree(['src/app.ts', 'src/util/helper.ts', 'README.md', 'package.json']);
  return new FileExplorerComponent({
    workDir: '/tmp/myproj',
    nodes,
    truncated: false,
    source: 'git',
    onPick: options.onPick ?? vi.fn(),
    onClose: options.onClose ?? vi.fn(),
    maxVisible: options.maxVisible,
  });
}

function renderedLines(explorer: FileExplorerComponent, width = 100): string[] {
  return explorer.render(width).map(strip);
}

function selectedLine(explorer: FileExplorerComponent, width = 100): string {
  return renderedLines(explorer, width).find((line) => line.includes(POINTER)) ?? '';
}

describe('FileExplorerComponent', () => {
  it('renders the header (basename, count, source) and collapsed top-level rows', () => {
    const explorer = makeExplorer();
    const lines = renderedLines(explorer);
    expect(lines[0]).toContain('Files — myproj');
    expect(lines[0]).toContain('4 files');
    expect(lines[0]).toContain('git');

    const joined = lines.join('\n');
    expect(joined).toContain('src');
    expect(joined).toContain('package.json');
    expect(joined).toContain('README.md');
    // Children stay hidden until their directory is expanded.
    expect(joined).not.toContain('app.ts');
    expect(joined).not.toContain('helper.ts');
  });

  it('flags truncated listings in the header', () => {
    const nodes = buildFileTree(['a.ts']);
    const explorer = new FileExplorerComponent({
      workDir: '/tmp/big',
      nodes,
      truncated: true,
      source: 'walk',
      onPick: vi.fn(),
      onClose: vi.fn(),
    });
    const header = renderedLines(explorer)[0];
    expect(header).toContain('(truncated)');
    expect(header).toContain('fs walk');
  });

  it('expands a directory on enter and collapses it on a second enter', () => {
    const explorer = makeExplorer();
    expect(selectedLine(explorer)).toContain('src');

    explorer.handleInput(ENTER); // expand src → util (dir), app.ts
    let joined = renderedLines(explorer).join('\n');
    expect(joined).toContain('util');
    expect(joined).toContain('app.ts');

    explorer.handleInput(ENTER); // selection still on src → collapse
    joined = renderedLines(explorer).join('\n');
    expect(joined).not.toContain('util');
    expect(joined).not.toContain('app.ts');
  });

  it('moves the selection with j/k and arrow keys', () => {
    const explorer = makeExplorer();
    expect(selectedLine(explorer)).toContain('src');

    explorer.handleInput('j');
    expect(selectedLine(explorer)).toContain('package.json');
    explorer.handleInput('k');
    expect(selectedLine(explorer)).toContain('src');

    explorer.handleInput(DOWN);
    expect(selectedLine(explorer)).toContain('package.json');
    explorer.handleInput(UP);
    expect(selectedLine(explorer)).toContain('src');
  });

  it('picks a top-level file on enter (onPick then onClose)', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const explorer = makeExplorer({ onPick, onClose });
    explorer.handleInput('j'); // package.json
    explorer.handleInput('j'); // README.md
    explorer.handleInput(ENTER);
    expect(onPick).toHaveBeenCalledWith('README.md');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('picks a nested file with its relative path', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const explorer = makeExplorer({ onPick, onClose });
    explorer.handleInput(ENTER); // expand src → src, util, app.ts, …
    explorer.handleInput('j'); // util
    explorer.handleInput('j'); // app.ts
    explorer.handleInput(ENTER);
    expect(onPick).toHaveBeenCalledWith('src/app.ts');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('collapses an expanded directory with h, then jumps to the parent', () => {
    const explorer = makeExplorer();
    explorer.handleInput(ENTER); // expand src
    explorer.handleInput('j'); // util
    explorer.handleInput('j'); // app.ts
    // h on a file jumps to its parent directory (src).
    explorer.handleInput('h');
    expect(selectedLine(explorer)).toContain('src');
  });

  it('closes on esc and q', () => {
    const onCloseEsc = vi.fn();
    makeExplorer({ onClose: onCloseEsc }).handleInput(ESC);
    expect(onCloseEsc).toHaveBeenCalledTimes(1);

    const onCloseQ = vi.fn();
    makeExplorer({ onClose: onCloseQ }).handleInput('q');
    expect(onCloseQ).toHaveBeenCalledTimes(1);
  });

  it('keeps the selection visible while scrolling a long list', () => {
    const paths = Array.from({ length: 40 }, (_, i) => `file${String(i).padStart(2, '0')}.ts`);
    const explorer = new FileExplorerComponent({
      workDir: '/tmp/big',
      nodes: buildFileTree(paths),
      truncated: false,
      source: 'walk',
      onPick: vi.fn(),
      onClose: vi.fn(),
      maxVisible: 8, // inner body height = 6 rows
    });
    for (let i = 0; i < 20; i++) explorer.handleInput('j');
    // The viewport must have scrolled so file20.ts is both selected and rendered.
    expect(selectedLine(explorer)).toContain('file20.ts');
  });
});
