import type { NativeInputEvent } from '@harness-kit/tui-renderer';
import {
  encodeKittyPlaceholderTransmit,
  encodeKittyPlaceholderLines,
  encodeKittyDeleteImage,
} from '@harness-kit/tui-renderer';
import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
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
  zoom: number; // 0.5 to 2.0
}

interface Tab {
  id: number;
  url: string;
  title: string;
  state: BrowserState;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_ID_BASE = 1000; // Base ID for browser screenshots
const MAX_TABS = 5;
const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

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
  private runtimePromise: Promise<BrowserUseRuntime> | null = null;
  private tabs: Tab[] = [];
  private activeTabId = 0;
  private nextTabId = 1;
  private urlInput = '';
  private editingUrl = false;
  private scrollTop = 0;
  private readonly cwd: string;
  private lastTransmittedImageId: number | null = null;
  private consoleOpen = false;
  private consoleOutput: string[] = [];
  private consoleInput = '';
  /** Page load time tracking */
  private navStartTime = 0;
  private lastLoadTimeMs = 0;
  // Form input mode
  private formMode = false;
  private selectedRef: string | null = null;
  private formInput = '';
  private refsList: { ref: string; role: string; name: string }[] = [];
  private refsCursor = 0;
  // Render cache for incremental rendering
  private renderCache: { key: string; lines: string[] } | null = null;
  private observationVersion = 0;

  constructor(cwd: string) {
    this.cwd = cwd;
    // Create initial tab
    this.tabs.push({
      id: 0,
      url: '',
      title: 'New Tab',
      state: this.createInitialState(),
    });
  }

  private createInitialState(): BrowserState {
    return {
      url: '',
      title: '',
      loading: false,
      error: null,
      screenshot: null,
      observation: null,
      zoom: 1.0,
    };
  }

  private get activeTab(): Tab {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? this.tabs[0]!;
  }

  private get state(): BrowserState {
    return this.activeTab.state;
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean): string[] {
    // Check render cache for incremental rendering
    const cacheKey = this.computeRenderCacheKey(width, height, focused);
    if (this.renderCache && this.renderCache.key === cacheKey) {
      return this.renderCache.lines;
    }

    const lines: string[] = [];

    // Tab bar
    lines.push(this.renderTabBar(width, focused));

    // URL bar
    lines.push(this.renderUrlBar(width, focused));

    // Status bar
    lines.push(this.renderStatusBar(width));

    // Content area
    const contentHeight = height - 3;
    const contentLines = this.renderContent(width, contentHeight);
    lines.push(...contentLines);

    const result = this.fillLines(lines, height, width);
    this.renderCache = { key: cacheKey, lines: result };
    return result;
  }

  /** Compute a cache key representing all state that affects rendering. */
  private computeRenderCacheKey(width: number, height: number, focused: boolean): string {
    const tab = this.activeTab;
    const state = tab?.state;
    return [
      width,
      height,
      focused ? 1 : 0,
      this.activeTabId,
      this.tabs.length,
      tab?.url ?? '',
      tab?.title ?? '',
      state?.loading ? 1 : 0,
      state?.error ?? '',
      state?.screenshot ? 1 : 0,
      state?.observation ? 1 : 0,
      this.observationVersion,
      state?.zoom ?? 1,
      this.urlInput,
      this.editingUrl ? 1 : 0,
      this.scrollTop,
      this.consoleOpen ? 1 : 0,
      this.consoleOutput.length,
      this.consoleInput,
      this.formMode ? 1 : 0,
      this.selectedRef ?? '',
      this.formInput,
      this.refsCursor,
      this.lastTransmittedImageId ?? -1,
    ].join('|');
  }

  onInput(event: NativeInputEvent): boolean {
    if (event.type === 'key') {
      // Console mode
      if (this.consoleOpen) {
        return this.handleConsoleInput(event);
      }

      // Form input mode
      if (this.formMode) {
        return this.handleFormInput(event);
      }

      // URL editing mode
      if (this.editingUrl) {
        return this.handleUrlInput(event);
      }

      // Global shortcuts
      if (event.key === 'character') {
        switch (event.text?.toLowerCase()) {
          case 'l': // Focus URL bar
            this.editingUrl = true;
            this.urlInput = this.state.url;
            return true;
          case 'r': // Reload
            void this.navigate(this.state.url);
            return true;
          case 'b': // Back
            void this.goBack();
            return true;
          case 'f': // Forward
            void this.goForward();
            return true;
          case 't': // New tab
            this.createNewTab();
            return true;
          case 'w': // Close tab
            this.closeActiveTab();
            return true;
          case 'c': // Console
            this.consoleOpen = true;
            return true;
          case 'i': // Form input mode
            this.enterFormMode();
            return true;
          case '+': // Zoom in
            this.zoomIn();
            return true;
          case '-': // Zoom out
            this.zoomOut();
            return true;
          case '0': // Reset zoom
            this.state.zoom = 1.0;
            return true;
        }

        // Tab switching with number keys
        const text = event.text;
        if (text && text >= '1' && text <= '9') {
          const tabIndex = Number.parseInt(text, 10) - 1;
          if (tabIndex < this.tabs.length) {
            this.activeTabId = this.tabs[tabIndex]!.id;
            return true;
          }
        }
      }

      // Scroll
      if (event.key === 'up') {
        this.scrollTop = Math.max(0, this.scrollTop - 1);
        return true;
      }
      if (event.key === 'down') {
        this.scrollTop++;
        return true;
      }
      if (event.key === 'pageup') {
        this.scrollTop = Math.max(0, this.scrollTop - 10);
        return true;
      }
      if (event.key === 'pagedown') {
        this.scrollTop += 10;
        return true;
      }
    }

    // Mouse events
    if (event.type === 'mouse') {
      return this.handleMouseEvent(event);
    }

    return false;
  }

  onFocus(): void {}

  onBlur(): void {
    this.editingUrl = false;
    this.consoleOpen = false;
    this.formMode = false;
    this.selectedRef = null;
    this.formInput = '';
  }

  onResize(_width: number, _height: number): void {}

  dispose(): void {
    // Clean up transmitted images
    if (this.lastTransmittedImageId !== null) {
      // Note: We can't actually send the delete command here since we don't
      // have access to the terminal output. The image will be cleaned up
      // when the terminal exits alternate screen mode.
    }
    void this.runtime?.close().catch(() => {});
    this.runtime = null;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderTabBar(width: number, focused: boolean): string {
    const tabs = this.tabs.map((tab, index) => {
      const isActive = tab.id === this.activeTabId;
      const title = tab.title.slice(0, 15) || 'New Tab';
      if (isActive) {
        return currentTheme.bg('selectionBg', currentTheme.fg('selectionText', ` ${String(index + 1)}:${title} `));
      }
      return currentTheme.dimFg('textMuted', ` ${String(index + 1)}:${title} `);
    });
    const tabBar = tabs.join(currentTheme.dimFg('border', '│'));
    return this.pad(` ${tabBar}`, width);
  }

  private renderUrlBar(width: number, focused: boolean): string {
    const prefix = ` ${currentTheme.fg('accent', '🔗')} `;
    const suffix = this.editingUrl ? '▏' : '';
    const url = this.editingUrl ? this.urlInput : this.state.url;
    const maxUrlWidth = width - prefix.length - suffix.length - 2;
    const displayUrl = url.length > maxUrlWidth
      ? url.slice(0, maxUrlWidth - 1) + '…'
      : url;

    const urlStyled = this.editingUrl
      ? currentTheme.fg('text', displayUrl) + currentTheme.fg('primary', suffix)
      : currentTheme.dimFg('textMuted', displayUrl);
    const bar = `${prefix}${urlStyled}`;
    const border = focused ? currentTheme.fg('primary', '│') : currentTheme.dimFg('border', '│');
    return `${border} ${this.pad(bar, width - 4)} ${border}`;
  }

  private renderStatusBar(width: number): string {
    const zoom = Math.round(this.state.zoom * 100);
    if (this.state.loading) {
      const appearance = getActiveAppearancePreferences();
      // Animated indeterminate progress bar
      const BAR_W = Math.min(20, width - 16);
      const pos = Math.floor(Date.now() / 100) % (BAR_W + 4);
      const barChars = Array.from({ length: BAR_W }, (_, i) => {
        const dist = Math.abs(i - (pos % BAR_W));
        if (dist <= 1) return currentTheme.fg('primary', '█');
        if (dist <= 3) return currentTheme.fg('accent', '▓');
        return currentTheme.dimFg('border', '░');
      }).join('');
      const loadTimeLabel = this.lastLoadTimeMs > 0 ? ` ${String(this.lastLoadTimeMs)}ms` : '';
      const loadingText = `  ${barChars} ${zoom}%${loadTimeLabel}`;
      return this.pad(shouldRenderAmbientEffects(appearance)
        ? loadingText
        : this.dim(`  ⏳ Loading... (${zoom}%)`), width);
    }
    if (this.state.error) {
      return this.pad(this.red(`  ❌ ${this.state.error}`), width);
    }
    if (this.state.title) {
      return this.pad(this.dim(`  📄 ${this.state.title} (${zoom}%)`), width);
    }
    return this.pad(this.dim(`  Enter a URL to browse (${zoom}%)`), width);
  }

  private renderContent(width: number, height: number): string[] {
    // Console overlay
    if (this.consoleOpen) {
      return this.renderConsole(width, height);
    }

    // Form input mode
    if (this.formMode) {
      return this.renderFormMode(width, height);
    }

    // Screenshot with Kitty graphics
    if (this.state.screenshot && this.state.screenshot.base64) {
      return this.renderScreenshotWithKitty(width, height);
    }

    // Text snapshot fallback
    if (this.state.observation) {
      return this.renderTextSnapshot(width, height);
    }

    // Welcome screen
    return this.renderWelcome(width, height);
  }

  private renderScreenshotWithKitty(width: number, height: number): string[] {
    const screenshot = this.state.screenshot!;
    const lines: string[] = [];

    // Calculate image dimensions based on zoom
    const baseWidth = Math.min(width, 80);
    const baseHeight = Math.min(height - 2, 40);
    const imageWidth = Math.floor(baseWidth * this.state.zoom);
    const imageHeight = Math.floor(baseHeight * this.state.zoom);

    // Image ID for this tab
    const imageId = IMAGE_ID_BASE + this.activeTabId;

    // Transmit the image (this would be sent to the terminal)
    // Note: In a real implementation, this would be sent via a side channel
    // since the render method only returns text lines.
    const transmitCommand = encodeKittyPlaceholderTransmit({
      id: imageId,
      base64: screenshot.base64,
      columns: imageWidth,
      rows: imageHeight,
    });

    // Store for later transmission
    this.pendingTransmit = transmitCommand;
    this.lastTransmittedImageId = imageId;

    // Generate placeholder lines
    const placeholderLines = encodeKittyPlaceholderLines({
      id: imageId,
      columns: Math.min(imageWidth, width),
      rows: Math.min(imageHeight, height - 2),
    });

    lines.push(this.dim(`  [Kitty Graphics: ${screenshot.width ?? '?'}x${screenshot.height ?? '?'} → ${imageWidth}x${imageHeight}]`));
    lines.push(...placeholderLines);

    return lines;
  }

  private pendingTransmit: string | null = null;

  /**
   * Get pending Kitty graphics transmit command.
   * Called by the frame renderer to send the image data.
   */
  getPendingTransmit(): string | null {
    const transmit = this.pendingTransmit;
    this.pendingTransmit = null;
    return transmit;
  }

  private renderTextSnapshot(width: number, height: number): string[] {
    const snapshotLines = this.state.observation!.snapshot.split('\n');
    const lines: string[] = [];

    lines.push(this.dim('  [Text Snapshot Mode]'));

    for (let i = this.scrollTop; i < Math.min(snapshotLines.length, this.scrollTop + height - 2); i++) {
      lines.push(this.pad(snapshotLines[i] ?? '', width));
    }

    return lines;
  }

  private renderWelcome(width: number, height: number): string[] {
    const lines: string[] = [
      '',
      this.pad('  🌐 SuperLiora Browser', width),
      '',
      this.pad(this.dim('  Shortcuts:'), width),
      this.pad(this.dim('    L     - Focus URL bar'), width),
      this.pad(this.dim('    R     - Reload page'), width),
      this.pad(this.dim('    B/F   - Back/Forward'), width),
      this.pad(this.dim('    T     - New tab'), width),
      this.pad(this.dim('    W     - Close tab'), width),
      this.pad(this.dim('    C     - JavaScript console'), width),
      this.pad(this.dim('    I     - Form input mode'), width),
      this.pad(this.dim('    +/-   - Zoom in/out'), width),
      this.pad(this.dim('    0     - Reset zoom'), width),
      this.pad(this.dim('    1-9   - Switch to tab N'), width),
      '',
      this.pad(this.dim('  Mouse:'), width),
      this.pad(this.dim('    Click - Click on page'), width),
      this.pad(this.dim('    Wheel - Scroll page'), width),
    ];
    return lines;
  }

  private renderConsole(width: number, height: number): string[] {
    const lines: string[] = [];
    lines.push(this.cyan('  ┌─ JavaScript Console ─────────────────────────────────'));

    const outputHeight = height - 3;
    const output = this.consoleOutput.slice(-outputHeight);
    for (const line of output) {
      lines.push(this.pad(`  │ ${line}`, width));
    }

    lines.push(this.cyan('  ├─────────────────────────────────────────────────────'));
    lines.push(this.pad(`  │ > ${this.consoleInput}▏`, width));
    lines.push(this.cyan('  └─────────────────────────────────────────────────────'));
    lines.push(this.dim('  Press Escape to close console'));

    return lines;
  }

  // -------------------------------------------------------------------------
  // Browser operations
  // -------------------------------------------------------------------------

  async navigate(url: string): Promise<void> {
    if (!url || url.trim().length === 0) return;

    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    this.state.loading = true;
    this.state.error = null;
    this.state.url = normalizedUrl;
    this.navStartTime = Date.now();
    this.activeTab.url = normalizedUrl;

    try {
      const runtime = await this.getRuntime();
      const observation = await runtime.observe({ url: normalizedUrl });

      if (observation.ok) {
        this.state.title = observation.title;
        this.activeTab.title = observation.title;
        this.state.observation = observation;
        this.observationVersion++;

        const screenshot = await runtime.screenshot({});
        this.state.screenshot = screenshot;
      } else {
        this.state.error = observation.error ?? 'Failed to load page';
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.lastLoadTimeMs = Date.now() - this.navStartTime;
      this.state.loading = false;
    }
  }

  private async goBack(): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      await runtime.act({ actions: [{ type: 'back' }] });
      await this.refreshObservation();
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async goForward(): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      await runtime.act({ actions: [{ type: 'forward' }] });
      await this.refreshObservation();
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
      await this.refreshObservation();
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
      this.observationVersion++;
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async executeJavaScript(code: string): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      const result = await runtime.console({ expression: code });
      if (result.ok) {
        this.consoleOutput.push(`> ${code}`);
        if (result.result !== undefined) {
          this.consoleOutput.push(this.dim(`← ${JSON.stringify(result.result)}`));
        }
        if (result.error) {
          this.consoleOutput.push(this.red(`✖ ${result.error}`));
        }
      } else {
        this.consoleOutput.push(this.red(`✖ ${result.error ?? 'Execution failed'}`));
      }
    } catch (error) {
      this.consoleOutput.push(this.red(`✖ ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async refreshObservation(): Promise<void> {
    const runtime = await this.getRuntime();
    const observation = await runtime.observe({});
    if (observation.ok) {
      this.state.url = observation.url;
      this.activeTab.url = observation.url;
      this.state.title = observation.title;
      this.activeTab.title = observation.title;
      this.state.observation = observation;
      this.observationVersion++;
      const screenshot = await runtime.screenshot({});
      this.state.screenshot = screenshot;
    }
  }

  private getRuntime(): Promise<BrowserUseRuntime> {
    if (this.runtime) return Promise.resolve(this.runtime);

    // Share one in-flight creation so concurrent callers cannot spawn
    // multiple browser processes.
    this.runtimePromise ??= (async () => {
      const { createBrowserUseRuntime } = await import('@superliora/sdk');
      const runtime = createBrowserUseRuntime({
        headless: true,
        viewport: { width: 1280, height: 720 },
      });
      this.runtime = runtime;
      return runtime;
    })().catch((error: unknown) => {
      this.runtimePromise = null;
      throw error;
    });

    return this.runtimePromise;
  }

  // -------------------------------------------------------------------------
  // Tab management
  // -------------------------------------------------------------------------

  private createNewTab(): void {
    if (this.tabs.length >= MAX_TABS) {
      this.state.error = `Maximum ${MAX_TABS} tabs allowed`;
      return;
    }

    const newId = this.nextTabId++;
    this.tabs.push({
      id: newId,
      url: '',
      title: 'New Tab',
      state: this.createInitialState(),
    });
    this.activeTabId = newId;
  }

  private closeActiveTab(): void {
    if (this.tabs.length <= 1) {
      this.state.error = 'Cannot close the last tab';
      return;
    }

    const index = this.tabs.findIndex((t) => t.id === this.activeTabId);
    this.tabs.splice(index, 1);

    // Switch to adjacent tab
    const newIndex = Math.min(index, this.tabs.length - 1);
    this.activeTabId = this.tabs[newIndex]!.id;
  }

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  private zoomIn(): void {
    const currentIndex = ZOOM_LEVELS.indexOf(this.state.zoom);
    if (currentIndex < ZOOM_LEVELS.length - 1) {
      this.state.zoom = ZOOM_LEVELS[currentIndex + 1]!;
    }
  }

  private zoomOut(): void {
    const currentIndex = ZOOM_LEVELS.indexOf(this.state.zoom);
    if (currentIndex > 0) {
      this.state.zoom = ZOOM_LEVELS[currentIndex - 1]!;
    }
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

  private handleConsoleInput(event: NativeInputEvent): boolean {
    if (event.type !== 'key') return false;

    if (event.key === 'escape') {
      this.consoleOpen = false;
      return true;
    }

    if (event.key === 'enter') {
      const code = this.consoleInput.trim();
      if (code) {
        void this.executeJavaScript(code);
      }
      this.consoleInput = '';
      return true;
    }

    if (event.key === 'backspace') {
      this.consoleInput = this.consoleInput.slice(0, -1);
      return true;
    }

    if (event.key === 'character' && event.text) {
      this.consoleInput += event.text;
      return true;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Form input mode
  // -------------------------------------------------------------------------

  private enterFormMode(): void {
    const observation = this.state.observation;
    if (!observation || observation.refs.length === 0) {
      this.state.error = 'No interactive elements found on this page';
      return;
    }

    // Filter to input-capable elements
    this.refsList = observation.refs
      .filter((ref) =>
        ref.role === 'textbox' ||
        ref.role === 'searchbox' ||
        ref.role === 'combobox' ||
        ref.tag === 'input' ||
        ref.tag === 'textarea' ||
        ref.tag === 'select'
      )
      .map((ref) => ({
        ref: ref.ref,
        role: ref.role,
        name: ref.name || ref.selector,
      }));

    if (this.refsList.length === 0) {
      this.state.error = 'No input fields found on this page';
      return;
    }

    this.formMode = true;
    this.refsCursor = 0;
    this.selectedRef = null;
    this.formInput = '';
  }

  private handleFormInput(event: NativeInputEvent): boolean {
    if (event.type !== 'key') return false;

    // If we're typing into a field
    if (this.selectedRef !== null) {
      if (event.key === 'escape') {
        this.selectedRef = null;
        this.formInput = '';
        return true;
      }

      if (event.key === 'enter') {
        void this.submitFormInput();
        return true;
      }

      if (event.key === 'backspace') {
        this.formInput = this.formInput.slice(0, -1);
        return true;
      }

      if (event.key === 'character' && event.text) {
        this.formInput += event.text;
        return true;
      }

      return false;
    }

    // Selecting a field
    if (event.key === 'escape') {
      this.formMode = false;
      return true;
    }

    if (event.key === 'up') {
      this.refsCursor = Math.max(0, this.refsCursor - 1);
      return true;
    }

    if (event.key === 'down') {
      this.refsCursor = Math.min(this.refsList.length - 1, this.refsCursor + 1);
      return true;
    }

    if (event.key === 'enter') {
      const selected = this.refsList[this.refsCursor];
      if (selected) {
        this.selectedRef = selected.ref;
        this.formInput = '';
        void this.focusFormField(selected.ref);
      }
      return true;
    }

    return false;
  }

  private async focusFormField(ref: string): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      await runtime.act({
        actions: [{ type: 'click_ref', ref }],
      });
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async submitFormInput(): Promise<void> {
    if (this.selectedRef === null) return;

    try {
      const runtime = await this.getRuntime();
      await runtime.act({
        actions: [
          { type: 'type_text', text: this.formInput, ref: this.selectedRef, clear: true },
        ],
        captureAfter: true,
      });
      await this.refreshObservation();
      this.selectedRef = null;
      this.formInput = '';
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  private renderFormMode(width: number, height: number): string[] {
    const lines: string[] = [];
    lines.push(this.cyan('  ┌─ Form Input Mode ────────────────────────────────────'));

    if (this.selectedRef !== null) {
      // Typing into a field
      const selected = this.refsList.find((r) => r.ref === this.selectedRef);
      lines.push(this.pad(`  │ Field: ${selected?.name ?? this.selectedRef}`, width));
      lines.push(this.cyan('  ├─────────────────────────────────────────────────────'));
      lines.push(this.pad(`  │ > ${this.formInput}▏`, width));
      lines.push(this.dim('  │ Press Enter to submit, Escape to cancel'));
    } else {
      // Selecting a field
      const listHeight = height - 4;
      lines.push(this.pad('  │ Select an input field:', width));
      lines.push(this.cyan('  ├─────────────────────────────────────────────────────'));

      for (let i = 0; i < Math.min(this.refsList.length, listHeight); i++) {
        const item = this.refsList[i]!;
        const marker = i === this.refsCursor ? this.cyan('▸') : ' ';
        const role = this.dim(`[${item.role}]`);
        lines.push(this.pad(`  │ ${marker} ${role} ${item.name}`, width));
      }

      lines.push(this.dim('  │ ↑/↓ to select, Enter to edit, Escape to exit'));
    }

    lines.push(this.cyan('  └─────────────────────────────────────────────────────'));
    return lines;
  }

  private handleMouseEvent(event: NativeInputEvent): boolean {
    if (event.type !== 'mouse') return false;

    if (event.action === 'press' && event.button === 'left') {
      const browserX = event.x * 10;
      const browserY = event.y * 20;
      void this.clickAt(browserX, browserY);
      return true;
    }

    if (event.action === 'wheel') {
      if (event.button === 'wheel-up') {
        void this.scroll('up');
        return true;
      }
      if (event.button === 'wheel-down') {
        void this.scroll('down');
        return true;
      }
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

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
    return currentTheme.dimFg('textDim', text);
  }

  private cyan(text: string): string {
    return currentTheme.fg('primary', text);
  }

  private red(text: string): string {
    return currentTheme.fg('error', text);
  }
}
