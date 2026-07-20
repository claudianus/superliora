import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CommitBrowserComponent } from '#/tui/components/dialogs/commit-browser';
import type { GitLogCommit, GitLogReport } from '#/utils/git/git-log';

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

const HASH_A = 'abcdef1234567890abcdef1234567890abcdef12';
const HASH_B = '1234567890abcdef1234567890abcdef12345678';

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - (hours * 3600 + 60) * 1000).toISOString();
}

function commit(overrides: Partial<GitLogCommit> & { hash: string }): GitLogCommit {
  return {
    subject: 'a commit',
    author: 'Alice',
    dateIso: hoursAgoIso(3),
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    ...overrides,
  };
}

function report(overrides: Partial<GitLogReport> = {}): GitLogReport {
  return {
    branch: 'main',
    commits: [
      commit({ hash: HASH_A, subject: 'feat: add thing', additions: 10, deletions: 2 }),
      commit({ hash: HASH_B, subject: 'fix: correct thing', author: 'Bob', additions: 0, deletions: 5 }),
    ],
    ...overrides,
  };
}

interface MakeOptions {
  readonly report?: GitLogReport;
  readonly filter?: string;
  readonly onClose?: () => void;
  readonly onOpenCommit?: (commit: GitLogCommit) => void;
}

function makeBrowser(options: MakeOptions = {}): CommitBrowserComponent {
  return new CommitBrowserComponent({
    report: options.report ?? report(),
    filter: options.filter,
    onClose: options.onClose ?? vi.fn(),
    onOpenCommit: options.onOpenCommit ?? vi.fn(),
  });
}

function renderedLines(browser: CommitBrowserComponent, width = 100): string[] {
  return browser.render(width).map(strip);
}

function selectedLine(lines: string[]): string {
  return lines.find((line) => line.includes(POINTER)) ?? '';
}

describe('CommitBrowserComponent', () => {
  it('renders the header with branch, commit count, and filter', () => {
    const header = renderedLines(makeBrowser({ filter: 'feat' }))[0] ?? '';
    expect(header).toContain('Commits');
    expect(header).toContain('⎇ main');
    expect(header).toContain('2 commits');
    expect(header).toContain('filter: feat');
  });

  it('singularizes a single commit', () => {
    const header = renderedLines(
      makeBrowser({ report: report({ commits: [commit({ hash: HASH_A })] }) }),
    )[0] ?? '';
    expect(header).toContain('1 commit');
  });

  it('renders rows with short hash, subject, and counts; first selected', () => {
    const lines = renderedLines(makeBrowser());
    const selected = selectedLine(lines);
    expect(selected).toContain('abcdef1'); // 7-char short hash
    expect(selected).toContain('feat: add thing');
    expect(selected).toContain('+10');
    expect(selected).toContain('−2');

    const second = lines.find((line) => line.includes('fix: correct thing')) ?? '';
    expect(second).toContain('1234567');
    expect(second).toContain('+0');
    expect(second).toContain('−5');
  });

  it('moves the selection with j/k and arrow keys', () => {
    const browser = makeBrowser();
    expect(selectedLine(renderedLines(browser))).toContain('feat: add thing');

    browser.handleInput('j');
    expect(selectedLine(renderedLines(browser))).toContain('fix: correct thing');

    browser.handleInput(DOWN); // already at the last row; stays put
    expect(selectedLine(renderedLines(browser))).toContain('fix: correct thing');

    browser.handleInput('k');
    expect(selectedLine(renderedLines(browser))).toContain('feat: add thing');

    browser.handleInput(UP); // already at the first row; stays put
    expect(selectedLine(renderedLines(browser))).toContain('feat: add thing');
  });

  it('opens the selected commit with enter, passing the full hash', () => {
    const onOpenCommit = vi.fn();
    const browser = makeBrowser({ onOpenCommit });
    browser.handleInput('j'); // select the second commit
    browser.handleInput(ENTER);
    expect(onOpenCommit).toHaveBeenCalledTimes(1);
    expect(onOpenCommit.mock.calls[0]?.[0]?.hash).toBe(HASH_B);
  });

  it('opens the selected commit with l', () => {
    const onOpenCommit = vi.fn();
    const browser = makeBrowser({ onOpenCommit });
    browser.handleInput('l');
    expect(onOpenCommit).toHaveBeenCalledTimes(1);
    expect(onOpenCommit.mock.calls[0]?.[0]?.hash).toBe(HASH_A);
  });

  it('closes on esc and q', () => {
    const onClose = vi.fn();
    const browser = makeBrowser({ onClose });
    browser.handleInput(ESC);
    expect(onClose).toHaveBeenCalledTimes(1);
    browser.handleInput('q');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows the empty message when there are no commits', () => {
    const joined = renderedLines(makeBrowser({ report: report({ commits: [] }) })).join('\n');
    expect(joined).toContain('No commits');
  });

  it('shows the no-match message when a filter matched nothing', () => {
    const joined = renderedLines(
      makeBrowser({ report: report({ commits: [] }), filter: 'zzz' }),
    ).join('\n');
    expect(joined).toContain('No commits match "zzz"');
  });
});
