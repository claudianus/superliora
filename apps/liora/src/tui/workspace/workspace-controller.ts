import type {
  NativeInputEvent,
  NativeInputRouter,
  RendererRect,
  WorkspaceLayoutResult,
} from '@harness-kit/tui-renderer';
import {
  measureWorkspaceLayout,
  renderPanelFrame,
  hitTestPanelBorder,
} from '@harness-kit/tui-renderer';

import { DragController } from './drag-controller';
import { PanelManager } from './panel-manager';
import type { PanelDefinition } from './panel-definition';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceControllerOptions {
  readonly panelManager: PanelManager;
  readonly inputRouter: NativeInputRouter;
  /** Callback to request a re-render of the entire TUI. */
  readonly requestRender: () => void;
}

export interface WorkspaceRenderContext {
  readonly terminalColumns: number;
  readonly terminalRows: number;
}

// ---------------------------------------------------------------------------
// WorkspaceController
// ---------------------------------------------------------------------------

/**
 * Orchestrates the multi-panel workspace layout.
 * Sits between the main TUI frame renderer and the terminal output,
 * compositing side panels alongside the main content.
 */
export class WorkspaceController {
  readonly panelManager: PanelManager;
  private readonly dragController: DragController;
  private readonly requestRender: () => void;
  private currentLayout: WorkspaceLayoutResult | null = null;
  private enabled = true;

  constructor(options: WorkspaceControllerOptions) {
    this.panelManager = options.panelManager;
    this.requestRender = options.requestRender;

    this.dragController = new DragController(this.panelManager, {
      onLayoutChange: () => this.requestRender(),
      getLayout: () => this.currentLayout,
    });

    this.dragController.attach(options.inputRouter);
  }

  // -------------------------------------------------------------------------
  // Enable/disable
  // -------------------------------------------------------------------------

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.currentLayout = null;
    }
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Layout computation
  // -------------------------------------------------------------------------

  /**
   * Compute the workspace layout for the given terminal size.
   * Returns the layout result, or null if workspace is disabled/narrow.
   */
  computeLayout(ctx: WorkspaceRenderContext): WorkspaceLayoutResult | null {
    if (!this.enabled) return null;

    const layoutOptions = this.panelManager.getLayoutOptions();
    const viewport: RendererRect = {
      x: 0,
      y: 0,
      width: ctx.terminalColumns,
      height: ctx.terminalRows,
    };

    const layout = measureWorkspaceLayout({
      viewport,
      leftDockWidth: layoutOptions.leftDockWidth,
      rightDockWidth: layoutOptions.rightDockWidth,
      leftDockVisible: layoutOptions.leftDockVisible,
      rightDockVisible: layoutOptions.rightDockVisible,
    });

    // Only return layout if it has side panels
    if (layout.mode === 'narrow' || (!layout.leftDock && !layout.rightDock)) {
      this.currentLayout = null;
      return null;
    }

    this.currentLayout = layout;
    return layout;
  }

  /**
   * Get the center content rect for the main TUI frame.
   * If no workspace layout is active, returns null (use full terminal).
   */
  getCenterRect(ctx: WorkspaceRenderContext): RendererRect | null {
    const layout = this.computeLayout(ctx);
    return layout?.center ?? null;
  }

  // -------------------------------------------------------------------------
  // Panel rendering
  // -------------------------------------------------------------------------

  /**
   * Render all dock panels into lines that can be composited onto the frame.
   * Returns a map of dock ID → rendered lines (with panel frames).
   */
  renderDocks(layout: WorkspaceLayoutResult): WorkspaceDockRender {
    const result: WorkspaceDockRender = {};

    if (layout.leftDock) {
      result.left = this.renderDock('left', layout.leftDock.rect);
    }

    if (layout.rightDock) {
      result.right = this.renderDock('right', layout.rightDock.rect);
    }

    return result;
  }

  private renderDock(
    dockId: 'left' | 'right',
    dockRect: RendererRect,
  ): string[] {
    const panels = this.panelManager.getPanelsInDock(dockId);
    if (panels.length === 0) {
      return Array.from({ length: dockRect.height }, () => '');
    }

    const mode = this.panelManager.getDockMode(dockId);
    const focusedId = this.panelManager.getFocusedPanelId();

    if (mode === 'tabbed') {
      return this.renderDockTabbed(dockId, dockRect, panels, focusedId);
    }

    // Split mode: all panels stacked vertically
    const allLines: string[] = [];
    const panelHeight = Math.floor(dockRect.height / panels.length);

    for (const panel of panels) {
      const isFocused = panel.instanceId === focusedId;
      const contentWidth = dockRect.width - 2; // minus frame borders
      const contentHeight = panelHeight - 2; // minus top/bottom frame

      // Get panel content
      const content = panel.definition.render(
        Math.max(1, contentWidth),
        Math.max(1, contentHeight),
        isFocused,
      );

      // Wrap in frame
      const framed = renderPanelFrame({
        width: dockRect.width,
        height: panelHeight,
        title: panel.definition.title,
        icon: panel.definition.icon,
        focused: isFocused,
        borderStyle: isFocused ? 'rounded' : 'single',
        content,
      });

      allLines.push(...framed);
    }

    // Pad or trim to dock height
    while (allLines.length < dockRect.height) {
      allLines.push('');
    }

    return allLines.slice(0, dockRect.height);
  }

  private renderDockTabbed(
    dockId: 'left' | 'right',
    dockRect: RendererRect,
    panels: Array<{ instanceId: string; definition: { id: string; title: string; icon: string; render: (w: number, h: number, f: boolean) => string[] } }>,
    focusedId: string | null,
  ): string[] {
    const allLines: string[] = [];

    // Tab bar (1 row)
    const tabBar = this.renderTabBar(dockId, dockRect.width, panels, focusedId);
    allLines.push(tabBar);

    // Active panel content (remaining height)
    const activePanel = panels.find((p) => p.instanceId === focusedId) ?? panels[0];
    if (activePanel) {
      const contentWidth = dockRect.width - 2;
      const contentHeight = dockRect.height - 3; // tab bar + frame top/bottom

      const content = activePanel.definition.render(
        Math.max(1, contentWidth),
        Math.max(1, contentHeight),
        true,
      );

      const framed = renderPanelFrame({
        width: dockRect.width,
        height: dockRect.height - 1,
        title: activePanel.definition.title,
        icon: activePanel.definition.icon,
        focused: true,
        borderStyle: 'rounded',
        content,
      });

      allLines.push(...framed);
    }

    // Pad or trim
    while (allLines.length < dockRect.height) {
      allLines.push('');
    }

    return allLines.slice(0, dockRect.height);
  }

  private renderTabBar(
    dockId: 'left' | 'right',
    width: number,
    panels: Array<{ instanceId: string; definition: { icon: string; title: string } }>,
    focusedId: string | null,
  ): string {
    const tabs: string[] = [];
    for (const panel of panels) {
      const isActive = panel.instanceId === focusedId;
      const label = `${panel.definition.icon}${panel.definition.title.slice(0, 6)}`;
      if (isActive) {
        tabs.push(`\x1b[7m${label}\x1b[0m`);
      } else {
        tabs.push(`\x1b[2m${label}\x1b[0m`);
      }
    }
    const bar = tabs.join('│');
    const visibleLen = bar.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - visibleLen);
    return ` ${bar}${' '.repeat(padding)}`;
  }

  // -------------------------------------------------------------------------
  // Input routing
  // -------------------------------------------------------------------------

  /**
   * Route an input event to the focused panel.
   * @returns true if the event was consumed by a panel.
   */
  routeInputToPanel(event: NativeInputEvent): boolean {
    const focusedId = this.panelManager.getFocusedPanelId();
    if (!focusedId) return false;

    const panel = this.panelManager.getPanel(focusedId);
    if (!panel?.definition.onInput) return false;

    return panel.definition.onInput(event) ?? false;
  }

  /**
   * Handle keyboard shortcuts for panel management.
   * @returns true if the shortcut was handled.
   */
  handlePanelShortcut(event: NativeInputEvent): boolean {
    if (event.type !== 'key' || !event.ctrl) return false;

    // Ctrl+B: toggle left dock
    if (event.key === 'character' && event.text === 'b') {
      this.panelManager.toggleDock('left');
      this.requestRender();
      return true;
    }

    // Ctrl+N: toggle right dock (using 'n' for "navigation panel")
    if (event.key === 'character' && event.text === 'n') {
      this.panelManager.toggleDock('right');
      this.requestRender();
      return true;
    }

    // Ctrl+1..9: focus panel by index
    if (event.key === 'character' && event.text && /^[1-9]$/.test(event.text)) {
      const index = parseInt(event.text, 10);
      this.panelManager.focusPanelByIndex(index);
      this.requestRender();
      return true;
    }

    // Ctrl+T: toggle dock mode (split/tabbed) for the focused panel's dock
    if (event.key === 'character' && event.text === 't') {
      const focusedId = this.panelManager.getFocusedPanelId();
      if (focusedId) {
        // Determine which dock the focused panel is in
        const leftPanels = this.panelManager.getPanelsInDock('left');
        const isInLeft = leftPanels.some((p) => p.instanceId === focusedId);
        this.panelManager.toggleDockMode(isInLeft ? 'left' : 'right');
      } else {
        // Default: toggle right dock mode
        this.panelManager.toggleDockMode('right');
      }
      this.requestRender();
      return true;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Panel registration helpers
  // -------------------------------------------------------------------------

  addPanel(definition: PanelDefinition, dock: 'left' | 'right'): string {
    const instanceId = this.panelManager.registerPanel(definition);
    this.panelManager.assignToDock(instanceId, dock);
    this.requestRender();
    return instanceId;
  }

  removePanel(instanceId: string): void {
    this.panelManager.unregisterPanel(instanceId);
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose(): void {
    this.dragController.detach();
    this.panelManager.dispose();
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceDockRender {
  left?: string[];
  right?: string[];
}
