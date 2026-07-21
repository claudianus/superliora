/**
 * Layout preset manager — save/load named workspace layouts.
 * Presets are stored in `~/.superliora/workspace-presets.json`.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { getDataDir } from '#/utils/paths';

import type { PanelManager } from './panel-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresetDockEntry {
  readonly panelId: string;
  readonly heightRatio?: number;
}

interface PresetLayout {
  readonly leftDockWidth: number;
  readonly rightDockWidth: number;
  readonly leftDockVisible: boolean;
  readonly rightDockVisible: boolean;
  readonly leftDock: PresetDockEntry[];
  readonly rightDock: PresetDockEntry[];
  readonly leftDockMode: 'split' | 'tabbed';
  readonly rightDockMode: 'split' | 'tabbed';
}

interface PresetFile {
  readonly version: 1;
  readonly presets: Record<string, PresetLayout>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRESETS_FILE_NAME = 'workspace-presets.json';

// ---------------------------------------------------------------------------
// LayoutPresetManager
// ---------------------------------------------------------------------------

export class LayoutPresetManager {
  private readonly filePath: string;
  private readonly panelManager: PanelManager;
  private presets: Record<string, PresetLayout> = {};

  constructor(panelManager: PanelManager, dataDir?: string) {
    this.panelManager = panelManager;
    this.filePath = join(dataDir ?? getDataDir(), PRESETS_FILE_NAME);
    this.loadFile();
  }

  /** List all preset names. */
  listPresets(): string[] {
    return Object.keys(this.presets).sort();
  }

  /** Save current layout as a named preset. */
  savePreset(name: string): void {
    const state = this.panelManager.getState();

    const instanceToDef = new Map<string, string>();
    for (const panel of this.panelManager.getAllPanels()) {
      instanceToDef.set(panel.instanceId, panel.definition.id);
    }

    const toDockEntries = (dock: 'left' | 'right'): PresetDockEntry[] => {
      const panels = this.panelManager.getPanelsInDock(dock);
      return panels.map((p) => ({
        panelId: instanceToDef.get(p.instanceId) ?? p.definition.id,
      }));
    };

    this.presets[name] = {
      leftDockWidth: state.leftDockWidth,
      rightDockWidth: state.rightDockWidth,
      leftDockVisible: state.leftDockVisible,
      rightDockVisible: state.rightDockVisible,
      leftDock: toDockEntries('left'),
      rightDock: toDockEntries('right'),
      leftDockMode: state.leftDockMode,
      rightDockMode: state.rightDockMode,
    };

    this.saveFile();
  }

  /** Load a named preset and apply it. */
  loadPreset(name: string): boolean {
    const preset = this.presets[name];
    if (!preset) return false;

    this.panelManager.setDockWidth('left', preset.leftDockWidth);
    this.panelManager.setDockWidth('right', preset.rightDockWidth);
    this.panelManager.setDockVisible('left', preset.leftDockVisible);
    this.panelManager.setDockVisible('right', preset.rightDockVisible);

    // Apply dock modes
    this.panelManager.setDockMode('left', preset.leftDockMode);
    this.panelManager.setDockMode('right', preset.rightDockMode);

    // Re-assign panels to docks
    const defToInstance = new Map<string, string>();
    for (const panel of this.panelManager.getAllPanels()) {
      defToInstance.set(panel.definition.id, panel.instanceId);
    }

    this.reassignDock('left', preset.leftDock, defToInstance);
    this.reassignDock('right', preset.rightDock, defToInstance);

    return true;
  }

  /** Delete a named preset. */
  deletePreset(name: string): boolean {
    if (!(name in this.presets)) return false;
    delete this.presets[name];
    this.saveFile();
    return true;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private reassignDock(
    dock: 'left' | 'right',
    entries: PresetDockEntry[],
    defToInstance: Map<string, string>,
  ): void {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const instanceId = defToInstance.get(entry.panelId);
      if (instanceId !== undefined) {
        this.panelManager.assignToDock(instanceId, dock, i);
      }
    }
  }

  private loadFile(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as PresetFile;
      if (data.version === 1) {
        this.presets = data.presets ?? {};
      }
    } catch {
      this.presets = {};
    }
  }

  private saveFile(): void {
    try {
      const data: PresetFile = { version: 1, presets: this.presets };
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Best-effort persistence
    }
  }
}
