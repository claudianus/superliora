import type { NativeTerminalDecModeReport } from '../terminal/features';

export type NativeInputKey =
  | 'character'
  | 'up'
  | 'down'
  | 'right'
  | 'left'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'insert'
  | 'delete'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'f4'
  | 'f5'
  | 'f6'
  | 'f7'
  | 'f8'
  | 'f9'
  | 'f10'
  | 'f11'
  | 'f12'
  | 'menu'
  | 'enter'
  | 'backspace'
  | 'tab'
  | 'escape';

export type NativeInputKeyEventType = 'press' | 'repeat' | 'release';

export interface NativeInputKeyEvent {
  readonly type: 'key';
  readonly key: NativeInputKey;
  readonly raw: string;
  readonly text?: string;
  readonly eventType?: NativeInputKeyEventType;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** Super/Cmd (Kitty CSI-u bit 3). Omitted on older literals; treat as false. */
  readonly super?: boolean;
}

export interface NativeInputPasteEvent {
  readonly type: 'paste';
  readonly raw: string;
  readonly text: string;
}

export interface NativeInputFocusEvent {
  readonly type: 'focus';
  readonly raw: string;
  readonly focused: boolean;
}

export type NativeInputMouseButton =
  | 'left'
  | 'middle'
  | 'right'
  | 'wheel-up'
  | 'wheel-down'
  | 'wheel-left'
  | 'wheel-right'
  | 'none'
  | 'unknown';

export type NativeInputMouseAction = 'press' | 'release' | 'drag' | 'move' | 'wheel';

export interface NativeInputMouseEvent {
  readonly type: 'mouse';
  readonly raw: string;
  readonly button: NativeInputMouseButton;
  readonly action: NativeInputMouseAction;
  readonly x: number;
  readonly y: number;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface NativeInputTerminalModeReportEvent {
  readonly type: 'terminal-mode-report';
  readonly raw: string;
  readonly report: NativeTerminalDecModeReport;
}

export interface NativeInputUnknownEvent {
  readonly type: 'unknown';
  readonly raw: string;
}

export type NativeInputEvent =
  | NativeInputKeyEvent
  | NativeInputPasteEvent
  | NativeInputFocusEvent
  | NativeInputMouseEvent
  | NativeInputTerminalModeReportEvent
  | NativeInputUnknownEvent;
