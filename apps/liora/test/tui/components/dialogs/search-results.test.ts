import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Force CI mode to disable ambient effects for deterministic rendering.
process.env['CI'] = '1';

import { SearchResultsComponent } from '#/tui/components/dialogs/search-results';
import type { SearchMatch, SearchResults } from '#/utils/fs/project-search';

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

function match(path: string, line: number, text: string): SearchMatch {
  return { path, line, text };
}

function results(overrides: Partial<SearchResults> = {}): SearchResults {
  return {
    pattern: 'alpha',
    matches: [
      match('src/app.ts', 3, 'const alpha = 1;'),
      match('src/app.ts', 9, 'let alpha2 = 2;'),
      match('src/lib.ts', 12, 'export const alpha = 3;'),
    ],
    fileCount: 2,
    truncated: false,
    engine: 'builtin',
    ...overrides,
  };
}

interface MakeOptions {
  readonly results?: SearchResults;
  readonly onClose?: () => void;
  readonly onOpenMatch?: (match: SearchMatch) => void;
  readonly maxVisible?: number;
}

function makePanel(options: MakeOptions = {}): SearchResultsComponent {
  return new SearchResultsComponent({
    results: options.results ?? results(),
    onClose: options.onClose ?? vi.fn(),
    onOpenMatch: options.onOpenMatch ?? vi.fn(),
    maxVisible: options.maxVisible,
  });
}

function renderedLines(panel: SearchResultsComponent, width = 100): string[] {
  return panel.render(width).map(strip);
}

function pointerLine(panel: SearchResultsComponent): string {
  return renderedLines(panel).find((line) => line.includes(POINTER)) ?? '';
}

describe('SearchResultsComponent', () => {
  it('renders the header with pattern, counts, engine, and truncated marker', () => {
    const header = renderedLines(makePanel({ results: results({ truncated: true }) }))[0] ?? '';
    expect(header).toContain('Search');
    expect(header).toContain('"alpha"');
    expect(header).toContain('3 matches in 2 files');
    expect(header).toContain('builtin');
    expect(header).toContain('(truncated)');
  });

  it('singularizes counts for a single match in a single file', () => {
    const single = results({
      matches: [match('only.ts', 1, 'alpha')],
      fileCount: 1,
    });
    const header = renderedLines(makePanel({ results: single }))[0] ?? '';
    expect(header).toContain('1 match in 1 file');
  });

  it('groups match rows under dim file header rows', () => {
    const lines = renderedLines(makePanel());
    expect(lines.some((line) => line.includes('src/app.ts (2)'))).toBe(true);
    expect(lines.some((line) => line.includes('src/lib.ts (1)'))).toBe(true);
    expect(lines.some((line) => line.includes('3: const alpha = 1;'))).toBe(true);
    expect(lines.some((line) => line.includes('12: export const alpha = 3;'))).toBe(true);
  });

  it('selects the first match row initially, not its file header', () => {
    const selected = pointerLine(makePanel());
    expect(selected).toContain('3: const alpha = 1;');
    expect(selected).not.toContain('(2)');
  });

  it('moves with j/k and skips file header rows', () => {
    const panel = makePanel();

    panel.handleInput('j');
    expect(pointerLine(panel)).toContain('9: let alpha2 = 2;');

    // Next match is in the second file — the `src/lib.ts (1)` header is skipped.
    panel.handleInput(DOWN);
    expect(pointerLine(panel)).toContain('12: export const alpha = 3;');

    // Back up also skips the header.
    panel.handleInput('k');
    expect(pointerLine(panel)).toContain('9: let alpha2 = 2;');

    panel.handleInput(UP);
    expect(pointerLine(panel)).toContain('3: const alpha = 1;');

    // Already at the first match — stays put.
    panel.handleInput('k');
    expect(pointerLine(panel)).toContain('3: const alpha = 1;');
  });

  it('opens the selected match on enter with path and line', () => {
    const onOpenMatch = vi.fn();
    const panel = makePanel({ onOpenMatch });

    panel.handleInput(ENTER);

    expect(onOpenMatch).toHaveBeenCalledWith({
      path: 'src/app.ts',
      line: 3,
      text: 'const alpha = 1;',
    });
  });

  it('opens the selected match on l after moving down', () => {
    const onOpenMatch = vi.fn();
    const panel = makePanel({ onOpenMatch });

    panel.handleInput('j');
    panel.handleInput('l');

    expect(onOpenMatch).toHaveBeenCalledWith({
      path: 'src/app.ts',
      line: 9,
      text: 'let alpha2 = 2;',
    });
  });

  it('shows a dim empty-state message when nothing matched', () => {
    const empty = results({ matches: [], fileCount: 0 });
    const lines = renderedLines(makePanel({ results: empty }));
    expect(lines.some((line) => line.includes('No matches for "alpha"'))).toBe(true);
  });

  it('never opens a match on empty results', () => {
    const onOpenMatch = vi.fn();
    const panel = makePanel({ results: results({ matches: [], fileCount: 0 }), onOpenMatch });
    panel.handleInput(ENTER);
    expect(onOpenMatch).not.toHaveBeenCalled();
  });

  it('closes on esc and q', () => {
    const onClose = vi.fn();
    const panel = makePanel({ onClose });
    panel.handleInput(ESC);
    expect(onClose).toHaveBeenCalledTimes(1);

    panel.handleInput('q');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders footer hints', () => {
    const footer = renderedLines(makePanel()).at(-1) ?? '';
    expect(footer).toContain('j/k');
    expect(footer).toContain('enter');
    expect(footer).toContain('esc');
  });
});
