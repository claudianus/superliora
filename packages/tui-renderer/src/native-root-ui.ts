import type { Component } from './text-component';
import { isFocusable } from './component-primitives';
import type { RendererCell, RendererCellBuffer, RendererCellStyle } from './cell-buffer';
import { projectRendererCursorMarkerLine } from './cursor-marker';
import {
  NativeTerminalRenderer,
  type NativeTerminalRendererOptions,
} from './native-renderer';
import type { NativeRenderCause } from './render-loop';
import type {
  NativeTerminalInput,
  NativeTerminalOutput,
} from './terminal-session';
import type {
  RendererInputListener,
  RendererRootUI,
  RendererTerminalHost,
} from './terminal-host';
import type { RendererCursorState } from './terminal-output';

export interface NativeRootUIOptions
  extends Omit<NativeTerminalRendererOptions, 'render' | 'onInput'> {
  readonly input?: NativeTerminalInput;
  readonly output: NativeTerminalOutput;
  readonly requestRenderOnInput?: boolean;
}

export class NativeRendererTerminalHost implements RendererTerminalHost {
  constructor(
    private readonly output: NativeTerminalOutput,
    private readonly input: NativeTerminalInput | undefined,
  ) {}

  get columns(): number {
    return normalizeTerminalSize(this.output.columns, 80);
  }

  get rows(): number {
    return normalizeTerminalSize(this.output.rows, 24);
  }

  write(chunk: string): void {
    this.output.write(chunk);
  }

  async drainInput(): Promise<void> {
    await Promise.resolve();
  }

  setTitle(title: string): void {
    this.output.write(`\u001B]0;${sanitizeOscPayload(title)}\u0007`);
  }

  setProgress(_active: boolean): void {}

  get nativeInput(): NativeTerminalInput | undefined {
    return this.input;
  }

  get nativeOutput(): NativeTerminalOutput {
    return this.output;
  }
}

export class NativeRootUI<TComponent extends Component = Component>
  implements RendererRootUI<TComponent> {
  readonly children: TComponent[] = [];
  readonly terminal: NativeRendererTerminalHost;
  readonly renderer: NativeTerminalRenderer;

  private readonly inputListeners: RendererInputListener[] = [];
  private focusedComponent: TComponent | undefined;
  private readonly requestRenderOnInput: boolean;

  constructor(options: NativeRootUIOptions) {
    this.terminal = new NativeRendererTerminalHost(options.output, options.input);
    this.requestRenderOnInput = options.requestRenderOnInput !== false;
    this.renderer = new NativeTerminalRenderer({
      ...options,
      renderOnStart: options.renderOnStart ?? true,
      onInput: (data) => {
        this.handleRawInput(data);
      },
      render: ({ renderer, size }) => {
        const cursor = renderNativeRootChildren(
          renderer.frame,
          this.children,
          size.columns,
          size.rows,
        );
        if (cursor === undefined) renderer.hideCursor();
        else renderer.setCursor(cursor);
      },
    });
  }

  start(): void {
    this.renderer.start();
  }

  stop(): void {
    this.renderer.stop();
  }

  requestRender(cause?: boolean | NativeRenderCause): void {
    if (cause === true) {
      this.renderer.requestRender('manual');
    } else if (cause === false || cause === undefined) {
      this.renderer.requestRender('request');
    } else {
      this.renderer.requestRender(cause);
    }
  }

  addChild(component: TComponent): void {
    this.children.push(component);
    this.requestRender();
  }

  clear(): void {
    this.children.length = 0;
    this.focusedComponent = undefined;
    this.requestRender(true);
  }

  setFocus(component: TComponent): void {
    if (this.focusedComponent === component) return;
    if (this.focusedComponent !== undefined && isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (isFocusable(component)) component.focused = true;
    this.requestRender();
  }

  addInputListener(listener: RendererInputListener): () => void {
    this.inputListeners.push(listener);
    return () => {
      const index = this.inputListeners.indexOf(listener);
      if (index !== -1) this.inputListeners.splice(index, 1);
    };
  }

  private handleRawInput(data: string | Buffer): void {
    let next = Buffer.isBuffer(data) ? data.toString('utf8') : data;
    for (const listener of this.inputListeners) {
      const result = listener(next);
      if (result?.data !== undefined) next = result.data;
      if (result?.consume === true) {
        if (this.requestRenderOnInput) this.requestRender();
        return;
      }
    }

    this.focusedComponent?.handleInput?.(next);
    if (this.requestRenderOnInput) this.requestRender();
  }
}

export function createNativeRootUI<TComponent extends Component = Component>(
  options: NativeRootUIOptions,
): NativeRootUI<TComponent> {
  return new NativeRootUI<TComponent>(options);
}

export function renderNativeRootChildren(
  frame: RendererCellBuffer,
  children: readonly Component[],
  width = frame.width,
  height = frame.height,
): RendererCursorState | undefined {
  let y = 0;
  let cursor: RendererCursorState | undefined;
  const safeWidth = normalizeTerminalSize(width, frame.width);
  const safeHeight = normalizeTerminalSize(height, frame.height);

  for (const child of children) {
    const lines = child.render(safeWidth);
    for (const line of lines) {
      if (y >= safeHeight) return cursor;
      const projection = projectNativeRootLine(line, y, safeWidth, safeHeight);
      writeNativeRootCellLine(frame, y, projection.cells, safeWidth);
      cursor ??= projection.cursor;
      y++;
    }
  }

  return cursor;
}

function projectNativeRootLine(
  line: string,
  y: number,
  width: number,
  height: number,
): {
  readonly cells: readonly RendererCell[];
  readonly cursor?: RendererCursorState;
} {
  return projectRendererCursorMarkerLine({
    line,
    y,
    viewport: { x: 0, y: 0, width, height },
  });
}

function writeNativeRootCellLine(
  frame: RendererCellBuffer,
  y: number,
  cells: readonly RendererCell[],
  width: number,
): void {
  for (let x = 0; x < width && x < cells.length; x++) {
    const cell = cells[x];
    if (cell === undefined) continue;
    if (cell.continuation === true || cell.width === 0) continue;
    if (cell.width === 2) {
      if (x + 1 >= width) break;
      frame.setCell(x, y, cell);
      frame.setCell(x + 1, y, continuationCellFor(cell, cells[x + 1]));
      x++;
      continue;
    }
    frame.setCell(x, y, cell);
  }
}

function continuationCellFor(
  primary: RendererCell,
  existing: RendererCell | undefined,
): RendererCell {
  if (existing?.continuation === true) return existing;
  const out: {
    char: string;
    width: 0;
    continuation: true;
    style?: RendererCellStyle;
    link?: string;
  } = {
    char: '',
    width: 0,
    continuation: true,
  };
  if (primary.style !== undefined) out.style = primary.style;
  if (primary.link !== undefined) out.link = primary.link;
  return out;
}

function sanitizeOscPayload(value: string): string {
  return value.replaceAll(/[\u0000-\u001F\u007F]/g, '').slice(0, 256);
}

function normalizeTerminalSize(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}
