import type {
  AutocompleteItem,
  AutocompleteProvider,
} from './autocomplete';
import type { RendererCell, RendererCellStyle } from './cell-buffer';
import type { RendererRegionLine } from './compositor';
import type { NativeInputKeyEvent } from './input-events';
import type { RendererEditorCursor } from './editor-text-input';
import { Key, matchesKey } from './input-keys';
import {
  createRendererStyledTextCells,
  truncateRendererStyledTextRuns,
  type RendererStyledTextRun,
} from './styled-text';
import { RENDERER_SELECT_POINTER } from './symbols';

export { RENDERER_SELECT_POINTER } from './symbols';

export interface RendererEditorAutocompleteLineStyles {
  readonly text?: RendererCellStyle;
  readonly selected?: RendererCellStyle;
  readonly description?: RendererCellStyle;
  readonly scroll?: RendererCellStyle;
}

export interface RendererEditorAutocompleteSource {
  getLines(): string[];
  getCursor(): RendererEditorCursor;
}

export interface RendererEditorAutocompleteOptions {
  readonly requestRender?: () => void;
  readonly maxVisible?: number;
  readonly lineStyles?: RendererEditorAutocompleteLineStyles;
  /**
   * Delay (ms) before the autocomplete provider is queried after the last text
   * change. While the timer is pending, new requests reset it. `force: true`
   * bypasses the delay and queries immediately. Defaults to 0 (no debounce),
   * preserving the legacy synchronous behavior.
   */
  readonly debounceMs?: number;
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
  private readonly debounceMs: number;
  private lineStyles: RendererEditorAutocompleteLineStyles;
  private provider: AutocompleteProvider | undefined;
  private abort: AbortController | undefined;
  private requestId = 0;
  private state: RendererEditorAutocompleteState | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: RendererEditorAutocompleteOptions = {}) {
    this.maxVisible = normalizeAutocompleteMaxVisible(options.maxVisible);
    this.debounceMs = normalizeAutocompleteDebounceMs(options.debounceMs);
    this.lineStyles = options.lineStyles ?? {};
  }

  setLineStyles(styles: RendererEditorAutocompleteLineStyles): void {
    this.lineStyles = styles;
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

    // Debounce non-forced requests so that rapid typing (notably IME
    // composition languages like Korean) does not spawn a provider query —
    // and its potential disk I/O / fd process — for every keystroke.
    if (this.debounceMs > 0 && options.force !== true) {
      this.clearDebounceTimer();
      return new Promise<void>((resolve) => {
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = undefined;
          this.executeRequest(source, provider, options).finally(resolve);
        }, this.debounceMs);
      });
    }

    this.clearDebounceTimer();
    return this.executeRequest(source, provider, options);
  }

  private async executeRequest(
    source: RendererEditorAutocompleteSource,
    provider: AutocompleteProvider,
    options: RendererEditorAutocompleteRequestOptions,
  ): Promise<void> {
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
    if (matchesKey(data, Key.up)) {
      return this.handleNativeInput(
        { type: 'key', key: 'up', raw: data, eventType: 'press', ctrl: false, alt: false, shift: false },
        source,
      );
    }
    if (matchesKey(data, Key.down)) {
      return this.handleNativeInput(
        { type: 'key', key: 'down', raw: data, eventType: 'press', ctrl: false, alt: false, shift: false },
        source,
      );
    }
    if (matchesKey(data, Key.tab)) {
      return this.handleNativeInput(
        { type: 'key', key: 'tab', raw: data, eventType: 'press', ctrl: false, alt: false, shift: false },
        source,
      );
    }
    if (matchesKey(data, Key.enter)) {
      return this.handleNativeInput(
        { type: 'key', key: 'enter', raw: data, eventType: 'press', ctrl: false, alt: false, shift: false },
        source,
      );
    }
    if (matchesKey(data, Key.escape)) {
      return this.handleNativeInput(
        { type: 'key', key: 'escape', raw: data, eventType: 'press', ctrl: false, alt: false, shift: false },
        source,
      );
    }
    return { handled: false };
  }

  handleNativeInput(
    event: NativeInputKeyEvent,
    source: RendererEditorAutocompleteSource,
  ): RendererEditorAutocompleteInputResult {
    if (event.eventType === 'release') return { handled: false };
    const state = this.state;
    if (state === undefined) return { handled: false };

    if (event.key === 'up' && event.ctrl !== true && event.alt !== true) {
      state.selectedIndex =
        state.selectedIndex === 0
          ? Math.max(0, state.items.length - 1)
          : state.selectedIndex - 1;
      this.options.requestRender?.();
      return { handled: true };
    }

    if (event.key === 'down' && event.ctrl !== true && event.alt !== true) {
      state.selectedIndex =
        state.selectedIndex >= state.items.length - 1
          ? 0
          : state.selectedIndex + 1;
      this.options.requestRender?.();
      return { handled: true };
    }

    if (event.key === 'tab' || event.key === 'enter') {
      const completion = this.applySelected(source);
      return completion === undefined
        ? { handled: true }
        : { handled: true, completion };
    }

    if (event.key === 'escape') {
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
    const hadState = this.state !== undefined || this.abort !== undefined;
    this.clearDebounceTimer();
    this.abort?.abort();
    this.abort = undefined;
    this.requestId++;
    this.state = undefined;
    if (requestRender) this.options.requestRender?.();
    return hadState;
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer === undefined) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
  }

  overlayLines(
    width: number,
    styles: RendererEditorAutocompleteLineStyles = this.lineStyles,
  ): readonly RendererRegionLine[] {
    const state = this.state;
    if (state === undefined) return [];

    const safeWidth = Math.max(1, Math.floor(width));
    const startIndex = autocompleteWindowStart(
      state.selectedIndex,
      state.items.length,
      this.maxVisible,
    );
    const endIndex = Math.min(state.items.length, startIndex + this.maxVisible);
    const lines: RendererRegionLine[] = [];

    for (let index = startIndex; index < endIndex; index++) {
      const item = state.items[index];
      if (item === undefined) continue;
      lines.push(renderAutocompleteOverlayLine(
        item,
        index === state.selectedIndex,
        safeWidth,
        styles,
      ));
    }

    if (startIndex > 0 || endIndex < state.items.length) {
      lines.push(renderAutocompleteScrollLine(
        state.selectedIndex + 1,
        state.items.length,
        safeWidth,
        styles,
      ));
    }
    return lines;
  }

  /** @deprecated Use {@link overlayLines} for styled cell output. */
  lines(width: number): readonly string[] {
    return this.overlayLines(width).map(regionLineToPlainText);
  }
}

function normalizeAutocompleteMaxVisible(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_AUTOCOMPLETE_MAX_VISIBLE;
  }
  return Math.floor(value);
}

function normalizeAutocompleteDebounceMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
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

function renderAutocompleteOverlayLine(
  item: AutocompleteItem,
  selected: boolean,
  width: number,
  styles: RendererEditorAutocompleteLineStyles,
): readonly RendererCell[] {
  const textStyle = styles.text;
  const selectedStyle = styles.selected ?? textStyle;
  const descriptionStyle = styles.description ?? textStyle;
  const pointer = selected ? RENDERER_SELECT_POINTER : ' ';
  const label = item.label || item.value;
  const description = item.description?.replaceAll(/[\r\n]+/g, ' ').trim();
  const runs: RendererStyledTextRun[] = [
    { text: '  ', style: textStyle },
    { text: pointer, style: selected ? selectedStyle : textStyle },
    { text: ' ', style: textStyle },
    { text: label, style: selected ? selectedStyle : textStyle },
  ];
  if (description !== undefined && description.length > 0) {
    runs.push({ text: '  ', style: textStyle });
    runs.push({ text: description, style: descriptionStyle });
  }
  return createRendererStyledTextCells(
    truncateRendererStyledTextRuns(runs, { width }),
  );
}

function renderAutocompleteScrollLine(
  selectedOneBased: number,
  total: number,
  width: number,
  styles: RendererEditorAutocompleteLineStyles,
): readonly RendererCell[] {
  return createRendererStyledTextCells(
    truncateRendererStyledTextRuns(
      [{ text: `  (${selectedOneBased}/${total})`, style: styles.scroll ?? styles.description ?? styles.text }],
      { width },
    ),
  );
}

function regionLineToPlainText(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}
