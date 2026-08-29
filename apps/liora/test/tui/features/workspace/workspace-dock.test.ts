/**
 * Workspace side dock — toggle lifecycle and frame-region construction.
 * The flag snapshot is driven through `setExperimentalFeatures` so both the
 * enabled and disabled paths are covered hermetically.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { setExperimentalFeatures } from '#/tui/commands/experimental-flags';
import { WorkerTranscriptViewerComponent } from '#/tui/components/dialogs/worker-dock/worker-transcript-viewer';
import {
  closeWorkspaceDock,
  createWorkspaceDockFrameRegion,
  getWorkspaceDockCenterRect,
  isWorkspaceDockOpen,
  toggleWorkspaceDock,
} from '#/tui/features/workspace/workspace-dock';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import type { TUIState } from '#/tui/tui-state';

function fakeState(): TUIState {
  return {
    transcriptContainer: { isBatchMounting: false },
    renderer: { requestRender: () => {}, invalidateFrame: () => {} },
  } as unknown as TUIState;
}

function stubViewer(): WorkerTranscriptViewerComponent {
  return new WorkerTranscriptViewerComponent({
    workerId: 'agent_w1',
    getWorker: () => undefined,
    loadTranscript: async () => ({ lines: ['◇ kickoff', '⚙ Bash pnpm test'] }),
    onCancel: () => {},
  });
}

afterEach(() => {
  closeWorkspaceDock(fakeState());
  setExperimentalFeatures([]);
  setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
});

describe('workspace dock controller', () => {
  it('stays fully inert while the flag is off', () => {
    setExperimentalFeatures([{ id: 'workspace_dock', enabled: false }]);
    const state = fakeState();
    toggleWorkspaceDock({ state, workerId: 'agent_w1', createViewer: stubViewer });

    expect(isWorkspaceDockOpen()).toBe(false);
    expect(getWorkspaceDockCenterRect({ columns: 200, rows: 50 })).toBeNull();
    expect(
      createWorkspaceDockFrameRegion({
        center: { x: 0, y: 0, width: 100, height: 40 },
        width: 200,
        height: 50,
      }),
    ).toBeUndefined();
  });

  it('supplies a center band only while open, and toggles closed on re-open', () => {
    setExperimentalFeatures([{ id: 'workspace_dock', enabled: true }]);
    const state = fakeState();

    expect(getWorkspaceDockCenterRect({ columns: 200, rows: 50 })).toBeNull();

    toggleWorkspaceDock({ state, workerId: 'agent_w1', createViewer: stubViewer });
    expect(isWorkspaceDockOpen()).toBe(true);

    const center = getWorkspaceDockCenterRect({ columns: 200, rows: 50 });
    expect(center).not.toBeNull();
    // The center band must leave room for the dock column at the right edge.
    expect(center!.width).toBeLessThan(200);

    // Same-row re-click closes.
    toggleWorkspaceDock({ state, workerId: 'agent_w1', createViewer: stubViewer });
    expect(isWorkspaceDockOpen()).toBe(false);
    expect(getWorkspaceDockCenterRect({ columns: 200, rows: 50 })).toBeNull();
  });

  it('builds a dock region right of the center band while open', () => {
    setExperimentalFeatures([{ id: 'workspace_dock', enabled: true }]);
    const state = fakeState();
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    toggleWorkspaceDock({ state, workerId: 'agent_w1', createViewer: stubViewer });

    const center = { x: 10, y: 2, width: 100, height: 40 };
    const region = createWorkspaceDockFrameRegion({ center, width: 200, height: 50 });
    expect(region).toBeDefined();
    // The dock starts past the center band plus the two-column gap, ends one
    // column short of the terminal edge, and matches the center height.
    expect(region!.rect.x).toBe(center.x + center.width + 2);
    expect(region!.rect.width).toBe(200 - (center.x + center.width + 2) - 1);
    expect(region!.rect.y).toBe(center.y);
    expect(region!.rect.height).toBe(center.height);
    expect(region!.clear).toBe(true);
    expect(region!.content.length).toBeGreaterThan(0);
  });

  it('skips the region when the remaining columns are too narrow', () => {
    setExperimentalFeatures([{ id: 'workspace_dock', enabled: true }]);
    const state = fakeState();
    toggleWorkspaceDock({ state, workerId: 'agent_w1', createViewer: stubViewer });

    const region = createWorkspaceDockFrameRegion({
      center: { x: 0, y: 0, width: 180, height: 40 },
      width: 200,
      height: 50,
    });
    expect(region).toBeUndefined();
  });
});
