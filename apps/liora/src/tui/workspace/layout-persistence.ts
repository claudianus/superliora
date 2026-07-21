import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { getDataDir } from '#/utils/paths';

import type { PanelManager } from './panel-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersistedDockEntry {
  readonly panelId: string;
  readonly heightRatio?: number;
}

interface PersistedWorkspaceLayout {
  readonly version: 1;
  readonly leftDockWidth: number;
  readonly rightDockWidth: number;
  readonly leftDockVisible: boolean;
  readonly rightDockVisible: boolean;
  readonly leftDock: PersistedDockEntry[];
  readonly rightDock: PersistedDockEntry[];
  readonly focusedPanelId: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAYOUT_FILE_NAME = 'workspace-layout.json';
const SAVE_DEBOUNCE_MS = 1000;

// ---------------------------------------------------------------------------
// WorkspaceLayoutPersistence
// ---------------------------------------------------------------------------

export class WorkspaceLayoutPersistence {
  private readonly filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly panelManager: PanelManager;

  constructor(panelManager: PanelManager, dataDir?: string) {
    this.panelManager = panelManager;
    this.filePath = join(dataDir ?? getDataDir(), LAYOUT_FILE_NAME);
  }

  /**
   * Load persisted layout and apply it to the panel manager.
   * Maps persisted panel definition IDs to current instance IDs.
   */
  load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch {
      return; // No saved layout — use defaults
    }

    let persisted: PersistedWorkspaceLayout;
    try {
      persisted = JSON.parse(raw) as PersistedWorkspaceLayout;
    } catch {
      return; // Corrupt file — ignore
    }

    if (persisted.version !== 1) return;

    // Apply dock dimensions and visibility
    this.panelManager.setDockWidth('left', persisted.leftDockWidth);
    this.panelManager.setDockWidth('right', persisted.rightDockWidth);
    this.panelManager.setDockVisible('left', persisted.leftDockVisible);
    this.panelManager.setDockVisible('right', persisted.rightDockVisible);

    // Build a map from panel definition id → instance id
    const defToInstance = new Map<string, string>();
    for (const panel of this.panelManager.getAllPanels()) {
      defToInstance.set(panel.definition.id, panel.instanceId);
    }

    // Re-assign panels to docks based on persisted order
    this.reassignDock('left', persisted.leftDock, defToInstance);
    this.reassignDock('right', persisted.rightDock, defToInstance);

    // Restore focus
    if (persisted.focusedPanelId !== null) {
      const instanceId = defToInstance.get(persisted.focusedPanelId);
      if (instanceId !== undefined) {
        this.panelManager.focusPanel(instanceId);
      }
    }
  }

  /**
   * Schedule a debounced save of the current layout.
   */
  scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Immediately persist the current layout.
   */
  saveNow(): void {
    const state = this.panelManager.getState();

    // Map instance IDs back to definition IDs for stable persistence
    const instanceToDef = new Map<string, string>();
    for (const panel of this.panelManager.getAllPanels()) {
      instanceToDef.set(panel.instanceId, panel.definition.id);
    }

    const persisted: PersistedWorkspaceLayout = {
      version: 1,
      leftDockWidth: state.leftDockWidth,
      rightDockWidth: state.rightDockWidth,
      leftDockVisible: state.leftDockVisible,
      rightDockVisible: state.rightDockVisible,
      leftDock: state.leftDock
        .map((a) => ({
          panelId: instanceToDef.get(a.panelInstanceId) ?? a.panelInstanceId,
          heightRatio: a.heightRatio,
        }))
        .filter((e) => e.panelId.length > 0),
      rightDock: state.rightDock
        .map((a) => ({
          panelId: instanceToDef.get(a.panelInstanceId) ?? a.panelInstanceId,
          heightRatio: a.heightRatio,
        }))
        .filter((e) => e.panelId.length > 0),
      focusedPanelId:
        state.focusedPanelId !== null
          ? (instanceToDef.get(state.focusedPanelId) ?? state.focusedPanelId)
          : null,
    };

    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(persisted, null, 2), 'utf-8');
    } catch {
      // Best-effort persistence — don't crash the TUI
    }
  }

  dispose(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private reassignDock(
    dock: 'left' | 'right',
    entries: PersistedDockEntry[],
    defToInstance: Map<string, string>,
  ): void {
    for (const entry of entries) {
      const instanceId = defToInstance.get(entry.panelId);
      if (instanceId !== undefined) {
        this.panelManager.assignToDock(instanceId, dock);
      }
    }
  }
}
