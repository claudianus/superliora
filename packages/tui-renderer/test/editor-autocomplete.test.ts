import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(controller.overlayLines(24).map(cellsToText)[0]).toContain('❯ help');
    expect(controller.overlayLines(24).map(cellsToText)[1]).toContain('history');
    expect(controller.lines(24)[2]).toBe('  (1/3)');
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
    expect(cellsToText(controller.overlayLines(20)[0] ?? [])).toContain('❯ latest');
  });

  it('routes structured native key events for autocomplete navigation', async () => {
    const controller = new RendererEditorAutocompleteController();
    controller.setProvider(providerReturning([
      { value: 'help', label: 'help' },
      { value: 'history', label: 'history' },
    ]));
    const source = new TestAutocompleteSource('/');

    await controller.request(source);
    expect(controller.handleNativeInput({
      type: 'key',
      key: 'down',
      raw: '\u001B[B',
      eventType: 'press',
    }, source).handled).toBe(true);
    expect(controller.handleNativeInput({
      type: 'key',
      key: 'enter',
      raw: '\r',
      eventType: 'press',
    }, source)).toMatchObject({
      handled: true,
      completion: {
        lines: ['/history '],
        cursorLine: 0,
        cursorCol: 9,
      },
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('coalesces rapid requests into a single provider call', async () => {
      const provider = providerReturning([{ value: 'help', label: 'help' }]);
      const getSuggestions = provider.getSuggestions as ReturnType<typeof vi.fn>;
      const controller = new RendererEditorAutocompleteController({ debounceMs: 80 });
      controller.setProvider(provider);
      const source = new TestAutocompleteSource('/h');

      // Simulate rapid typing: three requests arrive before the debounce
      // window elapses.
      void controller.request(source);
      void controller.request(source);
      void controller.request(source);

      // Provider should not have been queried yet.
      expect(getSuggestions).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(80);

      expect(getSuggestions).toHaveBeenCalledTimes(1);
      expect(controller.isOpen()).toBe(true);
    });

    it('queries immediately when force is true', async () => {
      const provider = providerReturning([{ value: 'help', label: 'help' }]);
      const getSuggestions = provider.getSuggestions as ReturnType<typeof vi.fn>;
      const controller = new RendererEditorAutocompleteController({ debounceMs: 80 });
      controller.setProvider(provider);
      const source = new TestAutocompleteSource('/');

      await controller.request(source, { force: true });

      expect(getSuggestions).toHaveBeenCalledTimes(1);
      expect(controller.isOpen()).toBe(true);
    });

    it('clears pending timers on close', async () => {
      const provider = providerReturning([{ value: 'help', label: 'help' }]);
      const getSuggestions = provider.getSuggestions as ReturnType<typeof vi.fn>;
      const controller = new RendererEditorAutocompleteController({ debounceMs: 80 });
      controller.setProvider(provider);

      void controller.request(new TestAutocompleteSource('/'));
      controller.close(false);

      await vi.advanceTimersByTimeAsync(80);

      expect(getSuggestions).not.toHaveBeenCalled();
      expect(controller.isOpen()).toBe(false);
    });
  });
});

function cellsToText(cells: readonly { char: string }[] | string): string {
  if (typeof cells === 'string') return cells;
  return cells.map((cell) => cell.char).join('');
}
