export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserRef {
  readonly ref: string;
  readonly selector: string;
  readonly role: string;
  readonly name: string;
  readonly tag: string;
  readonly bounds?: Bounds | undefined;
}

export interface BrowserObservation {
  readonly ok: boolean;
  readonly url: string;
  readonly title: string;
  readonly snapshot: string;
  readonly refs: readonly BrowserRef[];
  readonly screenshot?: RuntimeImage | undefined;
  readonly error?: string | undefined;
}

export interface RuntimeImage {
  readonly base64: string;
  readonly mimeType: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface BrowserObserveInput {
  readonly url?: string | undefined;
  readonly full?: boolean | undefined;
  readonly includeScreenshot?: boolean | undefined;
}

export interface BrowserScreenshotInput {
  readonly fullPage?: boolean | undefined;
}

export interface BrowserConsoleInput {
  readonly clear?: boolean | undefined;
  readonly expression?: string | undefined;
}

export interface BrowserStatusInput {
  readonly installIfMissing?: boolean | undefined;
}

export interface BrowserStatus {
  readonly platform: NodeJS.Platform;
  readonly installed: boolean;
  readonly ready?: boolean | undefined;
  readonly version?: string | undefined;
  readonly command?: readonly string[] | undefined;
  readonly error?: string | undefined;
}

export type BrowserAction =
  | { readonly type: 'navigate'; readonly url: string }
  | { readonly type: 'click_ref'; readonly ref: string }
  | { readonly type: 'click_xy'; readonly x: number; readonly y: number; readonly button?: MouseButton | undefined }
  | { readonly type: 'type_text'; readonly text: string; readonly ref?: string | undefined; readonly clear?: boolean | undefined }
  | { readonly type: 'press_keys'; readonly keys: string }
  | { readonly type: 'scroll'; readonly direction: ScrollDirection; readonly amount?: number | undefined; readonly x?: number | undefined; readonly y?: number | undefined }
  | { readonly type: 'drag'; readonly from: Point; readonly to: Point; readonly button?: MouseButton | undefined }
  | { readonly type: 'wait'; readonly seconds?: number | undefined }
  | { readonly type: 'back' }
  | { readonly type: 'forward' };

export interface BrowserActInput {
  readonly actions: readonly BrowserAction[];
  readonly captureAfter?: boolean | undefined;
}

export interface BrowserActResult {
  readonly ok: boolean;
  readonly actions: readonly BrowserActionResult[];
  readonly observation?: BrowserObservation | undefined;
}

export interface BrowserActionResult {
  readonly ok: boolean;
  readonly action: string;
  readonly message?: string | undefined;
}

export interface BrowserConsoleResult {
  readonly ok: boolean;
  readonly messages: readonly BrowserConsoleMessage[];
  readonly result?: unknown;
  readonly error?: string | undefined;
}

export interface BrowserConsoleMessage {
  readonly type: string;
  readonly text: string;
}

export interface BrowserUseRuntime {
  status(input?: BrowserStatusInput, signal?: AbortSignal): Promise<BrowserStatus>;
  observe(input?: BrowserObserveInput, signal?: AbortSignal): Promise<BrowserObservation>;
  screenshot(input?: BrowserScreenshotInput, signal?: AbortSignal): Promise<RuntimeImage>;
  act(input: BrowserActInput, signal?: AbortSignal): Promise<BrowserActResult>;
  console(input?: BrowserConsoleInput, signal?: AbortSignal): Promise<BrowserConsoleResult>;
  close(): Promise<void>;
}

export type MouseButton = 'left' | 'right' | 'middle';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ComputerElement {
  readonly index: number;
  readonly role?: string | undefined;
  readonly name?: string | undefined;
  readonly bounds?: Bounds | undefined;
  readonly raw?: unknown;
}

export interface ComputerCaptureInput {
  readonly mode?: ComputerCaptureMode | undefined;
  readonly app?: string | undefined;
  readonly maxElements?: number | undefined;
}

export type ComputerCaptureMode = 'som' | 'vision' | 'ax';

export interface ComputerCaptureResult {
  readonly ok: boolean;
  readonly mode: ComputerCaptureMode;
  readonly app?: string | undefined;
  readonly windowTitle?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly image?: RuntimeImage | undefined;
  readonly text?: string | undefined;
  readonly elements: readonly ComputerElement[];
  readonly structuredContent?: unknown;
  readonly error?: string | undefined;
}

export type ComputerAction =
  | { readonly type: 'click_element'; readonly element: number; readonly button?: MouseButton | undefined }
  | { readonly type: 'click_xy'; readonly x: number; readonly y: number; readonly button?: MouseButton | undefined }
  | { readonly type: 'double_click'; readonly element?: number | undefined; readonly x?: number | undefined; readonly y?: number | undefined }
  | { readonly type: 'drag'; readonly fromElement?: number | undefined; readonly toElement?: number | undefined; readonly from?: Point | undefined; readonly to?: Point | undefined }
  | { readonly type: 'scroll'; readonly direction: ScrollDirection; readonly amount?: number | undefined; readonly element?: number | undefined; readonly x?: number | undefined; readonly y?: number | undefined }
  | { readonly type: 'type_text'; readonly text: string }
  | { readonly type: 'press_keys'; readonly keys: string }
  | { readonly type: 'set_value'; readonly element: number; readonly value: string }
  | { readonly type: 'wait'; readonly seconds?: number | undefined }
  | { readonly type: 'focus_app'; readonly app: string; readonly raiseWindow?: boolean | undefined };

export interface ComputerActInput {
  readonly actions: readonly ComputerAction[];
  readonly captureAfter?: boolean | undefined;
}

export interface ComputerActResult {
  readonly ok: boolean;
  readonly actions: readonly ComputerActionResult[];
  readonly capture?: ComputerCaptureResult | undefined;
}

export interface ComputerActionResult {
  readonly ok: boolean;
  readonly action: string;
  readonly message?: string | undefined;
  readonly structuredContent?: unknown;
}

export interface ComputerStatus {
  readonly platform: NodeJS.Platform;
  readonly installed: boolean;
  readonly ready?: boolean | undefined;
  readonly version?: string | undefined;
  readonly health?: unknown;
  readonly error?: string | undefined;
}

export interface ComputerUseRuntime {
  capture(input?: ComputerCaptureInput, signal?: AbortSignal): Promise<ComputerCaptureResult>;
  act(input: ComputerActInput, signal?: AbortSignal): Promise<ComputerActResult>;
  status(signal?: AbortSignal): Promise<ComputerStatus>;
  close(): Promise<void>;
}
