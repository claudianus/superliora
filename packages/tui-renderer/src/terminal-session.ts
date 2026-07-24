import {
  ANSI_HIDE_CURSOR,
  ANSI_SHOW_CURSOR,
  type RendererTerminalOutputOptions,
} from './terminal-output';
import {
  encodeRendererClearInlineImages,
  type RendererInlineImageProtocol,
} from './terminal-graphics';
import {
  mergeNativeTerminalFeatureOptions,
  type NativeTerminalFeatureOptions,
  type NativeTerminalFeatureInput,
} from './terminal-features';
import type { RendererOutputTarget } from './native-frame';

export type NativeTerminalScreenMode = 'main' | 'alternate';
export type NativeTerminalKeyboardProtocol = 'kitty';
export type NativeTerminalMouseTracking = 'sgr';

export interface NativeTerminalInput {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(raw: boolean): void;
  setEncoding?(encoding: BufferEncoding): void;
  resume?(): void;
  pause?(): void;
  on(event: 'data' | 'resize', listener: (...args: unknown[]) => void): unknown;
  off?(event: 'data' | 'resize', listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: 'data' | 'resize', listener: (...args: unknown[]) => void): unknown;
}

export interface NativeTerminalOutput extends RendererOutputTarget {
  readonly columns?: number;
  readonly rows?: number;
  on?(event: 'resize' | 'drain', listener: (...args: unknown[]) => void): unknown;
  off?(event: 'resize' | 'drain', listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: 'resize' | 'drain', listener: (...args: unknown[]) => void): unknown;
}

export interface NativeTerminalSessionOptions extends RendererTerminalOutputOptions {
  readonly features?: NativeTerminalFeatureInput;
  readonly input?: NativeTerminalInput;
  readonly output: NativeTerminalOutput;
  readonly screenMode?: NativeTerminalScreenMode;
  readonly keyboardProtocol?: NativeTerminalKeyboardProtocol;
  readonly mouseTracking?: NativeTerminalMouseTracking;
  readonly rawMode?: boolean;
  readonly bracketedPaste?: boolean;
  readonly focusEvents?: boolean;
  readonly clearOnStart?: boolean;
  readonly autoWrap?: boolean;
  readonly imageProtocol?: RendererInlineImageProtocol;
  readonly onInput?: (data: string | Buffer) => void;
  readonly onResize?: (size: NativeTerminalSize) => void;
}

export interface NativeTerminalSize {
  readonly columns: number;
  readonly rows: number;
}

export const ANSI_ENTER_ALTERNATE_SCREEN = '\u001B[?1049h';
export const ANSI_EXIT_ALTERNATE_SCREEN = '\u001B[?1049l';
export const ANSI_CLEAR_SCREEN = '\u001B[2J\u001B[H';
export const ANSI_ENABLE_BRACKETED_PASTE = '\u001B[?2004h';
export const ANSI_DISABLE_BRACKETED_PASTE = '\u001B[?2004l';
export const ANSI_ENABLE_FOCUS_EVENTS = '\u001B[?1004h';
export const ANSI_DISABLE_FOCUS_EVENTS = '\u001B[?1004l';
export const ANSI_ENABLE_MOUSE_TRACKING = '\u001B[?1000h';
/**
 * Button-event tracking: reports press/release plus motion while a button is
 * held. Plain 1000h only reports press/release, so drag gestures (transcript
 * text selection) never receive move events. 1002 supersedes 1000 on
 * xterm-compatible terminals; both are written so terminals that ignore 1002
 * keep press/release tracking.
 */
export const ANSI_ENABLE_MOUSE_BUTTON_EVENT_TRACKING = '\u001B[?1002h';
export const ANSI_DISABLE_MOUSE_TRACKING = '\u001B[?1000l';
export const ANSI_DISABLE_MOUSE_BUTTON_EVENT_TRACKING = '\u001B[?1002l';
export const ANSI_ENABLE_SGR_MOUSE_MODE = '\u001B[?1006h';
export const ANSI_DISABLE_SGR_MOUSE_MODE = '\u001B[?1006l';
// Flags: 0b1 disambiguate + 0b100 report alternate keys (base-layout-key).
// Alternate keys let Ctrl/Alt shortcuts match the PC-101 Latin key while an
// IME layout (Korean, Cyrillic, …) is active — without this, Ctrl+C arrives as
// the layout glyph and shortcut handlers never fire.
export const ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL = '\u001B[>5u';
export const ANSI_POP_KITTY_KEYBOARD_PROTOCOL = '\u001B[<u';

// Kitty pointer shape protocol (CSI 22 ; shape u / CSI 23 u)
export type KittyPointerShape =
  | 'default'
  | 'text'
  | 'pointer'
  | 'crosshair'
  | 'ew-resize'
  | 'ns-resize'
  | 'nwse-resize'
  | 'nesw-resize'
  | 'move'
  | 'not-allowed'
  | 'grab'
  | 'grabbing';

export function ansiPushPointerShape(shape: KittyPointerShape): string {
  return `\u001B[22;${shape}u`;
}

export const ANSI_POP_POINTER_SHAPE = '\u001B[23u';
export const ANSI_DISABLE_AUTO_WRAP = '\u001B[?7l';
export const ANSI_ENABLE_AUTO_WRAP = '\u001B[?7h';

export class NativeTerminalSession {
  private started = false;
  private previousRawMode: boolean | undefined;
  private cleanup: Array<() => void> = [];
  private readonly options: NativeTerminalSessionOptions;

  constructor(options: NativeTerminalSessionOptions) {
    this.options = mergeNativeTerminalFeatureOptions(options.features, options);
  }

  get size(): NativeTerminalSize {
    return {
      columns: normalizeTerminalSize(this.options.output.columns, 80),
      rows: normalizeTerminalSize(this.options.output.rows, 24),
    };
  }

  get features(): NativeTerminalFeatureOptions {
    return { ...this.options };
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    const { input, output } = this.options;
    if (this.options.screenMode === 'alternate') {
      output.write(ANSI_ENTER_ALTERNATE_SCREEN);
      this.cleanup.push(() => {
        output.write(ANSI_EXIT_ALTERNATE_SCREEN);
      });
    }
    if (this.options.clearOnStart === true) output.write(ANSI_CLEAR_SCREEN);
    if (this.options.autoWrap === false) {
      output.write(ANSI_DISABLE_AUTO_WRAP);
      this.cleanup.push(() => {
        output.write(ANSI_ENABLE_AUTO_WRAP);
      });
    }
    const inlineImageClear = encodeRendererClearInlineImages(this.options.imageProtocol ?? 'none');
    if (inlineImageClear.length > 0) output.write(inlineImageClear);
    if (this.options.hideCursor === true) {
      output.write(ANSI_HIDE_CURSOR);
      this.cleanup.push(() => {
        output.write(ANSI_SHOW_CURSOR);
      });
    }
    if (this.options.bracketedPaste === true) {
      output.write(ANSI_ENABLE_BRACKETED_PASTE);
      this.cleanup.push(() => {
        output.write(ANSI_DISABLE_BRACKETED_PASTE);
      });
    }
    if (this.options.focusEvents === true) {
      output.write(ANSI_ENABLE_FOCUS_EVENTS);
      this.cleanup.push(() => {
        output.write(ANSI_DISABLE_FOCUS_EVENTS);
      });
    }
    if (this.options.mouseTracking === 'sgr') {
      output.write(ANSI_ENABLE_MOUSE_TRACKING);
      this.cleanup.push(() => {
        output.write(ANSI_DISABLE_MOUSE_TRACKING);
      });
      output.write(ANSI_ENABLE_MOUSE_BUTTON_EVENT_TRACKING);
      this.cleanup.push(() => {
        output.write(ANSI_DISABLE_MOUSE_BUTTON_EVENT_TRACKING);
      });
      output.write(ANSI_ENABLE_SGR_MOUSE_MODE);
      this.cleanup.push(() => {
        output.write(ANSI_DISABLE_SGR_MOUSE_MODE);
      });
    }
    if (this.options.keyboardProtocol === 'kitty') {
      output.write(ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL);
      this.cleanup.push(() => {
        output.write(ANSI_POP_KITTY_KEYBOARD_PROTOCOL);
      });
    }

    if (input !== undefined) this.startInput(input);
    this.startResize(output);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    for (const cleanup of this.cleanup.splice(0).toReversed()) cleanup();
  }

  /**
   * Synchronously writes the full set of terminal disable/restore sequences
   * to the given output, swallowing any write errors. Intended for use from a
   * `process.on('exit')` handler so the user's terminal is restored even when
   * the normal `stop()` path is skipped (SIGHUP, dead-terminal EIO, mid-stop
   * throw). Writes are best-effort: an EIO on a dead pty is ignored so we never
   * enter a throw loop at process exit.
   */
  static writeRestoreSequencesSync(output: { write(chunk: string): unknown }): void {
    const sequence =
      ANSI_SHOW_CURSOR +
      ANSI_POP_KITTY_KEYBOARD_PROTOCOL +
      ANSI_DISABLE_SGR_MOUSE_MODE +
      ANSI_DISABLE_MOUSE_BUTTON_EVENT_TRACKING +
      ANSI_DISABLE_MOUSE_TRACKING +
      ANSI_DISABLE_FOCUS_EVENTS +
      ANSI_DISABLE_BRACKETED_PASTE +
      ANSI_ENABLE_AUTO_WRAP +
      ANSI_EXIT_ALTERNATE_SCREEN;
    try {
      output.write(sequence);
    } catch {
      // Best-effort: a dead pty (EIO) will reject the write. Swallow so a
      // process-exit handler never throws.
    }
  }

  write(chunk: string): unknown {
    return this.options.output.write(chunk);
  }

  private startInput(input: NativeTerminalInput): void {
    if (input.setEncoding !== undefined) input.setEncoding('utf8');
    if (this.options.rawMode !== false && input.isTTY === true && input.setRawMode !== undefined) {
      this.previousRawMode = input.isRaw;
      input.setRawMode(true);
      this.cleanup.push(() => {
        input.setRawMode?.(this.previousRawMode === true);
      });
    }
    if (input.resume !== undefined) {
      input.resume();
      this.cleanup.push(() => {
        input.pause?.();
      });
    }
    if (this.options.onInput !== undefined) {
      const listener = (data: unknown) => {
        if (typeof data === 'string' || Buffer.isBuffer(data)) this.options.onInput?.(data);
      };
      input.on('data', listener);
      this.cleanup.push(() => {
        removeInputListener(input, 'data', listener);
      });
    }
  }

  private startResize(output: NativeTerminalOutput): void {
    if (this.options.onResize === undefined || output.on === undefined) return;
    const listener = () => {
      this.options.onResize?.(this.size);
    };
    output.on('resize', listener);
    this.cleanup.push(() => {
      removeOutputListener(output, 'resize', listener);
    });
  }
}

function removeInputListener(
  target: NativeTerminalInput,
  event: 'data' | 'resize',
  listener: (...args: unknown[]) => void,
): void {
  if (target.off !== undefined) {
    target.off(event, listener);
  } else {
    target.removeListener?.(event, listener);
  }
}

function removeOutputListener(
  target: NativeTerminalOutput,
  event: 'resize',
  listener: (...args: unknown[]) => void,
): void {
  if (target.off !== undefined) {
    target.off(event, listener);
  } else {
    target.removeListener?.(event, listener);
  }
}

function normalizeTerminalSize(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}
