import type { NativeInputEvent } from '@harness-kit/tui-renderer';
import type {
  BrowserUseRuntime,
  BrowserObservation,
  RuntimeImage,
} from '@superliora/sdk';

import type { PanelDefinition } from '../panel-definition';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  error: string | null;
  screenshot: RuntimeImage | null;
  observation: BrowserObservation | null;
}

// ---------------------------------------------------------------------------
// WebBrowserPanel
// ---------------------------------------------------------------------------

export class WebBrowserPanel implements PanelDefinition {
  readonly id = 'web-browser';
  readonly title = 'Browser';
  readonly icon = '🌐';
  readonly minWidth = 40;
  readonly minHeight = 10;

  private runtime: BrowserUseRuntime | null = null;
  private state: BrowserState = {
    url: '',
    title: '',
    loading: false,
    error: null,
    screenshot: null,
    observation: null,
  };
  private urlInput = '';
  private editingUrl = false;
  private scrollTop = 0;
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean): string[] {
    const lines: string[] = [];

    // URL bar
    lines.push(this.renderUrlBar(width, focused));

    // Status bar
    if (this.state.loading) {
      lines.push(this.pad(this.dim('  Loading...'), width));
    } else if (this.state.error) {
      lines.push(this.pad(this.red(`  Error: ${this.state.error}`), width));
    } else if (this.state.title) {
      lines.push(this.pad(this.dim(`  ${this.state.title}`), width));
    } else {
      lines.push(this.pad(this.dim('  Enter a URL to browse'), width));
    }

    // Content area
    const contentHeight = height - 2;
    if (this.state.screenshot) {
      // Display screenshot info (actual rendering via Kitty graphics)
      lines.push(this.pad(this.dim('  [Screenshot captured - use Kitty graphics to display]'), width));
      lines.push(this.pad(this.dim(`  Size: ${this.state.screenshot.width ?? '?'}x${this.state.screenshot.height ?? '?'}`), width));
    } else if (this.state.observation) {
      // Display page snapshot as text
      const snapshotLines = this.state.observation.snapshot.split('\n');
      for (let i = this.scrollTop; i < Math.min(snapshotLines.length, this.scrollTop + contentHeight - 2); i++) {
        lines.push(this.pad(snapshotLines[i] ?? '', width));
      }
    } else {
      lines.push(this.pad('', width));
      lines.push(this.pad(this.dim('  Welcome to SuperLiora Browser'), width));
      lines.push(this.pad(this.dim('  Type a URL and press Enter to start'), width));
    }

    return this.fillLines(lines, height, width);
  }

  onInput(event: NativeInputEvent): boolean {
    if (event.type === 'key') {
      if (this.editingUrl) {
        return this.handleUrlInput(event);
      }

      // Navigation keys
      if (event.key === 'character') {
        if (event.text === 'l' || event.text === 'L') {
          // Focus URL bar
          this.editingUrl = true;
          this.urlInput = this.state.url;
          return true;
        }
        if (event.text === 'r' || event.text === 'R') {
          // Reload
          void this.navigate(this.state.url);
          return true;
        }
        if (event.text === 'b' || event.text === 'B') {
          // Back
          void this.goBack();
          return true;
        }
        if (event.text === 'f' || event.text === 'F') {
          // Forward
          void this.goForward();
          return true;
        }
      }

      // Scroll
      if (event.key === 'arrowUp') {
        this.scrollTop = Math.max(0, this.scrollTop - 1);
        return true;
      }
      if (event.key === 'arrowDown') {
        this.scrollTop++;
        return true;
      }
      if (event.key === 'pageUp') {
        this.scrollTop = Math.max(0, this.scrollTop - 10);
        return true;
      }
      if (event.key === 'pageDown') {
        this.scrollTop += 10;
        return true;
      }
    }

    // Mouse events for interaction
    if (event.type === 'mouse') {
      return this.handleMouseEvent(event);
    }

    return false;
  }

  onFocus(): void {
    // Panel focused
  }

  onBlur(): void {
    this.editingUrl = false;
  }

  onResize(_width: number, _height: number): void {
    // Handle resize
  }

  dispose(): void {
    void this.runtime?.close();
    this.runtime = null;
  }

  // -------------------------------------------------------------------------
  // Browser operations
  // -------------------------------------------------------------------------

  async navigate(url: string): Promise<void> {
    if (!url || url.trim().length === 0) return;

    // Normalize URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    this.state.loading = true;
    this.state.error = null;
    this.state.url = normalizedUrl;

    try {
      const runtime = await this.getRuntime();

      // Navigate and get observation
      const observation = await runtime.observe({ url: normalizedUrl });

      if (observation.ok) {
        this.state.title = observation.title;
        this.state.observation = observation;

        // Take screenshot
        const screenshot = await runtime.screenshot({});
        this.state.screenshot = screenshot;
      } else {
        this.state.error = observation.error ?? 'Failed to load page';
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.state.loading = false;
    }
  }

  private async goBack(): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      await runtime.act({ actions: [{ type: 'back' }] });
      const observation = await runtime.observe({});
      if (observation.ok) {
        this.state.url = observation.url;
        this.state.title = observation.title;
        this.state.observation = observation;
        const screenshot = await runtime.screenshot({});
        this.state.screenshot = screenshot;
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async goForward(): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      await runtime.act({ actions: [{ type: 'forward' }] });
      const observation = await runtime.observe({});
      if (observation.ok) {
        this.state.url = observation.url;
        this.state.title = observation.title;
        this.state.observation = observation;
        const screenshot = await runtime.screenshot({});
        this.state.screenshot = screenshot;
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async clickAt(x: number, y: number): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      await runtime.act({
        actions: [{ type: 'click_xy', x, y }],
        captureAfter: true,
      });
      const observation = await runtime.observe({});
      if (observation.ok) {
        this.state.url = observation.url;
        this.state.title = observation.title;
        this.state.observation = observation;
        const screenshot = await runtime.screenshot({});
        this.state.screenshot = screenshot;
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async scroll(direction: 'up' | 'down', amount = 3): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      await runtime.act({
        actions: [{ type: 'scroll', direction, amount }],
      });
      const screenshot = await runtime.screenshot({});
      this.state.screenshot = screenshot;
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async getRuntime(): Promise<BrowserUseRuntime> {
    if (this.runtime) return this.runtime;

    // Dynamic import to avoid bundling issues
    const { createBrowserUseRuntime } = await import('@superliora/sdk');
    this.runtime = createBrowserUseRuntime({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });

    return this.runtime;
  }

  // -------------------------------------------------------------------------
  // Input handlers
  // -------------------------------------------------------------------------

  private handleUrlInput(event: NativeInputEvent): boolean {
    if (event.type !== 'key') return false;

    if (event.key === 'enter') {
      this.editingUrl = false;
      void this.navigate(this.urlInput);
      return true;
    }

    if (event.key === 'escape') {
      this.editingUrl = false;
      this.urlInput = this.state.url;
      return true;
    }

    if (event.key === 'backspace') {
      this.urlInput = this.urlInput.slice(0, -1);
      return true;
    }

    if (event.key === 'character' && event.text) {
      this.urlInput += event.text;
      return true;
    }

    return false;
  }

  private handleMouseEvent(event: NativeInputEvent): boolean {
    if (event.type !== 'mouse') return false;

    // Handle mouse click for interaction
    if (event.action === 'press' && event.button === 'left') {
      // Convert terminal coordinates to browser coordinates
      // This is a simplified mapping - actual implementation would need
      // to account for the screenshot dimensions and panel position
      const browserX = event.x * 10; // Approximate scaling
      const browserY = event.y * 20;
      void this.clickAt(browserX, browserY);
      return true;
    }

    // Handle mouse wheel for scrolling
    if (event.action === 'scrollUp') {
      void this.scroll('up');
      return true;
    }
    if (event.action === 'scrollDown') {
      void this.scroll('down');
      return true;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Rendering helpers
  // -------------------------------------------------------------------------

  private renderUrlBar(width: number, focused: boolean): string {
    const prefix = ' 🔗 ';
    const suffix = this.editingUrl ? '▏' : '';
    const url = this.editingUrl ? this.urlInput : this.state.url;
    const maxUrlWidth = width - prefix.length - suffix.length - 2;
    const displayUrl = url.length > maxUrlWidth
      ? url.slice(0, maxUrlWidth - 1) + '…'
      : url;

    const bar = `${prefix}${displayUrl}${suffix}`;
    const border = focused ? this.cyan('│') : this.dim('│');
    return `${border} ${this.pad(bar, width - 4)} ${border}`;
  }

  private pad(text: string, width: number): string {
    if (text.length >= width) return text.slice(0, width);
    return text + ' '.repeat(width - text.length);
  }

  private fillLines(lines: string[], height: number, width: number): string[] {
    const result = [...lines];
    while (result.length < height) {
      result.push(this.pad('', width));
    }
    return result.slice(0, height);
  }

  private dim(text: string): string {
    return `\x1b[2m${text}\x1b[0m`;
  }

  private cyan(text: string): string {
    return `\x1b[36m${text}\x1b[0m`;
  }

  private red(text: string): string {
    return `\x1b[31m${text}\x1b[0m`;
  }
}
