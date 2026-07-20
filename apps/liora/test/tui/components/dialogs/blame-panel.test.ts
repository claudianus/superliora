import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BlamePanelComponent } from '#/tui/components/dialogs/blame-panel';
import { currentTheme } from '#/tui/theme';
import type { BlameCommit, BlameLine } from '#/utils/git/git-blame';

const previousChalkLevel = chalk.level;
beforeAll(() => {
  chalk.level = 3;
});
afterAll(() => {
  chalk.level = previousChalkLevel;
});

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const DOWN = '\u001B[B';
const UP = '\u001B[A';
const PAGE_UP = '\u001B[5~';
const PAGE_DOWN = '\u001B[6~';
const HOME = '\u001B[H';
const END = '\u001B[F';
const ESC = '\u001B';
const POINTER = '❯';

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

const HASH_A = 'abcdef1234567890abcdef1234567890abcdef12';
const HASH_B = '1234567890abcdef1234567890abcdef12345678';
const ZERO_HASH = '0'.repeat(40);
const TIME_A = 1_767_225_600; // 2026-01-01T00:00:00Z
const TIME_B = 1_767_312_000; // 2026-01-02T00:00:00Z

function commit(overrides: Partial<BlameCommit> = {}): BlameCommit {
  return {
    hash: HASH_A,
    author: 'Alice',
    authorTime: TIME_A,
    summary: 'feat: add thing',
    ...overrides,
  };
}

function blameLine(lineNumber: number, overrides: Partial<BlameLine> = {}): BlameLine {
  return {
    lineNumber,
    commit: commit(),
    content: `line ${String(lineNumber)}`,
    ...overrides,
  };
}

function makeLines(): BlameLine[] {
  return [
    blameLine(1),
    blameLine(2, {
      commit: commit({
        hash: HASH_B,
        author: 'Bartholomew Longname',
        authorTime: TIME_B,
        summary: 'fix: correct thing',
      }),
    }),
    blameLine(3, {
      commit: commit({
        hash: ZERO_HASH,
        author: 'Uncommitted',
        authorTime: 0,
        summary: 'Uncommitted changes',
      }),
      content: 'const pending = 1;',
    }),
  ];
}

interface MakeOptions {
  readonly lines?: BlameLine[];
  readonly title?: string;
  readonly onClose?: () => void;
  readonly maxVisible?: number;
}

function makePanel(options: MakeOptions = {}): BlamePanelComponent {
  return new BlamePanelComponent({
    lines: options.lines ?? makeLines(),
    title: options.title,
    onClose: options.onClose ?? vi.fn(),
    maxVisible: options.maxVisible,
  });
}

function renderedRaw(panel: BlamePanelComponent, width = 100): string[] {
  return panel.render(width);
}

function renderedLines(panel: BlamePanelComponent, width = 100): string[] {
  return renderedRaw(panel, width).map(strip);
}

function selectedLine(lines: string[]): string {
  return lines.find((line) => line.includes(POINTER)) ?? '';
}

describe('BlamePanelComponent', () => {
  it('renders the header with title and line count', () => {
    const header = renderedLines(makePanel({ title: 'src/app.ts' }))[0] ?? '';
    expect(header).toContain('Blame');
    expect(header).toContain('src/app.ts');
    expect(header).toContain('3 lines');
  });

  it('renders the gutter with short hash, author, and UTC date', () => {
    const selected = selectedLine(renderedLines(makePanel()));
    expect(selected).toContain('abcdef1'); // 7-char short hash
    expect(selected).toContain('Alice');
    expect(selected).toContain('2026-01-01');
    expect(selected).toContain('│');
    expect(selected).toContain('line 1');
  });

  it('truncates long authors to 12 columns with an ellipsis', () => {
    const lines = renderedLines(makePanel());
    const second = lines.find((line) => line.includes('1234567')) ?? '';
    expect(second).toContain('Bartholomew…');
    expect(second).not.toContain('Longname');
    expect(second).toContain('2026-01-02');
  });

  it('colors uncommitted gutters with the warning token', () => {
    const raw = renderedRaw(makePanel()).join('\n');
    expect(raw).toContain(currentTheme.fg('warning', '0000000'));
    expect(raw).toContain(currentTheme.fg('textMuted', 'abcdef1'));
    expect(raw).not.toContain(currentTheme.fg('warning', 'abcdef1'));
  });

  it('shows an em dash date for uncommitted lines', () => {
    const lines = renderedLines(makePanel());
    const uncommitted = lines.find((line) => line.includes('0000000')) ?? '';
    expect(uncommitted).toContain('—');
    expect(uncommitted).toContain('Uncommitted');
  });

  it('preserves special characters in content', () => {
    const panel = makePanel({
      lines: [blameLine(1, { content: '\tindented "quoted" \\ back' })],
    });
    const joined = renderedLines(panel).join('\n');
    expect(joined).toContain('\tindented "quoted" \\ back');
  });

  it('moves the selection with j/k and arrow keys', () => {
    const panel = makePanel();
    expect(selectedLine(renderedLines(panel))).toContain('line 1');

    panel.handleInput('j');
    expect(selectedLine(renderedLines(panel))).toContain('line 2');

    panel.handleInput(DOWN);
    expect(selectedLine(renderedLines(panel))).toContain('const pending = 1;');

    panel.handleInput(DOWN); // already at the last row; stays put
    expect(selectedLine(renderedLines(panel))).toContain('const pending = 1;');

    panel.handleInput('k');
    expect(selectedLine(renderedLines(panel))).toContain('line 2');

    panel.handleInput(UP);
    expect(selectedLine(renderedLines(panel))).toContain('line 1');

    panel.handleInput(UP); // already at the first row; stays put
    expect(selectedLine(renderedLines(panel))).toContain('line 1');
  });

  it('pages with pageUp/pageDown', () => {
    const lines = Array.from({ length: 30 }, (_, index) => blameLine(index + 1));
    const panel = makePanel({ lines, maxVisible: 10 }); // inner height 8
    expect(selectedLine(renderedLines(panel))).toContain('line 1');

    panel.handleInput(PAGE_DOWN);
    expect(selectedLine(renderedLines(panel))).toContain('line 9');

    panel.handleInput(PAGE_UP);
    expect(selectedLine(renderedLines(panel))).toContain('line 1');
  });

  it('jumps to the edges with g/G and home/end', () => {
    const lines = Array.from({ length: 5 }, (_, index) => blameLine(index + 1));
    const panel = makePanel({ lines });

    panel.handleInput('G');
    expect(selectedLine(renderedLines(panel))).toContain('line 5');

    panel.handleInput('g');
    expect(selectedLine(renderedLines(panel))).toContain('line 1');

    panel.handleInput(END);
    expect(selectedLine(renderedLines(panel))).toContain('line 5');

    panel.handleInput(HOME);
    expect(selectedLine(renderedLines(panel))).toContain('line 1');
  });

  it('closes on esc and q', () => {
    const onClose = vi.fn();
    const panel = makePanel({ onClose });
    panel.handleInput(ESC);
    expect(onClose).toHaveBeenCalledTimes(1);
    panel.handleInput('q');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows the empty message when there are no lines', () => {
    const joined = renderedLines(makePanel({ lines: [] })).join('\n');
    expect(joined).toContain('No blame data');
  });
});
