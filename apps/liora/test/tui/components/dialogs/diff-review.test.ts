import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DiffReviewComponent } from '#/tui/components/dialogs/diff-review';
import type { DiffLine } from '#/tui/components/media/diff-preview';
import type { GitDiffFile, GitDiffReport } from '#/utils/git/git-diff';

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
const ENTER = '\r';
const ESC = '\u001B';
const POINTER = '❯';

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function modLines(): DiffLine[] {
  return [
    { kind: 'context', lineNum: 1, code: 'const a = 1;' },
    { kind: 'delete', lineNum: 2, code: 'const b = 2;' },
    { kind: 'add', lineNum: 2, code: 'const B = 2;' },
    { kind: 'context', lineNum: 3, code: 'const c = 3;' },
  ];
}

function addedLines(count: number): DiffLine[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'add' as const,
    lineNum: i + 1,
    code: `line ${String(i + 1)}`,
  }));
}

function file(overrides: Partial<GitDiffFile> & { path: string }): GitDiffFile {
  return {
    status: 'modified',
    added: 1,
    deleted: 1,
    lines: modLines(),
    ...overrides,
  };
}

function report(overrides: Partial<GitDiffReport> = {}): GitDiffReport {
  return {
    branch: 'main',
    files: [
      file({ path: 'src/app.ts' }),
      file({ path: 'src/new.ts', status: 'added', added: 4, deleted: 0, lines: addedLines(4) }),
    ],
    totalAdded: 5,
    totalDeleted: 1,
    truncated: false,
    ...overrides,
  };
}

interface MakeOptions {
  readonly report?: GitDiffReport;
  readonly filter?: string;
  readonly onClose?: () => void;
  readonly onOpenFile?: (path: string) => void;
  readonly maxVisible?: number;
}

function makeReview(options: MakeOptions = {}): DiffReviewComponent {
  return new DiffReviewComponent({
    report: options.report ?? report(),
    filter: options.filter,
    onClose: options.onClose ?? vi.fn(),
    onOpenFile: options.onOpenFile ?? vi.fn(),
    maxVisible: options.maxVisible,
  });
}

function renderedLines(review: DiffReviewComponent, width = 100): string[] {
  return review.render(width).map(strip);
}

describe('DiffReviewComponent', () => {
  it('renders the header with branch, file count, totals, and truncated marker', () => {
    const header = renderedLines(makeReview({ report: report({ truncated: true }) }))[0] ?? '';
    expect(header).toContain('Diff review');
    expect(header).toContain('⎇ main');
    expect(header).toContain('2 files');
    expect(header).toContain('+5');
    expect(header).toContain('−1');
    expect(header).toContain('(truncated)');
  });

  it('shows the active filter in the header', () => {
    const header = renderedLines(makeReview({ filter: 'src' }))[0] ?? '';
    expect(header).toContain('filter: src');
  });

  it('renders file rows with status glyphs, counts, and the first file selected', () => {
    const lines = renderedLines(makeReview());
    const selected = lines.find((line) => line.includes(POINTER)) ?? '';
    expect(selected).toMatch(/M src\/app\.ts/);
    expect(selected).toContain('+1');
    expect(selected).toContain('−1');

    const second = lines.find((line) => line.includes('src/new.ts')) ?? '';
    expect(second).toMatch(/A src\/new\.ts/);
    expect(second).toContain('+4');
    expect(second).toContain('−0');
  });

  it('renders the selected file diff body and follows the selection', () => {
    const review = makeReview();
    let joined = renderedLines(review).join('\n');
    // Modified body keeps both sides of the change.
    expect(joined).toContain('const b = 2;');
    expect(joined).toContain('const B = 2;');
    // The unselected file stays collapsed.
    expect(joined).not.toContain('line 1');

    review.handleInput('j');
    joined = renderedLines(review).join('\n');
    expect(joined).toContain('line 1');
    expect(joined).not.toContain('const B = 2;');
  });

  it('moves the selection with arrow keys', () => {
    const review = makeReview();
    review.handleInput(DOWN);
    let joined = renderedLines(review).join('\n');
    expect(joined).toContain('line 1');

    review.handleInput(UP);
    joined = renderedLines(review).join('\n');
    expect(joined).toContain('const B = 2;');
  });

  it('collapses on enter, auto-expands on selection move, and collapses with h', () => {
    const review = makeReview();
    review.handleInput(ENTER); // collapse the selected file
    let joined = renderedLines(review).join('\n');
    expect(joined).not.toContain('const B = 2;');
    expect(joined).toContain('src/app.ts'); // the row stays visible

    review.handleInput('j'); // moving the selection re-expands
    joined = renderedLines(review).join('\n');
    expect(joined).toContain('line 1');

    review.handleInput('h');
    joined = renderedLines(review).join('\n');
    expect(joined).not.toContain('line 1');

    review.handleInput(ENTER); // toggle back open
    joined = renderedLines(review).join('\n');
    expect(joined).toContain('line 1');
  });

  it('opens the selected file with v, skipping binary files', () => {
    const onOpenFile = vi.fn();
    const review = makeReview({ onOpenFile });
    review.handleInput('v');
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts');

    const binary = makeReview({
      report: report({
        files: [
          file({ path: 'assets/logo.png', status: 'binary', added: 0, deleted: 0, lines: [] }),
        ],
        totalAdded: 0,
        totalDeleted: 0,
      }),
      onOpenFile,
    });
    binary.handleInput('v');
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it('closes on esc and q', () => {
    const onClose = vi.fn();
    const review = makeReview({ onClose });
    review.handleInput(ESC);
    expect(onClose).toHaveBeenCalledTimes(1);
    review.handleInput('q');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows the clean-tree message when there are no changes', () => {
    const joined = renderedLines(
      makeReview({ report: report({ files: [], totalAdded: 0, totalDeleted: 0 }) }),
    ).join('\n');
    expect(joined).toContain('working tree clean');
  });

  it('shows a no-match message when a filter leaves no files', () => {
    const joined = renderedLines(
      makeReview({
        report: report({ files: [], totalAdded: 0, totalDeleted: 0 }),
        filter: 'nope.ts',
      }),
    ).join('\n');
    expect(joined).toContain('No changes match "nope.ts"');
  });
});
