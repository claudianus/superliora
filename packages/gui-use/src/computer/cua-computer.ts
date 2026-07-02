import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { installCuaDriver, type SetupCommandResult } from '../install';
import type {
  ComputerActInput,
  ComputerActResult,
  ComputerAction,
  ComputerActionResult,
  ComputerCaptureInput,
  ComputerCaptureResult,
  ComputerElement,
  ComputerStatus,
  ComputerUseRuntime,
  RuntimeImage,
} from '../types';

export interface CuaComputerRuntimeOptions {
  readonly driverCmd?: string | undefined;
  readonly autoInstall?: boolean | undefined;
  readonly install?: (() => Promise<SetupCommandResult>) | undefined;
  readonly toolCallTimeoutMs?: number | undefined;
}

interface MappedToolResult {
  readonly text: string;
  readonly images: readonly RuntimeImage[];
  readonly structuredContent?: unknown;
  readonly isError: boolean;
}

interface ActiveWindow {
  readonly pid: number;
  readonly windowId: number;
  readonly appName: string;
  readonly title: string;
}

interface CuaWindow {
  readonly appName: string;
  readonly pid: number;
  readonly windowId: number;
  readonly title: string;
  readonly zIndex: number;
  readonly isOnScreen: boolean;
  readonly onCurrentSpace: boolean;
}

export class CuaComputerRuntime implements ComputerUseRuntime {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  private tools: Set<string> | undefined;
  private activeWindow: ActiveWindow | undefined;
  private lastApp: string | undefined;
  private installAttempt: Promise<void> | undefined;
  private readonly sessionId = `kimi-${randomUUID().slice(0, 12)}`;

  constructor(private readonly options: CuaComputerRuntimeOptions = {}) {}

  async capture(
    input: ComputerCaptureInput = {},
    signal?: AbortSignal,
  ): Promise<ComputerCaptureResult> {
    throwIfAborted(signal);
    const mode = input.mode ?? 'som';
    const selected = await this.selectWindow(input.app ?? this.lastApp, signal);
    if (selected === undefined) {
      return {
        ok: false,
        mode,
        elements: [],
        error: 'No on-screen window matched. Use ComputerStatus/list apps or pass app explicitly.',
      };
    }

    this.activeWindow = selected;
    this.lastApp = selected.appName;

    const result = await this.callTool('get_window_state', {
      pid: selected.pid,
      window_id: selected.windowId,
      session: this.sessionId,
    }, signal);
    if (result.isError) {
      return {
        ok: false,
        mode,
        app: selected.appName,
        elements: [],
        error: result.text || 'cua-driver get_window_state failed.',
        structuredContent: result.structuredContent,
      };
    }

    const image = mode === 'ax' ? undefined : firstImage(result);
    const structured = isRecord(result.structuredContent) ? result.structuredContent : {};
    const elements = mode === 'vision'
      ? []
      : extractElements(structured['elements'], input.maxElements);
    const dimensions = image === undefined ? {} : imageDimensions(image);

    return {
      ok: true,
      mode,
      app: selected.appName,
      windowTitle: extractWindowTitle(result.text, selected.title),
      width: dimensions.width,
      height: dimensions.height,
      image,
      text: mode === 'vision' ? undefined : result.text,
      elements,
      structuredContent: result.structuredContent,
    };
  }

  async act(input: ComputerActInput, signal?: AbortSignal): Promise<ComputerActResult> {
    const results: ComputerActionResult[] = [];
    for (const action of input.actions) {
      throwIfAborted(signal);
      const result = await this.runAction(action, signal);
      results.push(result);
      if (!result.ok) break;
    }
    const capture = input.captureAfter === true ? await this.capture({ app: this.lastApp }, signal) : undefined;
    return {
      ok: results.every((result) => result.ok),
      actions: results,
      capture,
    };
  }

  async status(signal?: AbortSignal): Promise<ComputerStatus> {
    throwIfAborted(signal);
    const installed = await this.ensureInstalled(signal);
    if (!installed.ok) {
      return {
        platform: process.platform,
        installed: false,
        error: installed.error,
      };
    }
    const version = installed.version;

    let health: unknown;
    let ready: boolean | undefined;
    try {
      const report = await this.callTool('health_report', {}, signal);
      health = report.structuredContent ?? report.text;
      if (isRecord(report.structuredContent)) {
        ready = report.structuredContent['overall'] === 'ok';
      }
    } catch (error) {
      health = { error: describeError(error) };
    }

    return {
      platform: process.platform,
      installed: true,
      ready,
      version,
      health,
    };
  }

  async close(): Promise<void> {
    try {
      if (this.tools?.has('end_session') === true) {
        await this.client?.callTool({
          name: 'end_session',
          arguments: { session: this.sessionId },
        });
      }
    } catch {
      // best-effort cleanup
    }
    this.tools = undefined;
    this.activeWindow = undefined;
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    await client?.close().catch(() => undefined);
  }

  private async ensureConnected(signal?: AbortSignal): Promise<Client> {
    throwIfAborted(signal);
    if (this.client !== undefined) return this.client;
    const installed = await this.ensureInstalled(signal);
    if (!installed.ok) {
      throw new Error(installed.error);
    }

    const client = new Client({
      name: 'kimi-code-gui-use',
      version: '0.1.0',
    });
    const invocation = resolveMcpInvocation(this.driverCmd());
    const transport = new StdioClientTransport({
      command: invocation.command,
      args: [...invocation.args],
      stderr: 'pipe',
    });
    await client.connect(transport);
    this.client = client;
    this.transport = transport;

    const listed = await client.listTools();
    this.tools = new Set(listed.tools.map((tool) => tool.name));
    if (this.tools.has('start_session')) {
      await client.callTool({
        name: 'start_session',
        arguments: { session: this.sessionId },
      }).catch(() => undefined);
    }
    return client;
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<MappedToolResult> {
    throwIfAborted(signal);
    const client = await this.ensureConnected(signal);
    const result = await client.callTool({ name, arguments: args });
    const raw = result as unknown as {
      readonly content?: readonly Record<string, unknown>[];
      readonly structuredContent?: unknown;
      readonly isError?: boolean;
    };
    return mapToolResult(raw);
  }

  private async runAction(action: ComputerAction, signal?: AbortSignal): Promise<ComputerActionResult> {
    throwIfAborted(signal);
    if (action.type === 'wait') {
      await delay(Math.min(Math.max(action.seconds ?? 1, 0), 30) * 1000, undefined, { signal });
      return okAction(action.type, 'Waited.');
    }
    if (action.type === 'focus_app') {
      const selected = await this.selectWindow(action.app, signal);
      if (selected === undefined) {
        return { ok: false, action: action.type, message: `No on-screen window found for ${action.app}.` };
      }
      this.activeWindow = selected;
      this.lastApp = selected.appName;
      return okAction(action.type, `Targeted ${selected.appName} without raising the window.`);
    }

    const active = this.activeWindow;
    if (active === undefined) {
      return {
        ok: false,
        action: action.type,
        message: 'No active window. Call ComputerCapture first.',
      };
    }

    try {
      const result = await this.dispatchActiveAction(active, action, signal);
      return {
        ok: !result.isError,
        action: action.type,
        message: result.text || (result.isError ? 'cua-driver action failed.' : 'ok'),
        structuredContent: result.structuredContent,
      };
    } catch (error) {
      return { ok: false, action: action.type, message: describeError(error) };
    }
  }

  private async dispatchActiveAction(
    active: ActiveWindow,
    action: Exclude<ComputerAction, { readonly type: 'wait' } | { readonly type: 'focus_app' }>,
    signal?: AbortSignal,
  ): Promise<MappedToolResult> {
    const base = { pid: active.pid, session: this.sessionId };
    switch (action.type) {
      case 'click_element':
        return this.callTool('click', {
          ...base,
          window_id: active.windowId,
          element_index: action.element,
          button: action.button ?? 'left',
        }, signal);
      case 'click_xy':
        return this.callTool('click', {
          ...base,
          x: action.x,
          y: action.y,
          button: action.button ?? 'left',
        }, signal);
      case 'double_click':
        if (action.element !== undefined) {
          return this.callTool('double_click', {
            ...base,
            window_id: active.windowId,
            element_index: action.element,
          }, signal);
        }
        if (action.x !== undefined && action.y !== undefined) {
          return this.callTool('double_click', {
            ...base,
            x: action.x,
            y: action.y,
          }, signal);
        }
        return actionError('double_click requires element or x/y.');
      case 'drag':
        if (action.fromElement !== undefined && action.toElement !== undefined) {
          return this.callTool('drag', {
            ...base,
            window_id: active.windowId,
            from_element: action.fromElement,
            to_element: action.toElement,
          }, signal);
        }
        if (action.from !== undefined && action.to !== undefined) {
          return this.callTool('drag', {
            ...base,
            from_x: action.from.x,
            from_y: action.from.y,
            to_x: action.to.x,
            to_y: action.to.y,
          }, signal);
        }
        return actionError('drag requires from/to element or coordinates.');
      case 'scroll':
        return this.callTool('scroll', {
          ...base,
          window_id: active.windowId,
          element_index: action.element,
          x: action.x,
          y: action.y,
          direction: action.direction,
          amount: Math.min(Math.max(action.amount ?? 3, 1), 50),
        }, signal);
      case 'type_text':
        return this.callTool('type_text', { ...base, text: action.text }, signal);
      case 'press_keys': {
        const parsed = parseKeyCombo(action.keys);
        if (parsed.key.length === 0) return actionError(`Could not parse key combo ${action.keys}.`);
        if (parsed.modifiers.length > 0) {
          return this.callTool('hotkey', { ...base, keys: [...parsed.modifiers, parsed.key] }, signal);
        }
        return this.callTool('press_key', { ...base, key: parsed.key }, signal);
      }
      case 'set_value':
        return this.callTool('set_value', {
          ...base,
          window_id: active.windowId,
          element_index: action.element,
          value: action.value,
        }, signal);
    }
  }

  private async selectWindow(app: string | undefined, signal?: AbortSignal): Promise<ActiveWindow | undefined> {
    const windows = await this.listWindows(signal);
    if (windows.length === 0) return undefined;
    const sorted = [...windows]
      .filter((window) => window.isOnScreen || window.onCurrentSpace)
      .sort((a, b) => b.zIndex - a.zIndex);
    const candidates = sorted.length > 0 ? sorted : [...windows].sort((a, b) => b.zIndex - a.zIndex);
    const selected =
      app === undefined || app.trim().length === 0
        ? candidates[0]
        : candidates.find((window) => windowMatchesApp(window, app));
    if (selected === undefined) return undefined;
    return {
      pid: selected.pid,
      windowId: selected.windowId,
      appName: selected.appName,
      title: selected.title,
    };
  }

  private async listWindows(signal?: AbortSignal): Promise<readonly CuaWindow[]> {
    const result = await this.callTool('list_windows', { session: this.sessionId }, signal);
    const structured = isRecord(result.structuredContent) ? result.structuredContent : {};
    const raw = Array.isArray(structured['windows']) ? structured['windows'] : [];
    return raw.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const pid = numberField(entry['pid']);
      const windowId = numberField(entry['window_id']);
      if (pid === undefined || windowId === undefined) return [];
      return [{
        appName: stringField(entry['app_name']),
        pid,
        windowId,
        title: stringField(entry['title']),
        zIndex: numberField(entry['z_index']) ?? 0,
        isOnScreen: booleanField(entry['is_on_screen']),
        onCurrentSpace: booleanField(entry['on_current_space']),
      }];
    });
  }

  private driverCmd(): string {
    return this.options.driverCmd ?? process.env['KIMI_CUA_DRIVER_CMD'] ?? process.env['HERMES_CUA_DRIVER_CMD'] ?? 'cua-driver';
  }

  private async ensureInstalled(signal?: AbortSignal): Promise<DriverStatus> {
    throwIfAborted(signal);
    const before = checkDriver(this.driverCmd());
    if (before.ok) return before;
    if (!this.shouldAutoInstall()) return before;

    this.installAttempt ??= this.installCuaDriver();
    try {
      await this.installAttempt;
    } catch (error) {
      this.installAttempt = undefined;
      return { ok: false, error: describeError(error) };
    }
    throwIfAborted(signal);
    const after = checkDriver(this.driverCmd());
    if (after.ok) return after;
    return {
      ok: false,
      error: `cua-driver auto-install completed but the driver is still unavailable: ${after.error}`,
    };
  }

  private shouldAutoInstall(): boolean {
    if (this.options.autoInstall === false) return false;
    if (this.options.driverCmd !== undefined) return false;
    if (process.env['KIMI_CUA_DRIVER_CMD'] !== undefined) return false;
    if (process.env['HERMES_CUA_DRIVER_CMD'] !== undefined) return false;
    return process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32';
  }

  private async installCuaDriver(): Promise<void> {
    const result = await (this.options.install ?? (() => installCuaDriver({ quiet: true })))();
    if (result.ok) return;
    const detail = firstNonEmpty(result.error, result.stderr, result.stdout);
    throw new Error(detail.length > 0 ? detail : 'cua-driver auto-install failed.');
  }
}

type DriverStatus =
  | {
      readonly ok: true;
      readonly version: string | undefined;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

function checkDriver(driverCmd: string): DriverStatus {
  const version = spawnSync(driverCmd, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (version.error !== undefined) {
    return { ok: false, error: version.error.message };
  }
  if (version.status !== 0) {
    return {
      ok: false,
      error: firstNonEmpty(version.stderr, version.stdout, `cua-driver exited with code ${String(version.status)}`),
    };
  }
  return { ok: true, version: firstNonEmpty(version.stdout, version.stderr) || undefined };
}

function resolveMcpInvocation(driverCmd: string): { readonly command: string; readonly args: readonly string[] } {
  const fallback = { command: driverCmd, args: ['mcp'] };
  const result = spawnSync(driverCmd, ['manifest'], {
    encoding: 'utf8',
    timeout: 6000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.stdout.trim().length === 0) return fallback;
  try {
    const manifest = JSON.parse(result.stdout) as unknown;
    if (!isRecord(manifest)) return fallback;
    const invocation = manifest['mcp_invocation'];
    if (!isRecord(invocation)) return fallback;
    const args = invocation['args'];
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return fallback;
    const command = stringOrUndefined(invocation['command']) ?? driverCmd;
    return { command, args };
  } catch {
    return fallback;
  }
}

function windowMatchesApp(window: CuaWindow, app: string): boolean {
  const needle = app.trim().toLowerCase();
  if (needle.length === 0) return true;
  if (['screen', 'desktop', 'fullscreen', 'full screen', 'all'].includes(needle)) {
    return ['finder', 'desktop', 'dock', 'progman', 'workerw', 'taskbar', 'shell_traywnd']
      .some((name) => window.appName.toLowerCase().includes(name) || window.title.toLowerCase().includes(name));
  }
  return window.appName.toLowerCase().includes(needle) || window.title.toLowerCase().includes(needle);
}

function mapToolResult(raw: {
  readonly content?: readonly Record<string, unknown>[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}): MappedToolResult {
  const content = raw.content ?? [];
  const textParts: string[] = [];
  const images: RuntimeImage[] = [];
  for (const part of content) {
    if (part['type'] === 'text' && typeof part['text'] === 'string') {
      textParts.push(part['text']);
    } else if (part['type'] === 'image' && typeof part['data'] === 'string') {
      images.push({
        base64: part['data'],
        mimeType: typeof part['mimeType'] === 'string' ? part['mimeType'] : 'image/png',
      });
    }
  }

  const structured = isRecord(raw.structuredContent) ? raw.structuredContent : undefined;
  const structuredImage = structured === undefined ? undefined : imageFromStructured(structured);
  if (structuredImage !== undefined) images.push(structuredImage);
  return {
    text: textParts.join('\n'),
    images,
    structuredContent: raw.structuredContent,
    isError: raw.isError === true,
  };
}

function imageFromStructured(structured: Record<string, unknown>): RuntimeImage | undefined {
  const base64 = stringOrUndefined(structured['screenshot_png_b64']) ?? stringOrUndefined(structured['image_b64']);
  if (base64 === undefined) return undefined;
  return {
    base64,
    mimeType: stringOrUndefined(structured['screenshot_mime_type']) ?? stringOrUndefined(structured['mime_type']) ?? 'image/png',
  };
}

function firstImage(result: MappedToolResult): RuntimeImage | undefined {
  return result.images[0];
}

function extractElements(raw: unknown, maxElements: number | undefined): readonly ComputerElement[] {
  if (!Array.isArray(raw)) return [];
  const limit = Math.min(Math.max(maxElements ?? 100, 1), 1000);
  return raw.slice(0, limit).flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const explicitIndex = numberField(entry['index']) ?? numberField(entry['element_index']) ?? index + 1;
    return [{
      index: explicitIndex,
      role: stringOrUndefined(entry['role']),
      name: stringOrUndefined(entry['name']) ?? stringOrUndefined(entry['label']) ?? stringOrUndefined(entry['title']),
      bounds: boundsFrom(entry),
      raw: entry,
    }];
  });
}

function boundsFrom(entry: Record<string, unknown>): ComputerElement['bounds'] {
  const bounds = isRecord(entry['bounds'])
    ? entry['bounds']
    : isRecord(entry['frame'])
      ? entry['frame']
      : entry;
  const x = numberField(bounds['x']);
  const y = numberField(bounds['y']);
  const width = numberField(bounds['width']) ?? numberField(bounds['w']);
  const height = numberField(bounds['height']) ?? numberField(bounds['h']);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function imageDimensions(image: RuntimeImage): { readonly width?: number; readonly height?: number } {
  const raw = Buffer.from(image.base64, 'base64');
  if (raw.length >= 24 && raw.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: raw.readUInt32BE(16),
      height: raw.readUInt32BE(20),
    };
  }
  if (raw.length >= 4 && raw[0] === 0xff && raw[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < raw.length) {
      if (raw[offset] !== 0xff) break;
      const marker = raw[offset + 1];
      const length = raw.readUInt16BE(offset + 2);
      if (marker !== undefined && marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: raw.readUInt16BE(offset + 5),
          width: raw.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  return {};
}

function extractWindowTitle(text: string, fallback: string): string | undefined {
  const match = /AXWindow\s+"([^"]+)"/.exec(text);
  return match?.[1] ?? (fallback.length > 0 ? fallback : undefined);
}

function parseKeyCombo(keys: string): { readonly modifiers: readonly string[]; readonly key: string } {
  const parts = keys.split('+').map((part) => normalizeKey(part.trim())).filter((part) => part.length > 0);
  if (parts.length === 0) return { modifiers: [], key: '' };
  const modifiers = parts.slice(0, -1);
  const key = parts[parts.length - 1] ?? '';
  return { modifiers, key };
}

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === 'cmd' || lower === 'command' || lower === 'meta') return 'cmd';
  if (lower === 'ctrl' || lower === 'control') return 'ctrl';
  if (lower === 'alt' || lower === 'option') return 'alt';
  if (lower === 'shift') return 'shift';
  if (lower === 'return') return 'enter';
  if (lower === 'esc') return 'escape';
  return lower;
}

function actionError(message: string): MappedToolResult {
  return { text: message, images: [], isError: true };
}

function okAction(action: string, message: string): ComputerActionResult {
  return { ok: true, action, message };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Computer use call was aborted.');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  return values.map((value) => value?.trim() ?? '').find((value) => value.length > 0) ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanField(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}
