import type {
  NativeInputMouseEvent,
  NativeInputRouter,
  RendererRect,
  WorkspaceLayoutResult,
} from '@harness-kit/tui-renderer';
import { hitTestDockDivider } from '@harness-kit/tui-renderer';

import type { PanelManager } from './panel-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DragState =
  | { readonly type: 'idle' }
  | {
      readonly type: 'resizing-dock';
      readonly dock: 'left' | 'right';
      readonly startX: number;
      readonly startWidth: number;
    }
  | {
      readonly type: 'dragging-panel';
      readonly panelInstanceId: string;
      readonly startX: number;
      readonly startY: number;
    };

export interface DragControllerCallbacks {
  /** Called when the layout needs to be re-rendered. */
  readonly onLayoutChange: () => void;
  /** Get the current workspace layout for hit-testing. */
  readonly getLayout: () => WorkspaceLayoutResult | null;
}

// ---------------------------------------------------------------------------
// DragController
// ---------------------------------------------------------------------------

export class DragController {
  private state: DragState = { type: 'idle' };
  private readonly panelManager: PanelManager;
  private readonly callbacks: DragControllerCallbacks;
  private unregisterHandler: (() => void) | null = null;

  constructor(panelManager: PanelManager, callbacks: DragControllerCallbacks) {
    this.panelManager = panelManager;
    this.callbacks = callbacks;
  }

  /**
   * Register as a global input handler on the input router.
   */
  attach(router: NativeInputRouter): void {
    this.unregisterHandler = router.registerGlobalHandler({
      id: 'workspace-drag-controller',
      enabled: () => true,
      onInput: (event) => this.handleInput(event),
    });
  }

  detach(): void {
    this.unregisterHandler?.();
    this.unregisterHandler = null;
  }

  get isDragging(): boolean {
    return this.state.type !== 'idle';
  }

  // -------------------------------------------------------------------------
  // Input handling
  // -------------------------------------------------------------------------

  private handleInput(event: import('@harness-kit/tui-renderer').NativeInputEvent): boolean {
    if (event.type !== 'mouse') return false;
    return this.handleMouseEvent(event);
  }

  private handleMouseEvent(event: NativeInputMouseEvent): boolean {
    switch (this.state.type) {
      case 'idle':
        return this.handleIdleMouse(event);
      case 'resizing-dock':
        return this.handleResizingMouse(event);
      case 'dragging-panel':
        return this.handleDraggingMouse(event);
      default:
        return false;
    }
  }

  private handleIdleMouse(event: NativeInputMouseEvent): boolean {
    if (event.action !== 'press' || event.button !== 'left') return false;

    const layout = this.callbacks.getLayout();
    if (!layout) return false;

    // Check if pressing on a dock divider (for resize)
    const dividerZone = hitTestDockDivider(
      event.x,
      event.y,
      layout.leftDock?.rect,
      layout.rightDock?.rect,
    );

    if (dividerZone === 'left-dock-divider') {
      this.state = {
        type: 'resizing-dock',
        dock: 'left',
        startX: event.x,
        startWidth: this.panelManager.getDockWidth('left'),
      };
      return true;
    }

    if (dividerZone === 'right-dock-divider') {
      this.state = {
        type: 'resizing-dock',
        dock: 'right',
        startX: event.x,
        startWidth: this.panelManager.getDockWidth('right'),
      };
      return true;
    }

    // Check if pressing on a panel title bar (for drag/move)
    const panelHit = this.hitTestPanelTitleBar(event.x, event.y, layout);
    if (panelHit) {
      this.state = {
        type: 'dragging-panel',
        panelInstanceId: panelHit,
        startX: event.x,
        startY: event.y,
      };
      // Also focus the panel
      this.panelManager.focusPanel(panelHit);
      return true;
    }

    // Check if clicking inside a panel body (for focus)
    const bodyHit = this.hitTestPanelBody(event.x, event.y, layout);
    if (bodyHit) {
      this.panelManager.focusPanel(bodyHit);
      return false; // Don't consume - let the panel handle it
    }

    return false;
  }

  private handleResizingMouse(event: NativeInputMouseEvent): boolean {
    if (this.state.type !== 'resizing-dock') return false;

    if (event.action === 'release') {
      this.state = { type: 'idle' };
      this.callbacks.onLayoutChange();
      return true;
    }

    if (event.action === 'drag' || event.action === 'move') {
      const deltaX = event.x - this.state.startX;
      const { dock, startWidth } = this.state;

      if (dock === 'left') {
        // Dragging right increases width
        this.panelManager.setDockWidth('left', startWidth + deltaX);
      } else {
        // Dragging left increases width (right dock is on the right side)
        this.panelManager.setDockWidth('right', startWidth - deltaX);
      }

      this.callbacks.onLayoutChange();
      return true;
    }

    return true; // Consume all mouse events while resizing
  }

  private handleDraggingMouse(event: NativeInputMouseEvent): boolean {
    if (this.state.type !== 'dragging-panel') return false;

    if (event.action === 'release') {
      // Determine drop target
      const layout = this.callbacks.getLayout();
      if (layout) {
        const dropDock = this.getDropTargetDock(event.x, event.y, layout);
        if (dropDock && dropDock !== this.getPanelCurrentDock(this.state.panelInstanceId)) {
          this.panelManager.assignToDock(this.state.panelInstanceId, dropDock);
          this.callbacks.onLayoutChange();
        }
      }
      this.state = { type: 'idle' };
      return true;
    }

    // While dragging, consume all mouse events
    return true;
  }

  // -------------------------------------------------------------------------
  // Hit-testing helpers
  // -------------------------------------------------------------------------

  private hitTestPanelTitleBar(
    x: number,
    y: number,
    layout: WorkspaceLayoutResult,
  ): string | null {
    // Check left dock panels
    const leftPanels = this.panelManager.getPanelsInDock('left');
    const leftResult = this.hitTestDockPanels(x, y, layout.leftDock?.rect, leftPanels.length);
    if (leftResult !== null) {
      const panels = this.panelManager.getPanelsInDock('left');
      return panels[leftResult]?.instanceId ?? null;
    }

    // Check right dock panels
    const rightPanels = this.panelManager.getPanelsInDock('right');
    const rightResult = this.hitTestDockPanels(x, y, layout.rightDock?.rect, rightPanels.length);
    if (rightResult !== null) {
      const panels = this.panelManager.getPanelsInDock('right');
      return panels[rightResult]?.instanceId ?? null;
    }

    return null;
  }

  private hitTestPanelBody(
    x: number,
    y: number,
    layout: WorkspaceLayoutResult,
  ): string | null {
    // Check if point is inside left dock
    if (layout.leftDock && isInsideRect(x, y, layout.leftDock.rect)) {
      const panels = this.panelManager.getPanelsInDock('left');
      const index = this.getPanelIndexAtY(y, layout.leftDock.rect, panels.length);
      return panels[index]?.instanceId ?? null;
    }

    // Check if point is inside right dock
    if (layout.rightDock && isInsideRect(x, y, layout.rightDock.rect)) {
      const panels = this.panelManager.getPanelsInDock('right');
      const index = this.getPanelIndexAtY(y, layout.rightDock.rect, panels.length);
      return panels[index]?.instanceId ?? null;
    }

    return null;
  }

  private hitTestDockPanels(
    x: number,
    y: number,
    dockRect: RendererRect | undefined,
    panelCount: number,
  ): number | null {
    if (!dockRect || panelCount === 0) return null;
    if (!isInsideRect(x, y, dockRect)) return null;

    // Title bar is the first row of each panel's allocated space
    const panelHeight = Math.floor(dockRect.height / panelCount);
    const relY = y - dockRect.y;
    const panelIndex = Math.floor(relY / panelHeight);
    const withinPanel = relY - panelIndex * panelHeight;

    // Title bar is row 0 of each panel
    if (withinPanel === 0 && panelIndex < panelCount) {
      return panelIndex;
    }

    return null;
  }

  private getPanelIndexAtY(y: number, dockRect: RendererRect, panelCount: number): number {
    if (panelCount === 0) return 0;
    const panelHeight = Math.floor(dockRect.height / panelCount);
    const relY = y - dockRect.y;
    return Math.min(Math.floor(relY / panelHeight), panelCount - 1);
  }

  private getDropTargetDock(
    x: number,
    _y: number,
    layout: WorkspaceLayoutResult,
  ): 'left' | 'right' | null {
    if (layout.leftDock && x < layout.center.x) return 'left';
    if (layout.rightDock && x >= layout.center.x + layout.center.width) return 'right';
    return null;
  }

  private getPanelCurrentDock(instanceId: string): 'left' | 'right' | null {
    const leftAssignments = this.panelManager.getDockAssignments('left');
    if (leftAssignments.some((a) => a.panelInstanceId === instanceId)) return 'left';
    const rightAssignments = this.panelManager.getDockAssignments('right');
    if (rightAssignments.some((a) => a.panelInstanceId === instanceId)) return 'right';
    return null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isInsideRect(x: number, y: number, rect: RendererRect): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
