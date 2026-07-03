import type {
  AutocompleteItem,
  AutocompleteProvider,
} from './autocomplete';
import type { RendererEditorCursor } from './editor-text-input';
import { Key, matchesKey } from './input-keys';
import { truncateToWidth } from './text-component';

export interface RendererEditorAutocompleteSource {
  getLines(): string[];
  getCursor(): RendererEditorCursor;
}

export interface RendererEditorAutocompleteOptions {
  readonly requestRender?: () => void;
  readonly maxVisible?: number;
}

export interface RendererEditorAutocompleteRequestOptions {
  readonly force?: boolean;
}

export interface RendererEditorAutocompleteCompletion {
  readonly lines: string[];
  readonly cursorLine: number;
  readonly cursorCol: number;
}

export interface RendererEditorAutocompleteInputResult {
  readonly handled: boolean;
  readonly completion?: RendererEditorAutocompleteCompletion;
}

interface RendererEditorAutocompleteState {
  readonly prefix: string;
  readonly items: readonly AutocompleteItem[];
  selectedIndex: number;
}

const DEFAULT_AUTOCOMPLETE_MAX_VISIBLE = 6;

export class RendererEditorAutocompleteController {
  private readonly maxVisible: number;
  private provider: AutocompleteProvider | undefined;
  private abort: AbortController | undefined;
  private requestId = 0;
  private state: RendererEditorAutocompleteState | undefined;

  constructor(private readonly options: RendererEditorAutocompleteOptions = {}) {
    this.maxVisible = normalizeAutocompleteMaxVisible(options.maxVisible);
  }

  setProvider(provider: AutocompleteProvider | undefined): void {
    this.provider = provider;
    this.close(false);
  }

  isOpen(): boolean {
    return this.state !== undefined;
  }

  selectedItem(): AutocompleteItem | undefined {
    const state = this.state;
    return state?.items[state.selectedIndex];
  }

  async request(
    source: RendererEditorAutocompleteSource,
    options: RendererEditorAutocompleteRequestOptions = {},
  ): Promise<void> {
    const provider = this.provider;
    if (provider === undefined) {
      this.close(false);
      return;
    }

    this.abort?.abort();
    const requestId = ++this.requestId;
    const abort = new AbortController();
    this.abort = abort;
    const cursor = source.getCursor();

    try {
      const suggestions = await provider.getSuggestions(
        source.getLines(),
        cursor.line,
        cursor.col,
        { signal: abort.signal, force: options.force },
      );
      if (abort.signal.aborted || requestId !== this.requestId) return;

      this.state =
        suggestions === null || suggestions.items.length === 0
          ? undefined
          : {
              prefix: suggestions.prefix,
              items: suggestions.items,
              selectedIndex: bestAutocompleteIndex(
                suggestions.items,
                suggestions.prefix,
              ),
            };
      this.options.requestRender?.();
    } catch {
      if (requestId !== this.requestId) return;
      this.state = undefined;
      this.options.requestRender?.();
    } finally {
      if (this.abort === abort) this.abort = undefined;
    }
  }

  handleInput(
    data: string,
    source: RendererEditorAutocompleteSource,
  ): RendererEditorAutocompleteInputResult {
    const state = this.state;
    if (state === undefined) return { handled: false };

    if (matchesKey(data, Key.up)) {
      state.selectedIndex =
        state.selectedIndex === 0
          ? Math.max(0, state.items.length - 1)
          : state.selectedIndex - 1;
      this.options.requestRender?.();
      return { handled: true };
    }

    if (matchesKey(data, Key.down)) {
      state.selectedIndex =
        state.selectedIndex >= state.items.length - 1
          ? 0
          : state.selectedIndex + 1;
      this.options.requestRender?.();
      return { handled: true };
    }

    if (matchesKey(data, Key.tab) || matchesKey(data, Key.enter)) {
      const completion = this.applySelected(source);
      return completion === undefined
        ? { handled: true }
        : { handled: true, completion };
    }

    if (matchesKey(data, Key.escape)) {
      this.close(true);
      return { handled: true };
    }

    return { handled: false };
  }

  applySelected(
    source: RendererEditorAutocompleteSource,
  ): RendererEditorAutocompleteCompletion | undefined {
    const state = this.state;
    const provider = this.provider;
    if (state === undefined || provider === undefined) return undefined;

    const item = state.items[state.selectedIndex];
    if (item === undefined) return undefined;

    const cursor = source.getCursor();
    const result = provider.applyCompletion(
      source.getLines(),
      cursor.line,
      cursor.col,
      item,
      state.prefix,
    );
    this.close(false);
    this.options.requestRender?.();
    return {
      lines: [...result.lines],
      cursorLine: result.cursorLine,
      cursorCol: result.cursorCol,
    };
  }

  close(requestRender = false): boolean {
    if (this.state === undefined && this.abort === undefined) return false;
    this.abort?.abort();
    this.abort = undefined;
    this.requestId++;
    this.state = undefined;
    if (requestRender) this.options.requestRender?.();
    return true;
  }

  lines(width: number): readonly string[] {
    const state = this.state;
    if (state === undefined) return [];

    const safeWidth = Math.max(1, Math.floor(width));
    const startIndex = autocompleteWindowStart(
      state.selectedIndex,
      state.items.length,
      this.maxVisible,
    );
    const endIndex = Math.min(state.items.length, startIndex + this.maxVisible);
    const lines: string[] = [];

    for (let index = startIndex; index < endIndex; index++) {
      const item = state.items[index];
      if (item === undefined) continue;
      lines.push(renderAutocompleteItem(item, index === state.selectedIndex, safeWidth));
    }

    if (startIndex > 0 || endIndex < state.items.length) {
      lines.push(
        truncateToWidth(`  (${state.selectedIndex + 1}/${state.items.length})`, safeWidth, ''),
      );
    }
    return lines;
  }
}

function normalizeAutocompleteMaxVisible(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_AUTOCOMPLETE_MAX_VISIBLE;
  }
  return Math.floor(value);
}

function bestAutocompleteIndex(
  items: readonly AutocompleteItem[],
  prefix: string,
): number {
  const normalizedPrefix = prefix.startsWith('/') ? prefix.slice(1) : prefix;
  const exact = items.findIndex((item) => item.value === normalizedPrefix);
  return Math.max(exact, 0);
}

function autocompleteWindowStart(
  selectedIndex: number,
  itemCount: number,
  maxVisible: number,
): number {
  return Math.max(
    0,
    Math.min(selectedIndex - Math.floor(maxVisible / 2), itemCount - maxVisible),
  );
}

function renderAutocompleteItem(
  item: AutocompleteItem,
  selected: boolean,
  width: number,
): string {
  const prefix = selected ? '→ ' : '  ';
  const label = item.label || item.value;
  const description = item.description?.replaceAll(/[\r\n]+/g, ' ').trim();
  const suffix =
    description === undefined || description.length === 0 ? '' : `  ${description}`;
  return truncateToWidth(`${prefix}${label}${suffix}`, width, '');
}
