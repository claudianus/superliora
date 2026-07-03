import type { Browser, BrowserContext, Page } from 'playwright-core';

import {
  infoCloakBrowser,
  installCloakBrowser,
  type SetupCommandResult,
} from '../install';
import type {
  BrowserActInput,
  BrowserActResult,
  BrowserAction,
  BrowserActionResult,
  BrowserConsoleInput,
  BrowserConsoleMessage,
  BrowserConsoleResult,
  BrowserObservation,
  BrowserObserveInput,
  BrowserRef,
  BrowserScreenshotInput,
  BrowserStatus,
  BrowserStatusInput,
  BrowserUseRuntime,
  RuntimeImage,
} from '../types';

export interface CloakBrowserRuntimeOptions {
  readonly headless?: boolean | undefined;
  readonly humanize?: boolean | undefined;
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
  readonly autoInstall?: boolean | undefined;
  readonly autoUpdate?: boolean | undefined;
  readonly cacheDir?: string | undefined;
  readonly binaryPath?: string | undefined;
  readonly version?: string | undefined;
  readonly licenseKeyEnv?: string | undefined;
  readonly allowUnsafeEval?: boolean | undefined;
  readonly inactiveCleanupMs?: number | undefined;
  readonly install?: (() => Promise<SetupCommandResult>) | undefined;
  readonly info?: (() => Promise<SetupCommandResult>) | undefined;
}

interface PageState {
  readonly page: Page;
  readonly consoleMessages: BrowserConsoleMessage[];
  refs: Map<string, BrowserRef>;
}

const MAX_CONSOLE_MESSAGES = 200;
const MAX_SNAPSHOT_CHARS = 50_000;
const DEFAULT_INACTIVE_CLEANUP_MS = 10 * 60_000;

export class CloakBrowserRuntime implements BrowserUseRuntime {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private state: PageState | undefined;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private installAttempt: Promise<SetupCommandResult> | undefined;

  constructor(private readonly options: CloakBrowserRuntimeOptions = {}) {}

  async status(
    input: BrowserStatusInput = {},
    signal?: AbortSignal,
  ): Promise<BrowserStatus> {
    throwIfAborted(signal);
    const before = await this.infoCloakBrowser();
    if (before.ok) return statusFromSetupResult(before, true);

    if (input.installIfMissing === false || !this.shouldAutoInstall()) {
      return statusFromSetupResult(before, false);
    }

    const installed = await this.installCloakBrowser(signal);
    if (!installed.ok) {
      return {
        platform: process.platform,
        installed: false,
        ready: false,
        command: installed.command,
        error: `CloakBrowser auto-install failed: ${setupResultDetail(installed)}`,
      };
    }

    throwIfAborted(signal);
    const after = await this.infoCloakBrowser();
    if (after.ok) return statusFromSetupResult(after, true);
    return {
      ...statusFromSetupResult(after, false),
      error: `CloakBrowser install completed but the runtime is still unavailable: ${setupResultDetail(after)}`,
    };
  }

  async observe(input: BrowserObserveInput = {}, signal?: AbortSignal): Promise<BrowserObservation> {
    try {
      const state = await this.ensurePage(signal);
      if (input.url !== undefined) {
        await state.page.goto(input.url, { waitUntil: 'domcontentloaded' });
      }

      const data = await collectPageSnapshot(state.page, input.full === true);
      state.refs = new Map(data.refs.map((ref) => [ref.ref, ref]));
      const screenshot = input.includeScreenshot === true ? await this.screenshot({}, signal) : undefined;

      return {
        ok: true,
        url: state.page.url(),
        title: await state.page.title().catch(() => ''),
        snapshot: truncateSnapshot(data.snapshot),
        refs: data.refs,
        screenshot,
      };
    } finally {
      this.scheduleCleanup();
    }
  }

  async screenshot(
    input: BrowserScreenshotInput = {},
    signal?: AbortSignal,
  ): Promise<RuntimeImage> {
    try {
      throwIfAborted(signal);
      const state = await this.ensurePage(signal);
      const bytes = await state.page.screenshot({
        fullPage: input.fullPage === true,
        type: 'png',
      });
      return {
        base64: Buffer.from(bytes).toString('base64'),
        mimeType: 'image/png',
      };
    } finally {
      this.scheduleCleanup();
    }
  }

  async act(input: BrowserActInput, signal?: AbortSignal): Promise<BrowserActResult> {
    try {
      const results: BrowserActionResult[] = [];
      for (const action of input.actions) {
        throwIfAborted(signal);
        const result = await this.runAction(action, signal);
        results.push(result);
        if (!result.ok) break;
      }

      const observation = input.captureAfter === true ? await this.observe({}, signal) : undefined;
      return {
        ok: results.every((result) => result.ok),
        actions: results,
        observation,
      };
    } finally {
      this.scheduleCleanup();
    }
  }

  async console(
    input: BrowserConsoleInput = {},
    signal?: AbortSignal,
  ): Promise<BrowserConsoleResult> {
    try {
      throwIfAborted(signal);
      const state = await this.ensurePage(signal);
      let result: unknown;
      if (input.expression !== undefined && input.expression.trim().length > 0) {
        const unsafe = unsafeEvalReason(input.expression);
        if (unsafe !== undefined && this.options.allowUnsafeEval !== true) {
          return {
            ok: false,
            messages: [...state.consoleMessages],
            error: `Blocked unsafe browser console expression: ${unsafe}.`,
          };
        }
        try {
          result = await state.page.evaluate(
            `(() => { "use strict"; return (${input.expression}); })()`,
          );
        } catch (error) {
          return {
            ok: false,
            messages: [...state.consoleMessages],
            error: describeError(error),
          };
        }
      }

      const messages = [...state.consoleMessages];
      if (input.clear === true) state.consoleMessages.length = 0;
      return { ok: true, messages, result };
    } finally {
      this.scheduleCleanup();
    }
  }

  async close(): Promise<void> {
    this.clearCleanupTimer();
    const context = this.context;
    const browser = this.browser;
    this.state = undefined;
    this.context = undefined;
    this.browser = undefined;
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  private async ensurePage(signal?: AbortSignal): Promise<PageState> {
    throwIfAborted(signal);
    if (this.state !== undefined) return this.state;

    await this.launchBrowser(signal);

    if (this.browser === undefined) {
      throw new Error('CloakBrowser launch did not return a browser.');
    }

    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? { width: 1280, height: 900 },
    });
    const page = await this.context.newPage();
    const consoleMessages: BrowserConsoleMessage[] = [];
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
      trimConsole(consoleMessages);
    });
    page.on('pageerror', (error) => {
      consoleMessages.push({ type: 'pageerror', text: error.message });
      trimConsole(consoleMessages);
    });
    this.state = { page, consoleMessages, refs: new Map() };
    return this.state;
  }

  private async launchBrowser(signal?: AbortSignal): Promise<void> {
    const { launch } = await import('cloakbrowser');
    try {
      await this.launchWith(launch);
      return;
    } catch (firstError) {
      if (!this.shouldAutoInstall()) {
        throw new Error(actionableLaunchError(firstError));
      }

      const installed = await this.installCloakBrowser(signal);
      if (!installed.ok) {
        throw new Error(
          `${actionableLaunchError(firstError)}\n` +
          `CloakBrowser auto-install failed: ${setupResultDetail(installed)}`,
        );
      }

      throwIfAborted(signal);
      try {
        await this.launchWith(launch);
      } catch (secondError) {
        throw new Error(
          `CloakBrowser launch failed after auto-install: ${describeError(secondError)}. ` +
          `Initial launch error: ${describeError(firstError)}. ` +
          'Use BrowserStatus or `kimi browser-use doctor` for diagnostics.',
        );
      }
    }
  }

  private async launchWith(launch: typeof import('cloakbrowser')['launch']): Promise<void> {
    await withCloakEnv(this.options, async () => {
      this.browser = await launch({
        headless: this.options.headless ?? true,
        humanize: this.options.humanize ?? true,
      } as never) as Browser;
    });
  }

  private async infoCloakBrowser(): Promise<SetupCommandResult> {
    return (this.options.info ?? (() => infoCloakBrowser({ quiet: true })))();
  }

  private async installCloakBrowser(signal?: AbortSignal): Promise<SetupCommandResult> {
    throwIfAborted(signal);
    this.installAttempt ??= (this.options.install ?? (() => installCloakBrowser({ quiet: true })))();
    const result = await this.installAttempt;
    if (!result.ok) this.installAttempt = undefined;
    return result;
  }

  private shouldAutoInstall(): boolean {
    if (this.options.autoInstall === false) return false;
    if (this.options.binaryPath !== undefined) return false;
    if (process.env['CLOAKBROWSER_BINARY_PATH'] !== undefined) return false;
    return true;
  }

  private scheduleCleanup(): void {
    this.clearCleanupTimer();
    if (this.browser === undefined) return;
    const timeoutMs = this.options.inactiveCleanupMs ?? DEFAULT_INACTIVE_CLEANUP_MS;
    if (timeoutMs <= 0) return;
    this.cleanupTimer = setTimeout(() => {
      void this.close();
    }, timeoutMs);
    this.cleanupTimer.unref?.();
  }

  private clearCleanupTimer(): void {
    if (this.cleanupTimer === undefined) return;
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  private async runAction(action: BrowserAction, signal?: AbortSignal): Promise<BrowserActionResult> {
    throwIfAborted(signal);
    const state = await this.ensurePage(signal);
    try {
      switch (action.type) {
        case 'navigate':
          await state.page.goto(action.url, { waitUntil: 'domcontentloaded' });
          return okAction(action.type, `Navigated to ${action.url}`);
        case 'click_ref': {
          const ref = this.resolveRef(action.ref);
          await state.page.locator(ref.selector).click();
          return okAction(action.type, `Clicked ${ref.ref}`);
        }
        case 'click_xy':
          await state.page.mouse.click(action.x, action.y, { button: action.button ?? 'left' });
          return okAction(action.type, `Clicked at ${String(action.x)},${String(action.y)}`);
        case 'type_text':
          if (action.ref !== undefined) {
            const ref = this.resolveRef(action.ref);
            const locator = state.page.locator(ref.selector);
            if (action.clear === false) {
              await locator.pressSequentially(action.text);
            } else {
              await locator.fill(action.text);
            }
          } else {
            await state.page.keyboard.type(action.text);
          }
          return okAction(action.type, `Typed ${String(action.text.length)} characters`);
        case 'press_keys':
          await state.page.keyboard.press(normalizeKeyCombo(action.keys));
          return okAction(action.type, `Pressed ${action.keys}`);
        case 'scroll': {
          if (action.x !== undefined && action.y !== undefined) {
            await state.page.mouse.move(action.x, action.y);
          }
          const pixels = scrollPixels(action.direction, action.amount);
          await state.page.mouse.wheel(pixels.x, pixels.y);
          return okAction(action.type, `Scrolled ${action.direction}`);
        }
        case 'drag':
          await state.page.mouse.move(action.from.x, action.from.y);
          await state.page.mouse.down({ button: action.button ?? 'left' });
          await state.page.mouse.move(action.to.x, action.to.y, { steps: 12 });
          await state.page.mouse.up({ button: action.button ?? 'left' });
          return okAction(action.type, 'Dragged pointer');
        case 'wait':
          await state.page.waitForTimeout(Math.min(Math.max(action.seconds ?? 1, 0), 30) * 1000);
          return okAction(action.type, 'Waited');
        case 'back':
          await state.page.goBack({ waitUntil: 'domcontentloaded' });
          return okAction(action.type, 'Navigated back');
        case 'forward':
          await state.page.goForward({ waitUntil: 'domcontentloaded' });
          return okAction(action.type, 'Navigated forward');
      }
    } catch (error) {
      return { ok: false, action: action.type, message: describeError(error) };
    }
  }

  private resolveRef(ref: string): BrowserRef {
    const normalized = ref.startsWith('@') ? ref : `@${ref}`;
    const found = this.state?.refs.get(normalized);
    if (found === undefined) {
      throw new Error(`Unknown browser ref ${normalized}. Call BrowserObserve first.`);
    }
    return found;
  }
}

function trimConsole(messages: BrowserConsoleMessage[]): void {
  if (messages.length <= MAX_CONSOLE_MESSAGES) return;
  messages.splice(0, messages.length - MAX_CONSOLE_MESSAGES);
}

function okAction(action: string, message: string): BrowserActionResult {
  return { ok: true, action, message };
}

function scrollPixels(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number | undefined,
): { readonly x: number; readonly y: number } {
  const magnitude = Math.min(Math.max(amount ?? 600, 1), 5000);
  switch (direction) {
    case 'up':
      return { x: 0, y: -magnitude };
    case 'down':
      return { x: 0, y: magnitude };
    case 'left':
      return { x: -magnitude, y: 0 };
    case 'right':
      return { x: magnitude, y: 0 };
  }
}

function normalizeKeyCombo(keys: string): string {
  return keys
    .split('+')
    .map((part) => {
      const value = part.trim();
      const lower = value.toLowerCase();
      if (lower === 'cmd' || lower === 'command' || lower === 'meta') return 'Meta';
      if (lower === 'ctrl' || lower === 'control') return 'Control';
      if (lower === 'alt' || lower === 'option') return 'Alt';
      if (lower === 'shift') return 'Shift';
      if (lower === 'return') return 'Enter';
      if (lower === 'esc') return 'Escape';
      return value;
    })
    .filter((part) => part.length > 0)
    .join('+');
}

function truncateSnapshot(snapshot: string): string {
  if (snapshot.length <= MAX_SNAPSHOT_CHARS) return snapshot;
  return `${snapshot.slice(0, MAX_SNAPSHOT_CHARS)}\n[...truncated]`;
}

async function withCloakEnv<T>(
  options: CloakBrowserRuntimeOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const updates: Record<string, string | undefined> = {
    CLOAKBROWSER_AUTO_UPDATE: options.autoUpdate === false ? 'false' : undefined,
    CLOAKBROWSER_CACHE_DIR: options.cacheDir,
    CLOAKBROWSER_BINARY_PATH: options.binaryPath,
    CLOAKBROWSER_VERSION: options.version,
  };
  if (options.licenseKeyEnv !== undefined) {
    const value = process.env[options.licenseKeyEnv];
    if (value !== undefined) updates['CLOAKBROWSER_LICENSE_KEY'] = value;
  }

  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      if (key === 'CLOAKBROWSER_AUTO_UPDATE' && options.autoUpdate !== false) continue;
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function unsafeEvalReason(expression: string): string | undefined {
  const patterns: readonly [RegExp, string][] = [
    [/\bdocument\s*\.\s*cookie\b/i, 'document.cookie access'],
    [/\blocalStorage\b/i, 'localStorage access'],
    [/\bsessionStorage\b/i, 'sessionStorage access'],
    [/\bindexedDB\b/i, 'indexedDB access'],
    [/\bfetch\s*\(/i, 'network fetch'],
    [/\bXMLHttpRequest\b/i, 'XMLHttpRequest'],
    [/\bquerySelector(?:All)?\s*\([^)]*(?:input|textarea|password)[^)]*\).*\.value\b/is, 'form value extraction'],
  ];
  return patterns.find(([pattern]) => pattern.test(expression))?.[1];
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Browser use call was aborted.');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function actionableLaunchError(error: unknown): string {
  return `${describeError(error)}. Use BrowserStatus or \`kimi browser-use doctor\` before installing Playwright or Chrome manually.`;
}

function statusFromSetupResult(result: SetupCommandResult, ok: boolean): BrowserStatus {
  return {
    platform: process.platform,
    installed: ok,
    ready: ok,
    version: firstNonEmpty(result.stdout, result.stderr) || undefined,
    command: result.command,
    error: ok ? undefined : setupResultDetail(result),
  };
}

function setupResultDetail(result: SetupCommandResult): string {
  return firstNonEmpty(
    result.error,
    result.stderr,
    result.stdout,
    result.code === null ? undefined : `exit code ${String(result.code)}`,
    'unknown error',
  );
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  return values.map((value) => value?.trim() ?? '').find((value) => value.length > 0) ?? '';
}

interface SnapshotData {
  readonly snapshot: string;
  readonly refs: readonly BrowserRef[];
}

async function collectPageSnapshot(page: Page, full: boolean): Promise<SnapshotData> {
  return page.evaluate((args) => {
    const doc = (globalThis as any).document;
    const win = (globalThis as any).window;
    const loc = (globalThis as any).location;
    const css = (globalThis as any).CSS;
    const node = (globalThis as any).Node;
    const maxTextLength = args.full ? 30_000 : 8_000;
    const bodyText = doc.body?.innerText ?? '';
    const selectors = [
      'a',
      'button',
      'input',
      'textarea',
      'select',
      '[role]',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
    ].join(',');
    const elements = Array.from(doc.querySelectorAll(selectors) as any[])
      .filter((element) => {
        const style = win.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0;
      })
      .slice(0, 200);

    const refs = elements.map((element, index) => {
      const ref = `@e${String(index + 1)}`;
      const rect = element.getBoundingClientRect();
      const selector = uniqueSelector(element);
      const role = element.getAttribute('role') ?? inferredRole(element);
      const name = accessibleName(element);
      const tag = element.tagName.toLowerCase();
      return {
        ref,
        selector,
        role,
        name,
        tag,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    });

    const lines = [
      `URL: ${loc.href}`,
      `Title: ${doc.title}`,
      '',
      'Interactive elements:',
      ...refs.map((entry) => {
        const label = entry.name.length > 0 ? ` "${entry.name}"` : '';
        const bounds = entry.bounds === undefined
          ? ''
          : ` @ (${entry.bounds.x},${entry.bounds.y},${entry.bounds.width},${entry.bounds.height})`;
        return `${entry.ref} ${entry.role}${label} <${entry.tag}>${bounds}`;
      }),
      '',
      'Page text:',
      bodyText.length > maxTextLength ? `${bodyText.slice(0, maxTextLength)}\n[...truncated]` : bodyText,
    ];

    return {
      snapshot: lines.join('\n'),
      refs,
    };

    function accessibleName(element: any): string {
      const aria = element.getAttribute('aria-label');
      if (aria !== null && aria.trim().length > 0) return aria.trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy !== null) {
        const labelled = labelledBy
          .split(/\s+/)
          .map((id: string) => doc.getElementById(id)?.innerText ?? '')
          .join(' ')
          .trim();
        if (labelled.length > 0) return labelled;
      }
      const tag = String(element.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        return element.value || element.placeholder || element.name || element.type;
      }
      if (tag === 'select') {
        return element.name || selectedText(element);
      }
      const title = element.getAttribute('title');
      if (title !== null && title.trim().length > 0) return title.trim();
      return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    }

    function selectedText(element: any): string {
      return Array.from(element.selectedOptions ?? []).map((option: any) => option.text).join(', ');
    }

    function inferredRole(element: any): string {
      const tag = element.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const type = (element.getAttribute('type') ?? 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        return 'textbox';
      }
      return tag;
    }

    function uniqueSelector(element: any): string {
      const id = element.getAttribute('id');
      if (id !== null && id.trim().length > 0) return `#${escapeCssIdent(id)}`;
      const path: string[] = [];
      let current: any = element;
      while (current !== null && current.nodeType === node.ELEMENT_NODE && current !== doc.body) {
        const parent = current.parentElement;
        if (parent === null) break;
        const tag = current.tagName.toLowerCase();
        const currentTag = current.tagName;
        const siblings = Array.from(parent.children as any[]).filter((child: any) => child.tagName === currentTag);
        const nth = siblings.indexOf(current) + 1;
        path.unshift(`${tag}:nth-of-type(${String(nth)})`);
        current = parent;
      }
      return path.length === 0 ? 'body' : `body > ${path.join(' > ')}`;
    }

    function escapeCssIdent(value: string): string {
      return typeof css?.escape === 'function'
        ? css.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }
  }, { full });
}
