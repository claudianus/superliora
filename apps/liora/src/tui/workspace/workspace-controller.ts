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
  mixHexColor,
} from '@harness-kit/tui-renderer';

import { DragController } from './drag-controller';
import type { DragOverlayInfo } from './drag-controller';
import { PanelManager } from './panel-manager';
import { LayoutPresetManager } from './layout-presets';
import type { PanelDefinition } from './panel-definition';
import { currentTheme } from '#/tui/theme';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import {
  renderPulseText,
  getActiveAppearancePreferences,
  shouldRenderAmbientEffects,
  resolveUltraworkBorderGlowHex,
  appearanceAnimationNow,
  renderParticleDivider,
} from '#/tui/utils/appearance-effects';
import chalk from 'chalk';

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
  readonly dragController: DragController;
  private readonly requestRender: () => void;
  private currentLayout: WorkspaceLayoutResult | null = null;
  private enabled = true;

  // Panel quick switcher state
  private switcherOpen = false;
  private switcherFilter = '';
  private switcherSelectedIndex = 0;

  // Keyboard help overlay
  private helpOpen = false;

  // Layout preset overlay
  private presetManager: LayoutPresetManager | null = null;
  private presetOverlayOpen = false;
  private presetSelectedIndex = 0;
  private presetSaveMode = false;
  private presetSaveName = '';

  // Command palette
  private paletteOpen = false;
  private paletteFilter = '';
  private paletteSelectedIndex = 0;

  // Panel maximize (fullscreen) mode
  private maximizedPanelId: string | null = null;

  // Session stats overlay
  private statsOpen = false;

  // Panel content search
  private searchOpen = false;
  private searchQuery = '';
  private searchMatches: { line: number; col: number }[] = [];
  private searchCurrentMatch = 0;

  // Tab close button hit zones (populated during renderTabBar)
  private tabCloseZones: Array<{ dock: 'left' | 'right'; instanceId: string; x: number; width: number }> = [];

  // Panel focus flash animation
  private lastFocusedPanelId: string | null = null;
  private focusFlashStart = 0;
  private static readonly FOCUS_FLASH_DURATION = 400; // ms

  // Panel activity tracking (for tab bar activity dots)
  private panelActivity: Map<string, number> = new Map();

  // Resize animation tracking
  private lastDockWidth: { left: number; right: number } = { left: 0, right: 0 };
  private resizeAnimStart = 0;
  private static readonly RESIZE_ANIM_DURATION = 300; // ms

  // Panel focus history (for Alt+Tab cycling)
  private focusHistory: string[] = [];
  private static readonly MAX_FOCUS_HISTORY = 8;

  // Panel slide transition direction tracking
  private lastPanelIndex = 0;
  private slideDirection: 'left' | 'right' | null = null;
  private slideAnimStart = 0;
  private static readonly SLIDE_ANIM_DURATION = 200; // ms

  constructor(options: WorkspaceControllerOptions) {
    this.panelManager = options.panelManager;
    this.requestRender = options.requestRender;

    this.dragController = new DragController(this.panelManager, {
      onLayoutChange: () => this.requestRender(),
      getLayout: () => this.currentLayout,
      onDoubleClickPanel: (panelInstanceId) => {
        // Toggle maximize on double-click
        if (this.maximizedPanelId === panelInstanceId) {
          this.maximizedPanelId = null;
        } else {
          this.maximizedPanelId = panelInstanceId;
        }
        this.requestRender();
      },
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

    // Maximize mode: render only the maximized panel
    if (this.maximizedPanelId !== null) {
      const panel = this.panelManager.getPanel(this.maximizedPanelId);
      if (panel) {
        const fullWidth = (layout.leftDock?.rect.width ?? 0) + (layout.rightDock?.rect.width ?? 0) + 40;
        const fullHeight = layout.leftDock?.rect.height ?? layout.rightDock?.rect.height ?? 30;
        const searchQuery = this.searchOpen && this.searchQuery.length > 0 ? this.searchQuery : undefined;
        const content = panel.definition.render(
          Math.max(1, fullWidth - 2),
          Math.max(1, fullHeight - 2),
          true,
          searchQuery,
        );
        const framed = renderPanelFrame({
          width: fullWidth,
          height: fullHeight,
          title: `${panel.definition.title} (전체화면)`,
          icon: panel.definition.icon,
          focused: true,
          borderStyle: 'rounded',
          borderColor: (text) => {
          // Flash glow effect on recent focus change
          const flashAge = Date.now() - this.focusFlashStart;
          if (flashAge < WorkspaceController.FOCUS_FLASH_DURATION && activePanel.instanceId === this.lastFocusedPanelId) {
            const intensity = 1 - flashAge / WorkspaceController.FOCUS_FLASH_DURATION;
            const glowColor = mixHexColor(
              currentTheme.color('accent'),
              currentTheme.color('primary'),
              intensity,
            );
            return chalk.hex(glowColor)(text);
          }
          return currentTheme.fg('primary', text);
        },
          titleColor: (text) => currentTheme.boldFg('textStrong', text),
          iconColor: (text) => currentTheme.fg('accent', text),
          content,
        });
        // Return as left dock spanning full width
        result.left = framed;
        return result;
      }
      // Panel not found, clear maximize
      this.maximizedPanelId = null;
    }

    if (layout.leftDock) {
      result.left = this.renderDock('left', layout.leftDock.rect);
    }

    if (layout.rightDock) {
      result.right = this.renderDock('right', layout.rightDock.rect);
    }

    return result;
  }

  /** Get the currently maximized panel ID (null if none). */
  getMaximizedPanelId(): string | null {
    return this.maximizedPanelId;
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

      // Get panel content (pass search query if focused and search is open)
      const searchQuery = isFocused && this.searchOpen && this.searchQuery.length > 0 ? this.searchQuery : undefined;
      const content = panel.definition.render(
        Math.max(1, contentWidth),
        Math.max(1, contentHeight),
        isFocused,
        searchQuery,
      );

      // Wrap in frame
      const framed = renderPanelFrame({
        width: dockRect.width,
        height: panelHeight,
        title: panel.definition.title,
        icon: panel.definition.icon,
        focused: isFocused,
        borderStyle: isFocused ? 'rounded' : 'single',
        borderColor: isFocused
          ? (text) => {
              const appearance = getActiveAppearancePreferences();
              if (shouldRenderAmbientEffects(appearance)) {
                // Smooth focus transition: fade from primary → ultrawork glow over 600ms
                const focusAge = appearanceAnimationNow() - this.panelManager.getLastFocusChangeAtMs();
                const transitionMs = 600;
                if (focusAge < transitionMs) {
                  const t = focusAge / transitionMs;
                  const s = t * t * (3 - 2 * t); // smoothstep
                  const from = currentTheme.color('primary');
                  const to = resolveUltraworkBorderGlowHex(appearanceAnimationNow());
                  return chalk.hex(mixHexColor(from, to, s))(text);
                }
                return chalk.hex(resolveUltraworkBorderGlowHex(appearanceAnimationNow()))(text);
              }
              return currentTheme.fg('primary', text);
            }
          : (text) => currentTheme.dimFg('border', text),
        titleColor: isFocused
          ? (text) => currentTheme.boldFg('textStrong', text)
          : (text) => currentTheme.fg('textDim', text),
        iconColor: isFocused
          ? (text) => currentTheme.fg('accent', text)
          : (text) => currentTheme.dimFg('textMuted', text),
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
    panels: Array<{ instanceId: string; definition: { id: string; title: string; icon: string; render: (w: number, h: number, f: boolean, s?: string) => string[] } }>,
    focusedId: string | null,
  ): string[] {
    const allLines: string[] = [];

    // Detect dock width change for resize animation
    const prevWidth = dockId === 'left' ? this.lastDockWidth.left : this.lastDockWidth.right;
    if (prevWidth > 0 && Math.abs(dockRect.width - prevWidth) > 1) {
      this.resizeAnimStart = Date.now();
    }
    if (dockId === 'left') this.lastDockWidth.left = dockRect.width;
    else this.lastDockWidth.right = dockRect.width;

    // Tab bar (1 row)
    const tabBar = this.renderTabBar(dockId, dockRect.width, panels, focusedId);
    allLines.push(tabBar);

    // Active panel content (remaining height)
    const activePanel = panels.find((p) => p.instanceId === focusedId) ?? panels[0];

    // Detect focus change for flash animation + history tracking + slide direction
    if (focusedId !== null && focusedId !== this.lastFocusedPanelId) {
      // Determine slide direction based on panel index
      const newIndex = panels.findIndex((p) => p.instanceId === focusedId);
      if (newIndex >= 0) {
        this.slideDirection = newIndex > this.lastPanelIndex ? 'right' : 'left';
        this.slideAnimStart = Date.now();
        this.lastPanelIndex = newIndex;
      }
      this.lastFocusedPanelId = focusedId;
      this.focusFlashStart = Date.now();
      // Track focus history for Alt+Tab cycling
      this.focusHistory = this.focusHistory.filter((id) => id !== focusedId);
      this.focusHistory.unshift(focusedId);
      if (this.focusHistory.length > WorkspaceController.MAX_FOCUS_HISTORY) {
        this.focusHistory = this.focusHistory.slice(0, WorkspaceController.MAX_FOCUS_HISTORY);
      }
    }
    if (activePanel) {
      const contentWidth = dockRect.width - 2;
      const contentHeight = dockRect.height - 3; // tab bar + frame top/bottom

      // Pass search query if search is open
      const searchQuery = this.searchOpen && this.searchQuery.length > 0 ? this.searchQuery : undefined;
      const content = activePanel.definition.render(
        Math.max(1, contentWidth),
        Math.max(1, contentHeight),
        true,
        searchQuery,
      );
      // Track panel activity for tab bar indicators
      this.panelActivity.set(activePanel.instanceId, Date.now());

      // Panel content fade-in: briefly dim content on recent focus change
      const fadeAge = Date.now() - this.focusFlashStart;
      const FADE_DURATION = 250; // ms
      const isFading = fadeAge < FADE_DURATION && activePanel.instanceId === this.lastFocusedPanelId;

      const framed = renderPanelFrame({
        width: dockRect.width,
        height: dockRect.height - 1,
        title: activePanel.definition.title,
        icon: activePanel.definition.icon,
        focused: true,
        borderStyle: 'rounded',
        borderColor: (text) => currentTheme.fg('primary', text),
        titleColor: (text) => currentTheme.boldFg('textStrong', text),
        iconColor: (text) => currentTheme.fg('accent', text),
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
    const appearance = getActiveAppearancePreferences();
    const animate = shouldRenderAmbientEffects(appearance);
    const tabs: string[] = [];
    // Panel count badge (compact, shows total panels in this dock)
    const panelCountBadge = panels.length > 1
      ? currentTheme.dimFg('textMuted', ` ${String(panels.length)}`)
      : '';
    // Reset close button hit zones for this dock
    this.tabCloseZones = this.tabCloseZones.filter((z) => z.dock !== dockId);
    let cursorX = 1; // leading space
    for (const panel of panels) {
      const isActive = panel.instanceId === focusedId;
      const label = `${panel.definition.icon}${panel.definition.title.slice(0, 5)}`;
      const closeBtn = '×';
      if (isActive) {
        const tabText = ` ${label} ${closeBtn}`;
        tabs.push(animate
          ? renderPulseText(tabText, `tab:${panel.instanceId}`, 'primary', appearance)
          : currentTheme.bg('selectionBg', currentTheme.fg('selectionText', tabText)));
      } else {
        // Activity dot: show when panel had recent updates (within 5s)
        const lastActivity = this.panelActivity.get(panel.instanceId) ?? 0;
        const hasRecentActivity = Date.now() - lastActivity < 5000 && panel.instanceId !== focusedId;
        const activityDot = hasRecentActivity ? currentTheme.fg('success', '•') : '';
        tabs.push(currentTheme.dimFg('textMuted', ` ${label} `) + activityDot + currentTheme.dimFg('border', closeBtn));
      }
      // Track close button position (after label + space)
      const tabVisibleLen = label.length + 3; // space + label + space + ×
      const closeX = cursorX + tabVisibleLen - 1;
      this.tabCloseZones.push({ dock: dockId, instanceId: panel.instanceId, x: closeX, width: 1 });
      cursorX += tabVisibleLen + 1; // +1 for separator
    }
    const bar = tabs.join(currentTheme.dimFg('border', '│'));
    const visibleLen = bar.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - visibleLen);
    return ` ${bar}${' '.repeat(padding)}`;
  }

  /**
   * Handle mouse click on tab close buttons.
   * @returns true if a tab was closed.
   */
  handleTabCloseClick(x: number, y: number, layout: WorkspaceLayoutResult): boolean {
    // Check if click is on the tab bar row (first row of a dock in tabbed mode)
    for (const zone of this.tabCloseZones) {
      const dockRect = zone.dock === 'left' ? layout.leftDock?.rect : layout.rightDock?.rect;
      if (!dockRect) continue;
      // Tab bar is the first row of the dock
      if (y !== dockRect.y) continue;
      const absX = dockRect.x + zone.x;
      if (x >= absX && x < absX + zone.width) {
        // Close this panel (remove from dock)
        this.panelManager.removeFromDock(zone.instanceId);
        // If it was focused, focus the next available panel
        if (this.panelManager.getFocusedPanelId() === zone.instanceId) {
          const remaining = this.panelManager.getPanelsInDock(zone.dock);
          if (remaining.length > 0) {
            this.panelManager.focusPanel(remaining[0]!.instanceId);
          } else {
            this.panelManager.blurAll();
          }
        }
        this.requestRender();
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Input routing
  // -------------------------------------------------------------------------

  /**
   * Route an input event to the focused panel.
   * @returns true if the event was consumed by a panel.
   */
  routeInputToPanel(event: NativeInputEvent): boolean {
    // Check tab close button clicks first
    if (event.type === 'mouse' && event.action === 'press' && event.button === 'left') {
      const layout = this.currentLayout;
      if (layout && this.handleTabCloseClick(event.x, event.y, layout)) {
        return true;
      }
    }

    // Mouse wheel events: route to the panel under the cursor if possible,
    // otherwise to the focused panel.
    if (event.type === 'mouse' && event.action === 'wheel') {
      const layout = this.currentLayout;
      if (layout) {
        // Determine which dock the wheel event is over
        const leftRect = layout.leftDock?.rect;
        const rightRect = layout.rightDock?.rect;
        const overLeft = leftRect && event.x >= leftRect.x && event.x < leftRect.x + leftRect.width && event.y >= leftRect.y && event.y < leftRect.y + leftRect.height;
        const overRight = rightRect && event.x >= rightRect.x && event.x < rightRect.x + rightRect.width && event.y >= rightRect.y && event.y < rightRect.y + rightRect.height;
        if (overLeft || overRight) {
          const focusedId = this.panelManager.getFocusedPanelId();
          if (focusedId) {
            const panel = this.panelManager.getPanel(focusedId);
            if (panel?.definition.onInput) {
              return panel.definition.onInput(event) ?? false;
            }
          }
        }
      }
      return false;
    }

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
    if (event.type !== 'key') return false;

    // F-key shortcuts (Bloomberg Terminal style)
    if (event.key === 'f1') {
      this.helpOpen = !this.helpOpen;
      this.requestRender();
      return true;
    }
    if (event.key === 'f2') {
      this.switcherOpen = !this.switcherOpen;
      this.switcherFilter = '';
      this.switcherSelectedIndex = 0;
      this.requestRender();
      return true;
    }
    if (event.key === 'f3') {
      this.paletteOpen = !this.paletteOpen;
      this.paletteFilter = '';
      this.paletteSelectedIndex = 0;
      this.requestRender();
      return true;
    }
    if (event.key === 'f5') {
      // Refresh all panels that support it
      for (const panel of this.panelManager.getAllPanels()) {
        if (panel.definition.onInput) {
          panel.definition.onInput({ type: 'key', key: 'character', text: 'r' } as NativeInputEvent);
        }
      }
      this.requestRender();
      return true;
    }
    if (event.key === 'f11') {
      if (this.maximizedPanelId !== null) {
        this.maximizedPanelId = null;
      } else {
        this.maximizedPanelId = this.panelManager.getFocusedPanelId();
      }
      this.requestRender();
      return true;
    }

    if (!event.ctrl) return false;

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

    // Ctrl+/: open panel quick switcher
    if (event.key === 'character' && event.text === '/') {
      this.switcherOpen = !this.switcherOpen;
      this.switcherFilter = '';
      this.switcherSelectedIndex = 0;
      this.requestRender();
      return true;
    }

    // Ctrl+G: toggle keyboard help overlay
    if (event.key === 'character' && event.text === 'g') {
      this.helpOpen = !this.helpOpen;
      this.requestRender();
      return true;
    }

    // Ctrl+P: toggle layout preset overlay
    if (event.key === 'character' && event.text === 'p') {
      if (this.presetManager === null) return false;
      this.presetOverlayOpen = !this.presetOverlayOpen;
      this.presetSelectedIndex = 0;
      this.presetSaveMode = false;
      this.presetSaveName = '';
      this.requestRender();
      return true;
    }

    // Ctrl+K: toggle command palette
    if (event.key === 'character' && event.text === 'k') {
      this.paletteOpen = !this.paletteOpen;
      this.paletteFilter = '';
      this.paletteSelectedIndex = 0;
      this.requestRender();
      return true;
    }

    // Ctrl+M: toggle maximize focused panel
    if (event.key === 'character' && event.text === 'm') {
      if (this.maximizedPanelId !== null) {
        this.maximizedPanelId = null;
      } else {
        this.maximizedPanelId = this.panelManager.getFocusedPanelId();
      }
      this.requestRender();
      return true;
    }

    // Ctrl+F: open panel content search
    if (event.key === 'character' && event.text === 'f') {
      this.searchOpen = !this.searchOpen;
      this.searchQuery = '';
      this.searchMatches = [];
      this.searchCurrentMatch = 0;
      this.requestRender();
      return true;
    }

    // Ctrl+Shift+Left/Right: resize focused panel's dock
    if (event.ctrl && event.shift && (event.key === 'left' || event.key === 'right')) {
      const focusedId = this.panelManager.getFocusedPanelId();
      if (focusedId) {
        const leftPanels = this.panelManager.getPanelsInDock('left');
        const isInLeft = leftPanels.some((p) => p.instanceId === focusedId);
        const dock = isInLeft ? 'left' : 'right';
        const currentWidth = this.panelManager.getDockWidth(dock);
        const delta = event.key === 'left' ? -2 : 2;
        this.panelManager.setDockWidth(dock, currentWidth + delta);
        this.requestRender();
      }
      return true;
    }

    return false;
  }

  /**
   * Handle Tab/Shift+Tab for panel cycling.
   * Only active when a panel is already focused.
   */
  handleTabCycle(event: NativeInputEvent): boolean {
    if (event.type !== 'key' || event.key !== 'tab') return false;
    // Only cycle when a panel is focused
    const currentFocus = this.panelManager.getFocusedPanelId();
    if (currentFocus === null) return false;

    const allPanels = [
      ...this.panelManager.getPanelsInDock('left'),
      ...this.panelManager.getPanelsInDock('right'),
    ];
    if (allPanels.length === 0) return false;

    const currentIdx = allPanels.findIndex((p) => p.instanceId === currentFocus);
    const direction = event.shift ? -1 : 1;
    const nextIdx = ((currentIdx + direction) % allPanels.length + allPanels.length) % allPanels.length;
    const nextPanel = allPanels[nextIdx];
    if (nextPanel) {
      this.panelManager.focusPanel(nextPanel.instanceId);
      this.requestRender();
    }
    return true;
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
  // Panel Quick Switcher
  // -------------------------------------------------------------------------

  /** Whether the panel switcher overlay is open. */
  get isSwitcherOpen(): boolean {
    return this.switcherOpen;
  }

  /** Get filtered panel list for the switcher. */
  private getFilteredPanels(): Array<{ instanceId: string; title: string; dock: 'left' | 'right' }> {
    const allPanels: Array<{ instanceId: string; title: string; dock: 'left' | 'right' }> = [];
    for (const p of this.panelManager.getPanelsInDock('left')) {
      allPanels.push({ instanceId: p.instanceId, title: p.definition.title, dock: 'left' });
    }
    for (const p of this.panelManager.getPanelsInDock('right')) {
      allPanels.push({ instanceId: p.instanceId, title: p.definition.title, dock: 'right' });
    }
    if (!this.switcherFilter) return allPanels;
    const filter = this.switcherFilter.toLowerCase();
    return allPanels.filter((p) => p.title.toLowerCase().includes(filter));
  }

  /**
   * Handle input when the panel switcher is open.
   * @returns true if the input was consumed.
   */
  handleSwitcherInput(event: NativeInputEvent): boolean {
    if (!this.switcherOpen) return false;

    if (event.type === 'key') {
      // Escape or Ctrl+/: close switcher
      if (event.key === 'escape' || (event.ctrl && event.key === 'character' && event.text === '/')) {
        this.switcherOpen = false;
        this.requestRender();
        return true;
      }
      // Enter: select current panel
      if (event.key === 'enter') {
        const panels = this.getFilteredPanels();
        const selected = panels[this.switcherSelectedIndex];
        if (selected) {
          this.panelManager.focusPanel(selected.instanceId);
        }
        this.switcherOpen = false;
        this.requestRender();
        return true;
      }
      // Arrow up/down: navigate
      if (event.key === 'up') {
        const panels = this.getFilteredPanels();
        this.switcherSelectedIndex = Math.max(0, this.switcherSelectedIndex - 1);
        if (this.switcherSelectedIndex >= panels.length) this.switcherSelectedIndex = panels.length - 1;
        this.requestRender();
        return true;
      }
      if (event.key === 'down') {
        const panels = this.getFilteredPanels();
        this.switcherSelectedIndex = Math.min(panels.length - 1, this.switcherSelectedIndex + 1);
        this.requestRender();
        return true;
      }
      // Backspace: remove last filter char
      if (event.key === 'backspace') {
        this.switcherFilter = this.switcherFilter.slice(0, -1);
        this.switcherSelectedIndex = 0;
        this.requestRender();
        return true;
      }
      // Character: add to filter
      if (event.key === 'character' && event.text && !event.ctrl && !event.meta) {
        this.switcherFilter += event.text;
        this.switcherSelectedIndex = 0;
        this.requestRender();
        return true;
      }
    }
    return false;
  }

  /**
   * Render the panel switcher overlay.
   * Returns lines to render in the center of the screen.
   */
  renderSwitcherOverlay(): string[] | null {
    if (!this.switcherOpen) return null;
    const panels = this.getFilteredPanels();
    const lines: string[] = [];
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const divider = animated
      ? renderParticleDivider(30, 'switcher:divider', appearance)
      : currentTheme.fg('primary', '─'.repeat(30));
    lines.push(`${currentTheme.boldFg('primary', ' 패널 전환')}  ${currentTheme.dimFg('textMuted', this.switcherFilter || '입력하여 필터…')}`);
    lines.push(divider);
    if (panels.length === 0) {
      lines.push(`  ${currentTheme.dimFg('textMuted', '(결과 없음)')}`);
    } else {
      for (let i = 0; i < panels.length; i++) {
        const p = panels[i]!;
        const marker = i === this.switcherSelectedIndex ? currentTheme.boldFg('primary', SELECT_POINTER) : ' ';
        const dock = p.dock === 'left' ? currentTheme.dimFg('textMuted', '[L]') : currentTheme.dimFg('textMuted', '[R]');
        const title = i === this.switcherSelectedIndex ? currentTheme.boldFg('textStrong', p.title) : currentTheme.fg('text', p.title);
        lines.push(` ${marker} ${dock} ${title}`);
      }
    }
    lines.push(divider);
    lines.push(` ${currentTheme.dimFg('textMuted', '↑↓ 이동 · Enter 선택 · Esc 닫기')}`);
    return lines;
  }

  // -------------------------------------------------------------------------
  // Keyboard Help Overlay
  // -------------------------------------------------------------------------

  /** Whether the help overlay is open. */
  get isHelpOpen(): boolean {
    return this.helpOpen;
  }

  /** Handle input when help overlay is open (any key closes it). */
  handleHelpInput(event: NativeInputEvent): boolean {
    if (!this.helpOpen) return false;
    if (event.type === 'key') {
      this.helpOpen = false;
      this.requestRender();
      return true;
    }
    return false;
  }

  /** Render the keyboard shortcuts help overlay. */
  renderHelpOverlay(): string[] | null {
    if (!this.helpOpen) return null;
    const w = 44;
    const lines: string[] = [];
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const divider = animated
      ? renderParticleDivider(w, 'help:divider', appearance)
      : currentTheme.fg('primary', '─'.repeat(w));
    lines.push(currentTheme.boldFg('primary', ' 키보드 단축키'));
    lines.push(divider);
    // Grouped sections for better scannability
    const sections: Array<{ title: string; items: Array<[string, string]> }> = [
      {
        title: '패널',
        items: [
          ['F2 / Ctrl+/', '퀵 스위처'],
          ['F3 / Ctrl+K', '명령 팔레트'],
          ['F11 / Ctrl+M', '전체화면'],
          ['Ctrl+1~9', '패널 포커스'],
          ['Tab/S+Tab', '순환 이동'],
          ['Ctrl+F', '콘텐츠 검색'],
        ],
      },
      {
        title: '독 / 레이아웃',
        items: [
          ['Ctrl+B', '왼쪽 독 토글'],
          ['Ctrl+N', '오른쪽 독 토글'],
          ['Ctrl+T', 'split/tabbed 전환'],
          ['Ctrl+P', '레이아웃 프리셋'],
          ['Ctrl+S+←/→', '독 너비 조절'],
        ],
      },
      {
        title: '마우스',
        items: [
          ['타이틀 드래그', '패널 이동'],
          ['더블클릭', '전체화면 토글'],
          ['테두리 드래그', '리사이즈'],
          ['휠', '패널 스크롤'],
          ['탭 ×', '패널 닫기'],
        ],
      },
    ];
    for (const section of sections) {
      lines.push(` ${currentTheme.boldFg('accent', section.title)}`);
      for (const [key, desc] of section.items) {
        const keyCol = currentTheme.fg('primary', key);
        const pad = Math.max(1, 16 - key.length);
        lines.push(`   ${keyCol}${' '.repeat(pad)}${currentTheme.fg('text', desc)}`);
      }
    }
    // Contextual panel shortcuts (based on currently focused panel)
    const focusedPanel = this.panelManager.getFocusedPanel();
    if (focusedPanel) {
      const panelShortcuts: Record<string, Array<[string, string]>> = {
        'file-explorer': [['s', '정렬 전환'], ['c', '모두 접기'], ['e', '모두 펼치기'], ['h', '숨김파일'], ['r', '새로고침']],
        'git-diff': [['v', '모드 전환'], ['n/p', '헝크 이동'], ['b', 'blame'], ['c', '컨텍스트'], ['r', '새로고침']],
        'activity': [['f', '필터'], ['a', '자동스크롤'], ['e', '그룹 펼치기'], ['c', '지우기']],
        'terminal': [['Ctrl+L', '버퍼 지우기'], ['Ctrl+E', '환경변수'], ['r', '재시작 (종료시)']],
        'session-manager': [['s', '정렬'], ['p', '고정'], ['n', '새 세션'], ['r', '새로고침']],
        'artifact-viewer': [['t', 'TOC'], ['h/l', '헤딩 이동'], ['n', '줄번호']],
        'side-chat': [['Ctrl+W', '단어 삭제'], ['Ctrl+U', '줄 지우기'], ['↑/↓', '히스토리']],
      };
      const shortcuts = panelShortcuts[focusedPanel.definition.id];
      if (shortcuts && shortcuts.length > 0) {
        lines.push(` ${currentTheme.boldFg('accent', `${focusedPanel.definition.icon} ${focusedPanel.definition.title}`)}`);
        for (const [key, desc] of shortcuts) {
          const keyCol = currentTheme.fg('primary', key);
          const pad = Math.max(1, 16 - key.length);
          lines.push(`   ${keyCol}${' '.repeat(pad)}${currentTheme.fg('text', desc)}`);
        }
      }
    }
    lines.push(divider);
    lines.push(` ${currentTheme.dimFg('textMuted', 'F1/Ctrl+G: 도움말 · 아무 키: 닫기')}`);
    return lines;
  }

  // -------------------------------------------------------------------------
  // Command Palette
  // -------------------------------------------------------------------------

  private static readonly COMMANDS: Array<{ id: string; label: string; shortcut?: string }> = [
    { id: 'toggle-left', label: '왼쪽 독 표시/숨김', shortcut: 'Ctrl+B' },
    { id: 'toggle-right', label: '오른쪽 독 표시/숨김', shortcut: 'Ctrl+N' },
    { id: 'toggle-dock-mode', label: '독 모드 전환 (split/tabbed)', shortcut: 'Ctrl+T' },
    { id: 'maximize', label: '패널 전체화면 전환', shortcut: 'Ctrl+M' },
    { id: 'panel-switcher', label: '패널 퀵 스위처', shortcut: 'Ctrl+/' },
    { id: 'search', label: '패널 콘텐츠 검색', shortcut: 'Ctrl+F' },
    { id: 'presets', label: '레이아웃 프리셋', shortcut: 'Ctrl+P' },
    { id: 'help', label: '키보드 도움말', shortcut: 'Ctrl+G' },
    { id: 'refresh-files', label: '파일 탐색기 새로고침' },
    { id: 'refresh-git', label: 'Git Diff 새로고침' },
    { id: 'clear-activity', label: '활동 피드 지우기' },
    { id: 'session-stats', label: '세션 통계 표시' },
  ];

  /** Whether the command palette is open. */
  get isPaletteOpen(): boolean {
    return this.paletteOpen;
  }

  private getFilteredCommands(): Array<{ id: string; label: string; shortcut?: string }> {
    if (!this.paletteFilter) return WorkspaceController.COMMANDS;
    const filter = this.paletteFilter.toLowerCase();
    return WorkspaceController.COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(filter) || (c.shortcut ?? '').toLowerCase().includes(filter),
    );
  }

  /** Handle input when command palette is open. */
  handlePaletteInput(event: NativeInputEvent): boolean {
    if (!this.paletteOpen) return false;
    if (event.type !== 'key') return false;

    if (event.key === 'escape' || (event.ctrl && event.key === 'character' && event.text === 'k')) {
      this.paletteOpen = false;
      this.requestRender();
      return true;
    }
    if (event.key === 'up') {
      this.paletteSelectedIndex = Math.max(0, this.paletteSelectedIndex - 1);
      this.requestRender();
      return true;
    }
    if (event.key === 'down') {
      const cmds = this.getFilteredCommands();
      this.paletteSelectedIndex = Math.min(cmds.length - 1, this.paletteSelectedIndex + 1);
      this.requestRender();
      return true;
    }
    if (event.key === 'enter') {
      const cmds = this.getFilteredCommands();
      const cmd = cmds[this.paletteSelectedIndex];
      if (cmd) this.executeCommand(cmd.id);
      this.paletteOpen = false;
      this.requestRender();
      return true;
    }
    if (event.key === 'backspace') {
      this.paletteFilter = this.paletteFilter.slice(0, -1);
      this.paletteSelectedIndex = 0;
      this.requestRender();
      return true;
    }
    if (event.key === 'character' && event.text && !event.ctrl && !event.meta) {
      this.paletteFilter += event.text;
      this.paletteSelectedIndex = 0;
      this.requestRender();
      return true;
    }
    return true;
  }

  private executeCommand(id: string): void {
    switch (id) {
      case 'toggle-left':
        this.panelManager.toggleDock('left');
        break;
      case 'toggle-right':
        this.panelManager.toggleDock('right');
        break;
      case 'toggle-dock-mode': {
        const focusedId = this.panelManager.getFocusedPanelId();
        if (focusedId) {
          const leftPanels = this.panelManager.getPanelsInDock('left');
          const isInLeft = leftPanels.some((p) => p.instanceId === focusedId);
          this.panelManager.toggleDockMode(isInLeft ? 'left' : 'right');
        } else {
          this.panelManager.toggleDockMode('right');
        }
        break;
      }
      case 'panel-switcher':
        this.switcherOpen = true;
        this.switcherFilter = '';
        this.switcherSelectedIndex = 0;
        break;
      case 'search':
        this.searchOpen = true;
        this.searchQuery = '';
        this.searchMatches = [];
        this.searchCurrentMatch = 0;
        break;
      case 'presets':
        if (this.presetManager !== null) {
          this.presetOverlayOpen = true;
          this.presetSelectedIndex = 0;
          this.presetSaveMode = false;
          this.presetSaveName = '';
        }
        break;
      case 'maximize':
        if (this.maximizedPanelId !== null) {
          this.maximizedPanelId = null;
        } else {
          this.maximizedPanelId = this.panelManager.getFocusedPanelId();
        }
        break;
      case 'help':
        this.helpOpen = true;
        break;
      case 'refresh-files': {
        const filesPanel = this.panelManager.getAllPanels().find((p) => p.definition.id === 'file-explorer');
        if (filesPanel?.definition.onInput) {
          // Trigger refresh via 'r' key simulation
          filesPanel.definition.onInput({ type: 'key', key: 'character', text: 'r' } as NativeInputEvent);
        }
        break;
      }
      case 'refresh-git': {
        const gitPanel = this.panelManager.getAllPanels().find((p) => p.definition.id === 'git-diff');
        if (gitPanel?.definition.onInput) {
          gitPanel.definition.onInput({ type: 'key', key: 'character', text: 'r' } as NativeInputEvent);
        }
        break;
      }
      case 'clear-activity': {
        const actPanel = this.panelManager.getAllPanels().find((p) => p.definition.id === 'activity-feed');
        if (actPanel?.definition.onInput) {
          actPanel.definition.onInput({ type: 'key', key: 'character', text: 'c' } as NativeInputEvent);
        }
        break;
      }
      case 'session-stats':
        this.statsOpen = true;
        break;
    }
    this.requestRender();
  }

  /** Render the command palette overlay. */
  renderPaletteOverlay(): string[] | null {
    if (!this.paletteOpen) return null;
    const cmds = this.getFilteredCommands();
    const lines: string[] = [];
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const divider = animated
      ? renderParticleDivider(38, 'palette:divider', appearance)
      : currentTheme.fg('primary', '─'.repeat(38));
    lines.push(`${currentTheme.boldFg('primary', ' 명령')}  ${currentTheme.dimFg('textMuted', this.paletteFilter || '입력하여 검색…')}`);
    lines.push(divider);
    if (cmds.length === 0) {
      lines.push(`  ${currentTheme.dimFg('textMuted', '(결과 없음)')}`);
    } else {
      for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i]!;
        const marker = i === this.paletteSelectedIndex ? currentTheme.boldFg('primary', SELECT_POINTER) : ' ';
        const label = i === this.paletteSelectedIndex ? currentTheme.boldFg('textStrong', cmd.label) : currentTheme.fg('text', cmd.label);
        const shortcut = cmd.shortcut ? ` ${currentTheme.dimFg('textMuted', cmd.shortcut)}` : '';
        lines.push(` ${marker} ${label}${shortcut}`);
      }
    }
    lines.push(divider);
    lines.push(` ${currentTheme.dimFg('textMuted', '↑↓ 이동 · Enter 실행 · Esc 닫기')}`);
    return lines;
  }

  // -------------------------------------------------------------------------
  // Session Stats Overlay
  // -------------------------------------------------------------------------

  /** Whether the stats overlay is open. */
  get isStatsOpen(): boolean {
    return this.statsOpen;
  }

  /** Handle input when stats overlay is open (any key closes it). */
  handleStatsInput(event: NativeInputEvent): boolean {
    if (!this.statsOpen) return false;
    if (event.type === 'key') {
      this.statsOpen = false;
      this.requestRender();
      return true;
    }
    return false;
  }

  /** Whether the search overlay is open. */
  get isSearchOpen(): boolean {
    return this.searchOpen;
  }

  /** Handle input when search overlay is open. */
  handleSearchInput(event: NativeInputEvent): boolean {
    if (!this.searchOpen) return false;
    if (event.type !== 'key') return false;

    // Escape or Ctrl+F: close search
    if (event.key === 'escape' || (event.ctrl && event.key === 'character' && event.text === 'f')) {
      this.searchOpen = false;
      this.searchQuery = '';
      this.searchMatches = [];
      this.searchCurrentMatch = 0;
      this.requestRender();
      return true;
    }

    // Enter: go to next match
    if (event.key === 'enter') {
      if (this.searchMatches.length > 0) {
        this.searchCurrentMatch = (this.searchCurrentMatch + 1) % this.searchMatches.length;
        this.requestRender();
      }
      return true;
    }

    // Backspace: remove last character
    if (event.key === 'backspace') {
      this.searchQuery = this.searchQuery.slice(0, -1);
      this.updateSearchMatches();
      this.requestRender();
      return true;
    }

    // Character input: add to query
    if (event.key === 'character' && event.text) {
      this.searchQuery += event.text;
      this.updateSearchMatches();
      this.requestRender();
      return true;
    }

    return false;
  }

  /** Update search matches based on current query and focused panel content. */
  private updateSearchMatches(): void {
    this.searchMatches = [];
    this.searchCurrentMatch = 0;

    if (this.searchQuery.length === 0) return;

    const focusedPanel = this.panelManager.getFocusedPanel();
    if (!focusedPanel) return;

    // Get panel content (render with reasonable dimensions)
    const lines = focusedPanel.definition.render(120, 50, true);
    const query = this.searchQuery.toLowerCase();

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx].toLowerCase();
      let col = line.indexOf(query);
      while (col !== -1) {
        this.searchMatches.push({ line: lineIdx, col });
        col = line.indexOf(query, col + 1);
      }
    }
  }

  /** Render the search overlay. */
  renderSearchOverlay(): string[] | null {
    if (!this.searchOpen) return null;

    const lines: string[] = [];
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const matchInfo = this.searchMatches.length > 0
      ? ` (${this.searchCurrentMatch + 1}/${this.searchMatches.length})`
      : this.searchQuery.length > 0 ? ' (0/0)' : '';

    const matchStyled = this.searchMatches.length > 0 && animated
      ? renderPulseText(matchInfo, 'search:matches', 'success', appearance)
      : currentTheme.dimFg('textMuted', matchInfo);
    lines.push(`${currentTheme.boldFg('primary', ' 검색: ')}${currentTheme.fg('text', this.searchQuery)}${matchStyled}`);
    lines.push(currentTheme.dimFg('textMuted', 'Enter: 다음 · Esc: 닫기'));
    return lines;
  }

  /** Render the session stats overlay. Data is passed from the TUI. */
  renderStatsOverlay(stats: {
    sessionDurationMs: number;
    totalActivities: number;
    toolCalls: number;
    fileReads: number;
    fileWrites: number;
    commands: number;
    thinkingEvents: number;
    contextTokens: number;
    maxContextTokens: number;
  }): string[] | null {
    if (!this.statsOpen) return null;
    const w = 36;
    const lines: string[] = [];
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const divider = animated
      ? renderParticleDivider(w, 'stats:divider', appearance)
      : currentTheme.fg('primary', '─'.repeat(w));
    lines.push(currentTheme.boldFg('primary', ' 세션 통계'));
    lines.push(divider);

    const duration = formatDurationShort(stats.sessionDurationMs);
    lines.push(` ${currentTheme.dimFg('textMuted', '세션 시간')}      ${currentTheme.fg('text', duration)}`);
    lines.push(` ${currentTheme.dimFg('textMuted', '총 활동')}        ${currentTheme.fg('text', String(stats.totalActivities))}`);
    lines.push('');
    lines.push(` ${currentTheme.fg('primary', '⚡ 툴 호출')}     ${currentTheme.fg('text', String(stats.toolCalls))}`);
    lines.push(` ${currentTheme.fg('accent', '📖 파일 읽기')}   ${currentTheme.fg('text', String(stats.fileReads))}`);
    lines.push(` ${currentTheme.fg('particle', '✏ 파일 쓰기')}   ${currentTheme.fg('text', String(stats.fileWrites))}`);
    lines.push(` ${currentTheme.fg('primary', '▶ 명령 실행')}    ${currentTheme.fg('text', String(stats.commands))}`);
    lines.push(` ${currentTheme.fg('warning', '◌ 추론')}         ${currentTheme.fg('text', String(stats.thinkingEvents))}`);
    lines.push('');

    if (stats.maxContextTokens > 0) {
      const pct = Math.round((stats.contextTokens / stats.maxContextTokens) * 100);
      lines.push(` ${currentTheme.dimFg('textMuted', '컨텍스트')}      ${currentTheme.fg('text', `${formatTokens(stats.contextTokens)}/${formatTokens(stats.maxContextTokens)} (${String(pct)}%)`)}`);
    }

    lines.push(divider);
    lines.push(` ${currentTheme.dimFg('textMuted', '아무 키나 눌러 닫기')}`);
    return lines;
  }

  // -------------------------------------------------------------------------
  // Layout Presets
  // -------------------------------------------------------------------------

  /** Set the preset manager (called after construction). */
  setPresetManager(manager: LayoutPresetManager): void {
    this.presetManager = manager;
  }

  /** Whether the preset overlay is open. */
  get isPresetOverlayOpen(): boolean {
    return this.presetOverlayOpen;
  }

  /** Handle input when preset overlay is open. */
  handlePresetInput(event: NativeInputEvent): boolean {
    if (!this.presetOverlayOpen || this.presetManager === null) return false;

    if (event.type !== 'key') return false;

    // Save mode: collect name
    if (this.presetSaveMode) {
      if (event.key === 'escape') {
        this.presetSaveMode = false;
        this.presetSaveName = '';
        this.requestRender();
        return true;
      }
      if (event.key === 'enter' && this.presetSaveName.length > 0) {
        this.presetManager.savePreset(this.presetSaveName.trim());
        this.presetSaveMode = false;
        this.presetSaveName = '';
        this.presetOverlayOpen = false;
        this.requestRender();
        return true;
      }
      if (event.key === 'backspace') {
        this.presetSaveName = this.presetSaveName.slice(0, -1);
        this.requestRender();
        return true;
      }
      if (event.key === 'character' && event.text && !event.ctrl && !event.meta) {
        this.presetSaveName += event.text;
        this.requestRender();
        return true;
      }
      return true; // consume all input in save mode
    }

    // List mode
    if (event.key === 'escape' || (event.ctrl && event.key === 'character' && event.text === 'p')) {
      this.presetOverlayOpen = false;
      this.requestRender();
      return true;
    }
    if (event.key === 'up') {
      this.presetSelectedIndex = Math.max(0, this.presetSelectedIndex - 1);
      this.requestRender();
      return true;
    }
    if (event.key === 'down') {
      const presets = this.presetManager.listPresets();
      this.presetSelectedIndex = Math.min(presets.length, this.presetSelectedIndex + 1);
      this.requestRender();
      return true;
    }
    if (event.key === 'enter') {
      const presets = this.presetManager.listPresets();
      if (this.presetSelectedIndex < presets.length) {
        const name = presets[this.presetSelectedIndex]!;
        this.presetManager.loadPreset(name);
        this.presetOverlayOpen = false;
        this.requestRender();
      }
      return true;
    }
    if (event.key === 'character' && event.text === 's' && !event.ctrl) {
      // Enter save mode
      this.presetSaveMode = true;
      this.presetSaveName = '';
      this.requestRender();
      return true;
    }
    if (event.key === 'character' && event.text === 'd' && !event.ctrl) {
      // Delete selected preset
      const presets = this.presetManager.listPresets();
      if (this.presetSelectedIndex < presets.length) {
        this.presetManager.deletePreset(presets[this.presetSelectedIndex]!);
        this.requestRender();
      }
      return true;
    }
    return true; // consume all input when overlay is open
  }

  /** Render the preset overlay. */
  renderPresetOverlay(): string[] | null {
    if (!this.presetOverlayOpen || this.presetManager === null) return null;
    const lines: string[] = [];
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const divider = animated
      ? renderParticleDivider(30, 'presets:divider', appearance)
      : currentTheme.fg('primary', '─'.repeat(30));

    if (this.presetSaveMode) {
      lines.push(currentTheme.boldFg('primary', ' 프리셋 저장'));
      lines.push(divider);
      lines.push(` ${currentTheme.fg('text', '이름:')} ${currentTheme.fg('textStrong', this.presetSaveName)}${currentTheme.bg('selectionBg', ' ')}`);
      lines.push(divider);
      lines.push(` ${currentTheme.dimFg('textMuted', 'Enter 저장 · Esc 취소')}`);
      return lines;
    }

    const presets = this.presetManager.listPresets();
    lines.push(currentTheme.boldFg('primary', ' 레이아웃 프리셋'));
    lines.push(divider);
    if (presets.length === 0) {
      lines.push(`  ${currentTheme.dimFg('textMuted', '(저장된 프리셋 없음)')}`);
    } else {
      for (let i = 0; i < presets.length; i++) {
        const name = presets[i]!;
        const marker = i === this.presetSelectedIndex ? currentTheme.boldFg('primary', SELECT_POINTER) : ' ';
        const label = i === this.presetSelectedIndex ? currentTheme.boldFg('textStrong', name) : currentTheme.fg('text', name);
        lines.push(` ${marker} ${label}`);
      }
    }
    lines.push(divider);
    lines.push(` ${currentTheme.dimFg('textMuted', '↑↓ 이동 · Enter 적용 · s 저장 · d 삭제 · Esc 닫기')}`);
    return lines;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Drag overlay rendering
  // -------------------------------------------------------------------------

  /**
   * Render the drag ghost overlay and drop-zone highlight.
   * Returns positioned lines to composite onto the frame, or null when idle.
   */
  renderDragOverlay(): { x: number; y: number; lines: string[] } | null {
    const overlay = this.dragController.getDragOverlay();
    if (overlay === null) return null;

    const appearance = getActiveAppearancePreferences();
    const animate = shouldRenderAmbientEffects(appearance);
    const lines: string[] = [];

    // Ghost panel: a compact themed card following the cursor
    const ghostWidth = Math.min(24, overlay.panelTitle.length + 6);
    const title = overlay.panelTitle.slice(0, ghostWidth - 4);
    const topBorder = currentTheme.fg('accent', `╭${'─'.repeat(ghostWidth - 2)}╮`);
    const titleLine = currentTheme.fg('accent', '│') +
      currentTheme.boldFg('textStrong', ` ${title} `.padEnd(ghostWidth - 2)) +
      currentTheme.fg('accent', '│');
    const grabLine = currentTheme.fg('accent', '│') +
      currentTheme.dimFg('textMuted', ' ⠿ drag…'.padEnd(ghostWidth - 2)) +
      currentTheme.fg('accent', '│');
    const botBorder = currentTheme.fg('accent', `╰${'─'.repeat(ghostWidth - 2)}╯`);
    lines.push(topBorder, titleLine, grabLine, botBorder);

    // Drop zone indicator with animated snap arrows
    if (overlay.dropDock !== null) {
      const isLeft = overlay.dropDock === 'left';
      // Animated arrows pointing toward the dock
      const frame = Math.floor(Date.now() / 200) % 3;
      const arrows = isLeft
        ? ['◀──', '◀◀─', '◀◀◀'][frame]!
        : ['──▶', '─▶▶', '▶▶▶'][frame]!;
      const dropLabel = isLeft ? `${arrows} Dock` : `Dock ${arrows}`;
      const dropLine = animate
        ? renderPulseText(` ${dropLabel} `, 'drag:dropzone', 'primary', appearance)
        : currentTheme.bg('selectionBg', currentTheme.fg('selectionText', ` ${dropLabel} `));
      // Snap preview: show a thin dock outline
      const snapWidth = ghostWidth;
      const snapTop = currentTheme.dimFg('border', `┌${'┄'.repeat(snapWidth - 2)}┐`);
      const snapMid = currentTheme.dimFg('border', '┆') + ' '.repeat(snapWidth - 2) + currentTheme.dimFg('border', '┆');
      const snapBot = currentTheme.dimFg('border', `└${'┄'.repeat(snapWidth - 2)}┘`);
      lines.push('');
      lines.push(snapTop);
      lines.push(dropLine.padEnd(snapWidth));
      lines.push(snapMid);
      lines.push(snapBot);
    }

    return { x: overlay.x + 1, y: overlay.y + 1, lines };
  }

  /**
   * Render a resize indicator overlay during dock divider drag.
   * Returns positioned lines or null when not resizing.
   */
  renderResizeIndicator(): { x: number; y: number; lines: string[] } | null {
    const info = this.dragController.getResizeInfo();
    if (info === null) return null;

    const appearance = getActiveAppearancePreferences();
    const animate = shouldRenderAmbientEffects(appearance);
    const lines: string[] = [];

    // Vertical resize indicator with width readout
    const widthLabel = `${String(info.currentWidth)}`;
    const indicator = animate
      ? renderPulseText(`⟺ ${widthLabel}`, 'resize:indicator', 'accent', appearance)
      : currentTheme.fg('accent', `⟺ ${widthLabel}`);
    lines.push(indicator);

    return { x: info.x, y: info.y, lines };
  }

  // -------------------------------------------------------------------------
  // Lifecycle (continued)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDurationShort(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}초`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}분 ${remainSecs}초`;
  const hours = Math.floor(mins / 60);
  return `${hours}시간 ${mins % 60}분`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
