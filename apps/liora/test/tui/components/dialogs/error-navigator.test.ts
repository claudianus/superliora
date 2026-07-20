import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ErrorNavigatorComponent } from '#/tui/components/dialogs/error-navigator';
import type { TranscriptErrorItem } from '#/tui/utils/transcript-errors';

const previousChalkLevel = chalk.level;
beforeAll(() => {
  chalk.level = 3;
});
afterAll(() => {
  chalk.level = previousChalkLevel;
});

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const DOWN = '\u001B[B';
const ENTER = '\r';
const ESC = '\u001B';
const BACKSPACE = '\u007F';
const POINTER = '❯';

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function item(overrides: Partial<TranscriptErrorItem> & { index: number }): TranscriptErrorItem {
  return {
    entryId: `entry-${String(overrides.index)}`,
    source: 'tool',
    toolName: 'Bash',
    summary: 'command failed',
    ...overrides,
  };
}

interface MakeOptions {
  readonly items?: readonly TranscriptErrorItem[];
  readonly onSelect?: (item: TranscriptErrorItem) => void;
  readonly onCancel?: () => void;
}

function defaultItems(): TranscriptErrorItem[] {
  return [
    item({ index: 2, toolName: 'Bash', summary: 'command not found: pnpmx' }),
    item({ index: 17, toolName: 'Read', summary: 'file not found: src/missing.ts' }),
  ];
}

function makeNavigator(options: MakeOptions = {}): ErrorNavigatorComponent {
  return new ErrorNavigatorComponent({
    items: options.items ?? defaultItems(),
    onSelect: options.onSelect ?? vi.fn(),
    onCancel: options.onCancel ?? vi.fn(),
  });
}

function renderedLines(navigator: ErrorNavigatorComponent, width = 100): string[] {
  return navigator.render(width).map(strip);
}

function selectedLine(lines: string[]): string {
  return lines.find((line) => line.includes(POINTER)) ?? '';
}

describe('ErrorNavigatorComponent', () => {
  it('renders one row per error with 1-based transcript positions', () => {
    const lines = renderedLines(makeNavigator());
    const joined = lines.join('\n');

    expect(joined).toContain('#3');
    expect(joined).toContain('Bash');
    expect(joined).toContain('command not found: pnpmx');
    expect(joined).toContain('#18');
    expect(joined).toContain('Read');
    expect(joined).toContain('file not found: src/missing.ts');
    expect(joined).toContain('Session errors');
    expect(joined).toContain('2 errors');
  });

  it('renders status errors without a tool name', () => {
    const navigator = makeNavigator({
      items: [item({ index: 5, source: 'status', toolName: undefined, summary: 'model quota exhausted' })],
    });

    const joined = renderedLines(navigator).join('\n');
    expect(joined).toContain('#6 model quota exhausted');
  });

  it('narrows rows while typing and restores them on backspace', () => {
    const navigator = makeNavigator();
    for (const ch of 'read') navigator.handleInput(ch);

    let joined = renderedLines(navigator).join('\n');
    expect(joined).toContain('#18');
    expect(joined).toContain('file not found: src/missing.ts');
    expect(joined).not.toContain('command not found: pnpmx');
    expect(joined).toContain('filter: read');

    for (let i = 0; i < 4; i++) navigator.handleInput(BACKSPACE);
    joined = renderedLines(navigator).join('\n');
    expect(joined).toContain('command not found: pnpmx');
    expect(joined).toContain('file not found: src/missing.ts');
  });

  it('reports the original transcript index on select', () => {
    const onSelect = vi.fn();
    const navigator = makeNavigator({ onSelect });

    navigator.handleInput(DOWN);
    navigator.handleInput(ENTER);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.index).toBe(17);
  });

  it('selects from the filtered subset while a filter is active', () => {
    const onSelect = vi.fn();
    const navigator = makeNavigator({ onSelect });

    for (const ch of 'read') navigator.handleInput(ch);
    navigator.handleInput(ENTER);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.index).toBe(17);
  });

  it('closes on escape without selecting', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const navigator = makeNavigator({ onSelect, onCancel });

    navigator.handleInput(ESC);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the selection pointer on the first visible row', () => {
    const navigator = makeNavigator();
    expect(selectedLine(renderedLines(navigator))).toContain('#3');

    navigator.handleInput(DOWN);
    expect(selectedLine(renderedLines(navigator))).toContain('#18');
  });

  it('renders an empty state when there are no errors', () => {
    const joined = renderedLines(makeNavigator({ items: [] })).join('\n');
    expect(joined).toContain('No errors in this session transcript.');
  });

  it('renders a no-match state when the filter excludes everything', () => {
    const navigator = makeNavigator();
    for (const ch of 'zzz') navigator.handleInput(ch);

    const joined = renderedLines(navigator).join('\n');
    expect(joined).toContain('No matching errors');
    expect(joined).not.toContain(POINTER);
  });
});
