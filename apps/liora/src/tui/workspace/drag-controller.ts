import type {
  KittyPointerShape,
  NativeInputMouseEvent,
  NativeInputRouter,
  WorkspaceLayoutResult,
} from '@harness-kit/tui-renderer';
import { hitTestDockDivider, ansiPushPointerShape, ANSI_POP_POINTER_SHAPE } from '@harness-kit/tui-renderer';

import type { PanelManager } from './panel-manager';
import { getPanelIndexAtY, hitTestPanelAt, hitTestPanelTitleBarAt } from './pointer-routing';

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
      readonly panelTitle: string;
      readonly startX: number;
      readonly startY: number;
      readonly currentX: number;
      readonly currentY: number;
    };

/** Visual overlay info for rendering drag feedback. */
export interface DragOverlayInfo {
  readonly type: 'dragging-panel';
  readonly panelTitle: string;
  readonly x: number;
  readonly y: number;
  readonly dropDock: 'left' | 'right' | null;
}

/** Visual info for rendering resize feedback. */
export interface ResizeOverlayInfo {
  readonly dock: 'left' | 'right';
  readonly x: number;
  readonly y: number;
  readonly currentWidth: number;
}

export interface DragControllerCallbacks {
  /** Called when the layout needs to be re-rendered. */
  readonly onLayoutChange: () => void;
  /** Get the current workspace layout for hit-testing. */
  readonly getLayout: () => WorkspaceLayoutResult | null;
  /** Called when a panel title bar is double-clicked (toggle maximize). */
  readonly onDoubleClickPanel?: (panelInstanceId: string) => void;
}

// ---------------------------------------------------------------------------
// DragController
// ---------------------------------------------------------------------------

export class DragController {
  private state: DragState = { type: 'idle' };
  private readonly panelManager: PanelManager;
  private readonly callbacks: DragControllerCallbacks;
  private unregisterHandler: (() => void) | null = null;
  /** Track last click time and target for double-click detection. */
  private lastClickAt = 0;
  private lastClickPanelId: string | null = null;
  /** Pointer shape currently pushed for idle hover (null = no hover push active). */
  private hoverShape: KittyPointerShape | null = null;

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

  /** Get visual overlay info for rendering drag feedback. Returns null when idle. */
  getDragOverlay(): DragOverlayInfo | null {
    if (this.state.type !== 'dragging-panel') return null;
    const layout = this.callbacks.getLayout();
    const dropDock = layout ? this.getDropTargetDock(this.state.currentX, this.state.currentY, layout) : null;
    return {
      type: 'dragging-panel',
      panelTitle: this.state.panelTitle,
      x: this.state.currentX,
      y: this.state.currentY,
      dropDock,
    };
  }

  /** Get resize overlay info for rendering resize feedback. Returns null when not resizing. */
  getResizeInfo(): ResizeOverlayInfo | null {
    if (this.state.type !== 'resizing-dock') return null;
    const layout = this.callbacks.getLayout();
    if (!layout) return null;
    const dockRect = this.state.dock === 'left' ? layout.leftDock?.rect : layout.rightDock?.rect;
    const currentWidth = this.panelManager.getDockWidth(this.state.dock);
    return {
      dock: this.state.dock,
      x: dockRect ? dockRect.x + Math.floor(dockRect.width / 2) - 2 : this.state.startX,
      y: dockRect ? dockRect.y : 0,
      currentWidth,
    };
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
    if (event.action === 'move') {
      this.updateHoverPointerShape(event);
      return false;
    }

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
      process.stdout.write(ansiPushPointerShape('ew-resize'));
      return true;
    }

    if (dividerZone === 'right-dock-divider') {
      this.state = {
        type: 'resizing-dock',
        dock: 'right',
        startX: event.x,
        startWidth: this.panelManager.getDockWidth('right'),
      };
      process.stdout.write(ansiPushPointerShape('ew-resize'));
      return true;
    }

    // Check if pressing on a panel title bar (for drag/move)
    const panelHit = hitTestPanelTitleBarAt(layout, this.panelManager, event.x, event.y);
    if (panelHit) {
      // Double-click detection: toggle maximize
      const now = Date.now();
      if (this.lastClickPanelId === panelHit && now - this.lastClickAt < 400) {
        this.lastClickAt = 0;
        this.lastClickPanelId = null;
        this.callbacks.onDoubleClickPanel?.(panelHit);
        return true;
      }
      this.lastClickAt = now;
      this.lastClickPanelId = panelHit;

      const panel = this.panelManager.getPanel(panelHit);
      this.state = {
        type: 'dragging-panel',
        panelInstanceId: panelHit,
        panelTitle: panel?.definition.title ?? 'Panel',
        startX: event.x,
        startY: event.y,
        currentX: event.x,
        currentY: event.y,
      };
      // Also focus the panel
      this.panelManager.focusPanel(panelHit);
      process.stdout.write(ansiPushPointerShape('grabbing'));
      return true;
    }

    // Check if clicking inside a panel body (for focus)
    const bodyHit = hitTestPanelAt(layout, this.panelManager, event.x, event.y);
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
      process.stdout.write(ANSI_POP_POINTER_SHAPE);
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
        const currentDock = this.getPanelCurrentDock(this.state.panelInstanceId);
        if (dropDock && dropDock !== currentDock) {
          // Cross-dock move
          this.panelManager.assignToDock(this.state.panelInstanceId, dropDock);
          this.callbacks.onLayoutChange();
        } else if (dropDock && dropDock === currentDock) {
          // Within-dock reorder: determine target index by Y position
          const dockRect = dropDock === 'left' ? layout.leftDock?.rect : layout.rightDock?.rect;
          if (dockRect) {
            const panels = this.panelManager.getPanelsInDock(dropDock);
            const targetIndex = getPanelIndexAtY(event.y, dockRect, panels.length);
            const assignments = this.panelManager.getDockAssignments(dropDock);
            const draggedId = this.state.panelInstanceId;
            const currentIndex = assignments.findIndex(
              (a) => a.panelInstanceId === draggedId,
            );
            if (currentIndex !== -1 && targetIndex !== currentIndex) {
              // Remove and re-insert at target position
              this.panelManager.removeFromDock(draggedId);
              this.panelManager.assignToDock(draggedId, dropDock, targetIndex);
              this.callbacks.onLayoutChange();
            }
          }
        }
      }
      this.state = { type: 'idle' };
      process.stdout.write(ANSI_POP_POINTER_SHAPE);
      this.callbacks.onLayoutChange();
      return true;
    }

    // Track current position for visual feedback
    if (event.action === 'drag' || event.action === 'move') {
      this.state = {
        ...this.state,
        currentX: event.x,
        currentY: event.y,
      };
      this.callbacks.onLayoutChange();
    }

    // While dragging, consume all mouse events
    return true;
  }

  // -------------------------------------------------------------------------
  // Idle hover pointer shapes
  // -------------------------------------------------------------------------

  /**
   * On idle mouse move, set a pointer shape reflecting the hit zone under
   * the cursor (dock divider, panel title bar, or panel body), and pop it
   * once the cursor leaves that zone. Never pushes more than one hover
   * shape at a time — only writes to the terminal when the shape changes.
   */
  private updateHoverPointerShape(event: NativeInputMouseEvent): void {
    const layout = this.callbacks.getLayout();
    if (!layout) {
      this.setHoverShape(null);
      return;
    }

    const dividerZone = hitTestDockDivider(event.x, event.y, layout.leftDock?.rect, layout.rightDock?.rect);
    if (dividerZone !== 'none') {
      this.setHoverShape('ew-resize');
      return;
    }

    if (hitTestPanelTitleBarAt(layout, this.panelManager, event.x, event.y) !== null) {
      this.setHoverShape('grab');
      return;
    }

    if (hitTestPanelAt(layout, this.panelManager, event.x, event.y) !== null) {
      this.setHoverShape('pointer');
      return;
    }

    this.setHoverShape(null);
  }

  private setHoverShape(shape: KittyPointerShape | null): void {
    if (shape === this.hoverShape) return;
    if (this.hoverShape !== null) {
      process.stdout.write(ANSI_POP_POINTER_SHAPE);
    }
    if (shape !== null) {
      process.stdout.write(ansiPushPointerShape(shape));
    }
    this.hoverShape = shape;
  }

  // -------------------------------------------------------------------------
  // Hit-testing helpers
  // -------------------------------------------------------------------------

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
