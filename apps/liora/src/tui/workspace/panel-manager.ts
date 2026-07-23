import type { WorkspaceDockId, WorkspaceLayoutResult, BentoPanelSpec } from '@harness-kit/tui-renderer';
import {
  DEFAULT_LEFT_DOCK_WIDTH,
  DEFAULT_RIGHT_DOCK_WIDTH,
  DOCK_WIDTH_MAX,
  DOCK_WIDTH_MIN,
} from '@harness-kit/tui-renderer';

import type { DockAssignment, PanelDefinition, PanelInstance } from './panel-definition';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GridCellAssignment {
  readonly panelInstanceId: string;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly priority: number;
}

export interface PanelManagerState {
  readonly leftDock: DockAssignment[];
  readonly rightDock: DockAssignment[];
  readonly leftDockWidth: number;
  readonly rightDockWidth: number;
  readonly leftDockVisible: boolean;
  readonly rightDockVisible: boolean;
  readonly leftDockMode: DockMode;
  readonly rightDockMode: DockMode;
  readonly focusedPanelId: string | null;
  readonly gridCells?: GridCellAssignment[];
}

export type DockMode = 'split' | 'tabbed';

export interface PanelManagerOptions {
  readonly leftDockWidth?: number;
  readonly rightDockWidth?: number;
  readonly leftDockVisible?: boolean;
  readonly rightDockVisible?: boolean;
  readonly leftDockMode?: DockMode;
  readonly rightDockMode?: DockMode;
}

// ---------------------------------------------------------------------------
// PanelManager
// ---------------------------------------------------------------------------

let nextInstanceId = 1;

export class PanelManager {
  private readonly panels = new Map<string, PanelInstance>();
  private leftDock: DockAssignment[] = [];
  private rightDock: DockAssignment[] = [];
  private gridCells: GridCellAssignment[] = [];
  private leftDockWidth: number;
  private rightDockWidth: number;
  private leftDockVisible: boolean;
  private rightDockVisible: boolean;
  private leftDockMode: DockMode;
  private rightDockMode: DockMode;
  private focusedPanelId: string | null = null;
  private lastFocusChangeAtMs = 0;

  constructor(options: PanelManagerOptions = {}) {
    this.leftDockWidth = options.leftDockWidth ?? DEFAULT_LEFT_DOCK_WIDTH;
    this.rightDockWidth = options.rightDockWidth ?? DEFAULT_RIGHT_DOCK_WIDTH;
    this.leftDockVisible = options.leftDockVisible ?? true;
    this.rightDockVisible = options.rightDockVisible ?? true;
    this.leftDockMode = options.leftDockMode ?? 'split';
    // Left dock stays split (Files | Git) as a readable two/three-tile bento.
    // Right dock defaults to tabbed — six tool panels in split become postage
    // stamps with nested ││ chrome; Ctrl+T still toggles split per dock.
    this.rightDockMode = options.rightDockMode ?? 'tabbed';
  }

  // -------------------------------------------------------------------------
  // Panel registration
  // -------------------------------------------------------------------------

  registerPanel(definition: PanelDefinition): string {
    const instanceId = `${definition.id}-${nextInstanceId++}`;
    this.panels.set(instanceId, { instanceId, definition });
    return instanceId;
  }

  unregisterPanel(instanceId: string): void {
    const panel = this.panels.get(instanceId);
    if (panel) {
      panel.definition.dispose?.();
      this.panels.delete(instanceId);
      this.removeFromDock(instanceId);
      this.removeFromGrid(instanceId);
      if (this.focusedPanelId === instanceId) {
        this.focusedPanelId = null;
      }
    }
  }

  getPanel(instanceId: string): PanelInstance | undefined {
    return this.panels.get(instanceId);
  }

  getAllPanels(): PanelInstance[] {
    return [...this.panels.values()];
  }

  // -------------------------------------------------------------------------
  // Bento grid cell management
  // -------------------------------------------------------------------------

  /**
   * Add a panel to the bento grid with the given span and priority.
   * If the panel is already in the grid, its assignment is updated.
   */
  addToGrid(instanceId: string, colSpan: number, rowSpan: number, priority: number): void {
    this.removeFromGrid(instanceId);
    this.gridCells.push({ panelInstanceId: instanceId, colSpan, rowSpan, priority });
  }

  removeFromGrid(instanceId: string): void {
    this.gridCells = this.gridCells.filter((c) => c.panelInstanceId !== instanceId);
  }

  getGridCells(): GridCellAssignment[] {
    return [...this.gridCells];
  }

  /**
   * Returns BentoPanelSpec[] for the layout engine, derived from grid cell assignments.
   * Only includes panels that are still registered.
   */
  getBentoPanelSpecs(): BentoPanelSpec[] {
    return this.gridCells
      .filter((c) => this.panels.has(c.panelInstanceId))
      .map((c) => ({
        id: c.panelInstanceId,
        colSpan: c.colSpan,
        rowSpan: c.rowSpan,
        priority: c.priority,
      }));
  }

  // -------------------------------------------------------------------------
  // Dock management
  // -------------------------------------------------------------------------

  assignToDock(instanceId: string, dock: WorkspaceDockId, index?: number): void {
    // Remove from current dock first
    this.removeFromDock(instanceId);

    const assignment: DockAssignment = { panelInstanceId: instanceId };
    const targetDock = dock === 'left' ? this.leftDock : this.rightDock;

    if (index !== undefined && index >= 0 && index <= targetDock.length) {
      targetDock.splice(index, 0, assignment);
    } else {
      targetDock.push(assignment);
    }
  }

  removeFromDock(instanceId: string): void {
    this.leftDock = this.leftDock.filter((a) => a.panelInstanceId !== instanceId);
    this.rightDock = this.rightDock.filter((a) => a.panelInstanceId !== instanceId);
  }

  getPanelsInDock(dock: WorkspaceDockId): PanelInstance[] {
    const assignments = dock === 'left' ? this.leftDock : this.rightDock;
    return assignments
      .map((a) => this.panels.get(a.panelInstanceId))
      .filter((p): p is PanelInstance => p !== undefined);
  }

  getDockAssignments(dock: WorkspaceDockId): DockAssignment[] {
    return dock === 'left' ? [...this.leftDock] : [...this.rightDock];
  }

  // -------------------------------------------------------------------------
  // Dock sizing and visibility
  // -------------------------------------------------------------------------

  getDockWidth(dock: WorkspaceDockId): number {
    return dock === 'left' ? this.leftDockWidth : this.rightDockWidth;
  }

  setDockWidth(dock: WorkspaceDockId, width: number): void {
    const clamped = Math.max(DOCK_WIDTH_MIN, Math.min(DOCK_WIDTH_MAX, Math.round(width)));
    if (dock === 'left') {
      this.leftDockWidth = clamped;
    } else {
      this.rightDockWidth = clamped;
    }
  }

  getDockMode(dock: WorkspaceDockId): DockMode {
    return dock === 'left' ? this.leftDockMode : this.rightDockMode;
  }

  setDockMode(dock: WorkspaceDockId, mode: DockMode): void {
    if (dock === 'left') {
      this.leftDockMode = mode;
    } else {
      this.rightDockMode = mode;
    }
  }

  toggleDockMode(dock: WorkspaceDockId): void {
    const current = this.getDockMode(dock);
    this.setDockMode(dock, current === 'split' ? 'tabbed' : 'split');
  }

  isDockVisible(dock: WorkspaceDockId): boolean {
    return dock === 'left' ? this.leftDockVisible : this.rightDockVisible;
  }

  toggleDock(dock: WorkspaceDockId): void {
    if (dock === 'left') {
      this.leftDockVisible = !this.leftDockVisible;
    } else {
      this.rightDockVisible = !this.rightDockVisible;
    }
  }

  setDockVisible(dock: WorkspaceDockId, visible: boolean): void {
    if (dock === 'left') {
      this.leftDockVisible = visible;
    } else {
      this.rightDockVisible = visible;
    }
  }

  // -------------------------------------------------------------------------
  // Focus management
  // -------------------------------------------------------------------------

  getFocusedPanelId(): string | null {
    return this.focusedPanelId;
  }

  /** Timestamp of the last focus change (for transition animations). */
  getLastFocusChangeAtMs(): number {
    return this.lastFocusChangeAtMs;
  }

  focusPanel(instanceId: string): void {
    if (this.focusedPanelId === instanceId) return;

    // Blur previous
    if (this.focusedPanelId) {
      const prev = this.panels.get(this.focusedPanelId);
      prev?.definition.onBlur?.();
    }

    this.focusedPanelId = instanceId;
    this.lastFocusChangeAtMs = Date.now();
    const next = this.panels.get(instanceId);
    next?.definition.onFocus?.();
  }

  blurAll(): void {
    if (this.focusedPanelId) {
      const prev = this.panels.get(this.focusedPanelId);
      prev?.definition.onBlur?.();
      this.focusedPanelId = null;
    }
  }

  focusPanelByIndex(index: number): void {
    // 1-based index across all visible panels (left dock then right dock)
    const allVisible = [...this.getPanelsInDock('left'), ...this.getPanelsInDock('right')];
    const panel = allVisible[index - 1];
    if (panel) {
      this.focusPanel(panel.instanceId);
    }
  }

  // -------------------------------------------------------------------------
  // State serialization
  // -------------------------------------------------------------------------

  getState(): PanelManagerState {
    return {
      leftDock: [...this.leftDock],
      rightDock: [...this.rightDock],
      leftDockWidth: this.leftDockWidth,
      rightDockWidth: this.rightDockWidth,
      leftDockVisible: this.leftDockVisible,
      rightDockVisible: this.rightDockVisible,
      leftDockMode: this.leftDockMode,
      rightDockMode: this.rightDockMode,
      focusedPanelId: this.focusedPanelId,
      gridCells: [...this.gridCells],
    };
  }

  restoreState(state: PanelManagerState): void {
    this.leftDock = [...state.leftDock];
    this.rightDock = [...state.rightDock];
    // Route through setDockWidth so restored widths are clamped (e.g. ultra-narrow
    // widths persisted by an older version get upgraded to DOCK_WIDTH_MIN).
    this.setDockWidth('left', state.leftDockWidth);
    this.setDockWidth('right', state.rightDockWidth);
    this.leftDockVisible = state.leftDockVisible;
    this.rightDockVisible = state.rightDockVisible;
    this.leftDockMode = state.leftDockMode ?? 'split';
    this.rightDockMode = state.rightDockMode ?? 'tabbed';
    this.focusedPanelId = state.focusedPanelId;
    this.gridCells = [...(state.gridCells ?? [])];
  }

  // -------------------------------------------------------------------------
  // Layout integration
  // -------------------------------------------------------------------------

  getLayoutOptions(): {
    leftDockWidth: number;
    rightDockWidth: number;
    leftDockVisible: boolean;
    rightDockVisible: boolean;
  } {
    return {
      leftDockWidth: this.leftDockWidth,
      rightDockWidth: this.rightDockWidth,
      leftDockVisible: this.leftDockVisible && this.leftDock.length > 0,
      rightDockVisible: this.rightDockVisible && this.rightDock.length > 0,
    };
  }

  /**
   * Dispose all panels and clear state.
   */
  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.definition.dispose?.();
    }
    this.panels.clear();
    this.leftDock = [];
    this.rightDock = [];
    this.gridCells = [];
    this.focusedPanelId = null;
  }
}
