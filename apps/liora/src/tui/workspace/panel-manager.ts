import type { WorkspaceDockId, WorkspaceLayoutResult } from '@harness-kit/tui-renderer';

import type { DockAssignment, PanelDefinition, PanelInstance } from './panel-definition';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  private leftDockWidth: number;
  private rightDockWidth: number;
  private leftDockVisible: boolean;
  private rightDockVisible: boolean;
  private leftDockMode: DockMode;
  private rightDockMode: DockMode;
  private focusedPanelId: string | null = null;

  constructor(options: PanelManagerOptions = {}) {
    this.leftDockWidth = options.leftDockWidth ?? 30;
    this.rightDockWidth = options.rightDockWidth ?? 40;
    this.leftDockVisible = options.leftDockVisible ?? true;
    this.rightDockVisible = options.rightDockVisible ?? true;
    this.leftDockMode = options.leftDockMode ?? 'split';
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
    const clamped = Math.max(15, Math.min(80, width));
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

  focusPanel(instanceId: string): void {
    if (this.focusedPanelId === instanceId) return;

    // Blur previous
    if (this.focusedPanelId) {
      const prev = this.panels.get(this.focusedPanelId);
      prev?.definition.onBlur?.();
    }

    this.focusedPanelId = instanceId;
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
    };
  }

  restoreState(state: PanelManagerState): void {
    this.leftDock = [...state.leftDock];
    this.rightDock = [...state.rightDock];
    this.leftDockWidth = state.leftDockWidth;
    this.rightDockWidth = state.rightDockWidth;
    this.leftDockVisible = state.leftDockVisible;
    this.rightDockVisible = state.rightDockVisible;
    this.leftDockMode = state.leftDockMode ?? 'split';
    this.rightDockMode = state.rightDockMode ?? 'tabbed';
    this.focusedPanelId = state.focusedPanelId;
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
    this.focusedPanelId = null;
  }
}
