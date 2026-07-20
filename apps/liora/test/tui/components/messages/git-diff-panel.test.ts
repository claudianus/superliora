import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitDiffPanel } from '#/tui/components/messages/git-diff-panel';
import { visibleWidth } from '#/tui/renderer';
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
function strip(lines: string[]): string {
  return lines.map((line) => line.replaceAll(ANSI_SGR, '')).join('\n');
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

describe('GitDiffPanel', () => {
  it('renders the header with branch, file count, and totals', () => {
    const out = strip(new GitDiffPanel(report()).render(120));
    expect(out).toContain('Git Diff');
    expect(out).toContain('main');
    expect(out).toContain('2 files');
    expect(out).toContain('+5');
    expect(out).toContain('−1');
  });

  it('renders per-file sections with paths and clustered diff bodies', () => {
    const out = strip(new GitDiffPanel(report()).render(120));
    expect(out).toContain('src/app.ts');
    expect(out).toContain('src/new.ts');
    // Modified body keeps both sides of the change.
    expect(out).toContain('const b = 2;');
    expect(out).toContain('const B = 2;');
    // Added file body shows its lines.
    expect(out).toContain('line 1');
  });

  it('singularizes the file count for one file', () => {
    const out = strip(
      new GitDiffPanel(report({ files: [file({ path: 'only.ts' })], totalAdded: 1, totalDeleted: 1 })).render(120),
    );
    expect(out).toContain('1 file');
    expect(out).not.toContain('1 files');
  });

  it('renders a clean empty state when the working tree is clean', () => {
    const out = strip(
      new GitDiffPanel(report({ files: [], totalAdded: 0, totalDeleted: 0 })).render(120),
    );
    expect(out).toContain('working tree clean');
    expect(out).toContain('✓');
    expect(out).toContain('0 files');
  });

  it('renders a not-a-repository state for a null report', () => {
    const out = strip(new GitDiffPanel(null).render(120));
    expect(out).toContain('not a git repository');
  });

  it('shows a one-line note for binary files', () => {
    const out = strip(
      new GitDiffPanel(
        report({
          files: [{ path: 'assets/img.png', status: 'binary', added: 0, deleted: 0, lines: [] }],
          totalAdded: 0,
          totalDeleted: 0,
        }),
      ).render(120),
    );
    expect(out).toContain('assets/img.png');
    expect(out).toContain('binary file');
  });

  it('flags the header when the report is truncated', () => {
    const out = strip(new GitDiffPanel(report({ truncated: true })).render(120));
    expect(out).toContain('truncated');
  });

  it('shows the old path for renamed files', () => {
    const out = strip(
      new GitDiffPanel(
        report({
          files: [
            file({ path: 'new-name.ts', oldPath: 'old-name.ts', status: 'renamed' }),
          ],
        }),
      ).render(120),
    );
    expect(out).toContain('old-name.ts → new-name.ts');
  });

  it('truncates long paths from the left when narrow', () => {
    const longPath = 'src/very/deeply/nested/module/with/a/long/name/file.ts';
    const panel = new GitDiffPanel(
      report({ files: [file({ path: longPath, added: 1, deleted: 0, lines: addedLines(1) })] }),
    );
    const narrow = strip(panel.render(40));
    expect(narrow).toContain('file.ts');
    expect(narrow).toContain('…');
    expect(narrow).not.toContain('src/very/deeply');

    const wide = strip(panel.render(120));
    expect(wide).toContain(longPath);
  });

  it('keeps every rendered line within the requested width', () => {
    for (const width of [40, 120]) {
      const lines = new GitDiffPanel(report()).render(width);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
