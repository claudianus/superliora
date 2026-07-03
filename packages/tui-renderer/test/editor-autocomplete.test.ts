import { describe, expect, it, vi } from 'vitest';

import {
  RendererEditorAutocompleteController,
  type AutocompleteItem,
  type AutocompleteProvider,
  type RendererEditorAutocompleteSource,
  type RendererEditorCursor,
} from '../src';

class TestAutocompleteSource implements RendererEditorAutocompleteSource {
  lines: string[];
  cursor: RendererEditorCursor;

  constructor(text: string) {
    this.lines = text.split('\n');
    this.cursor = { line: 0, col: text.length };
  }

  getLines(): string[] {
    return [...this.lines];
  }

  getCursor(): RendererEditorCursor {
    return this.cursor;
  }
}

function providerReturning(items: AutocompleteItem[]): AutocompleteProvider {
  return {
    getSuggestions: vi.fn(async () => ({ items, prefix: '/' })),
    applyCompletion: vi.fn((lines, cursorLine, cursorCol, item, prefix) => {
      const line = lines[cursorLine] ?? '';
      const beforePrefix = line.slice(0, cursorCol - prefix.length);
      const afterCursor = line.slice(cursorCol);
      const next = `${beforePrefix}/${item.value} ${afterCursor}`;
      return {
        lines: [next],
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + 2,
      };
    }),
  };
}

describe('RendererEditorAutocompleteController', () => {
  it('requests suggestions, picks the best match, and renders a bounded overlay', async () => {
    const requestRender = vi.fn();
    const controller = new RendererEditorAutocompleteController({
      requestRender,
      maxVisible: 2,
    });
    controller.setProvider(providerReturning([
      { value: 'help', label: 'help', description: 'Show help' },
      { value: 'history', label: 'history', description: 'Show history' },
      { value: 'quit', label: 'quit', description: 'Exit' },
    ]));

    await controller.request(new TestAutocompleteSource('/'));

    expect(controller.isOpen()).toBe(true);
    expect(requestRender).toHaveBeenCalledOnce();
    expect(controller.lines(24)).toEqual([
      '→ help  Show help',
      '  history  Show history',
      '  (1/3)',
    ]);
  });

  it('moves selection and returns a completion without mutating the source', async () => {
    const controller = new RendererEditorAutocompleteController();
    const source = new TestAutocompleteSource('/');
    const provider = providerReturning([
      { value: 'help', label: 'help' },
      { value: 'history', label: 'history' },
    ]);
    controller.setProvider(provider);

    await controller.request(source);
    expect(controller.handleInput('\u001B[B', source)).toEqual({ handled: true });

    const result = controller.handleInput('\t', source);

    expect(result).toEqual({
      handled: true,
      completion: {
        lines: ['/history '],
        cursorLine: 0,
        cursorCol: '/history '.length,
      },
    });
    expect(source.getLines()).toEqual(['/']);
    expect(controller.isOpen()).toBe(false);
  });

  it('aborts stale requests and keeps the latest suggestions', async () => {
    const source = new TestAutocompleteSource('/');
    const controller = new RendererEditorAutocompleteController();
    let firstSignal: AbortSignal | undefined;
    let resolveFirst:
      | ((value: { readonly items: AutocompleteItem[]; readonly prefix: string }) => void)
      | undefined;
    const first = new Promise<{
      readonly items: AutocompleteItem[];
      readonly prefix: string;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const provider: AutocompleteProvider = {
      getSuggestions: vi.fn((_, __, ___, options) => {
        if (firstSignal === undefined) {
          firstSignal = options.signal;
          return first;
        }
        return Promise.resolve({
          prefix: '/',
          items: [{ value: 'latest', label: 'latest' }],
        });
      }),
      applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({
        lines,
        cursorLine,
        cursorCol,
      })),
    };
    controller.setProvider(provider);

    const firstRequest = controller.request(source);
    const secondRequest = controller.request(source);
    await secondRequest;
    resolveFirst?.({
      prefix: '/',
      items: [{ value: 'stale', label: 'stale' }],
    });
    await firstRequest;

    expect(firstSignal?.aborted).toBe(true);
    expect(controller.lines(20)).toEqual(['→ latest']);
  });
});
