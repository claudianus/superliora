import { describe, expect, it } from 'vitest';

import {
  MISSION_DOCK_GAP,
  MISSION_DOCK_MIN_COLUMNS,
  MISSION_DOCK_WIDTH,
  MISSION_DOCK_Z_INDEX,
  measureMissionBentoCluster,
  missionDockActive,
  missionFallbackActive,
  missionWorkspaceCenterRect,
} from '#/tui/features/mission-control/dock';
import { buildTUIStateNativeFrameRegions } from '#/tui/features/native-layout/native-layout-frame';
import { STAGE_MAX_HEIGHT, STAGE_MAX_WIDTH } from '#/tui/controllers/layout/stage-layout';
import { createTUIState, type TUIState } from '#/tui/tui-state';
import type { MissionControlView } from '#/tui/components/panes/mission-control/panel';
import { emptyConductorJobsSnapshot } from '#/tui/utils/job/job-strip';
import type { AppState } from '#/tui/types';

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/kimi-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    askMode: false,
    inputMode: 'prompt',
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: '0.0.0-test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    availableModels: {},
    availableProviders: {},
    sessionTitle: null,
    mcpServersSummary: null,
  };
}

function createState(columns: number, rows: number): TUIState {
  const state = createTUIState({
    initialAppState: fakeInitialAppState(),
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
  });
  Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => rows });
  Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => columns });
  state.editorContainer.addChild(state.editor);
  return state;
}

function busyView(): MissionControlView {
  return {
    snapshot: {
      version: 1,
      activeCount: 1,
      totalTokens: 100,
      ops: [],
      workers: [
        {
          id: 'sa-1',
          name: 'explore-1',
          kind: 'subagent',
          status: 'running',
          runInBackground: false,
          toolCount: 3,
          tokens: 100,
          elapsedMs: 5_000,
          lastActivityAtMs: 1_000,
        },
      ],
    },
    jobs: emptyConductorJobsSnapshot(),
  };
}

describe('mission control dock geometry', () => {
  it('activates only on wide terminals with content (auto mode)', () => {
    const state = createState(200, 80);
    expect(missionDockActive(state, 200)).toBe(false);
    state.missionControlPanel.setView(busyView());
    expect(missionDockActive(state, 200)).toBe(true);
    expect(missionDockActive(state, MISSION_DOCK_MIN_COLUMNS - 1)).toBe(false);
    expect(missionFallbackActive(state, MISSION_DOCK_MIN_COLUMNS - 1)).toBe(true);
  });

  it('pinned mode shows the dock even when idle; hidden disables everything', () => {
    const state = createState(200, 80);
    state.appState.appearance = {
      ...state.appState.appearance,
      missionControl: 'pinned',
    } as AppState['appearance'];
    state.missionControlPanel.setPinned(true);
    expect(missionDockActive(state, 200)).toBe(true);

    state.appState.appearance = {
      ...state.appState.appearance,
      missionControl: 'hidden',
    } as AppState['appearance'];
    state.missionControlPanel.setView(busyView());
    expect(missionDockActive(state, 200)).toBe(false);
    expect(missionFallbackActive(state, 120)).toBe(false);
  });

  it('places stage+dock as a centered capped cluster', () => {
    const state = createState(200, 80);
    state.missionControlPanel.setView(busyView());
    const cluster = measureMissionBentoCluster(200, 80);
    const center = missionWorkspaceCenterRect(state, 200, 80);
    expect(center).toEqual(cluster.stageBand);
    expect(cluster.stageBand).toEqual({
      x: Math.floor((200 - (STAGE_MAX_WIDTH + MISSION_DOCK_GAP + MISSION_DOCK_WIDTH)) / 2),
      y: Math.floor((80 - STAGE_MAX_HEIGHT) / 2),
      width: STAGE_MAX_WIDTH,
      height: STAGE_MAX_HEIGHT,
    });
    expect(cluster.dock).toEqual({
      x: cluster.stageBand.x + STAGE_MAX_WIDTH + MISSION_DOCK_GAP,
      y: cluster.stageBand.y,
      width: MISSION_DOCK_WIDTH,
      height: STAGE_MAX_HEIGHT,
    });
    // Not edge-pinned.
    expect(cluster.dock.x + cluster.dock.width).toBeLessThan(200);
    expect(missionWorkspaceCenterRect(state, 120, 80)).toBeUndefined();
  });

  it('paints the dock adjacent to the stage inside the centered cluster', () => {
    const width = 200;
    const height = 80;
    const state = createState(width, height);
    state.missionControlPanel.setView(busyView());

    const cluster = measureMissionBentoCluster(width, height);
    const regions = buildTUIStateNativeFrameRegions(state, width, height, {
      workspaceCenter: cluster.stageBand,
    });
    const dock = regions.find((region) => region.id === 'mission-dock');
    expect(dock?.rect).toEqual(cluster.dock);
    // Letterbox sky is z=4 and the stage frame rim is z=5; without a higher
    // dock z-index the night-sky gutters bury Mission Control on wide frames.
    expect(dock?.zIndex).toBe(MISSION_DOCK_Z_INDEX);
    expect(MISSION_DOCK_Z_INDEX).toBeGreaterThan(5);
    const letterbox = regions.filter(
      (region) => region.id?.startsWith('stageFrameLetterbox:') === true,
    );
    expect(letterbox.length).toBeGreaterThan(0);
    for (const band of letterbox) {
      expect(band.zIndex ?? 0).toBeLessThan(MISSION_DOCK_Z_INDEX);
    }
    const transcript = regions.find((region) => region.id === 'transcript');
    expect(transcript?.rect.width).toBe(STAGE_MAX_WIDTH);
    expect(transcript?.rect.x).toBe(cluster.stageBand.x);
    expect(transcript?.rect.y).toBeGreaterThanOrEqual(cluster.stageBand.y);
  });

  it('keeps the dock height-matched to a near-fullscreen stage', () => {
    const width = 200;
    const height = 80;
    const state = createState(width, height);
    state.missionControlPanel.setView(busyView());
    state.userStageSize = {
      width: width - MISSION_DOCK_WIDTH - MISSION_DOCK_GAP - 6,
      height: height - 6,
    };

    const cluster = measureMissionBentoCluster(width, height, state.userStageSize);
    const regions = buildTUIStateNativeFrameRegions(state, width, height, {
      workspaceCenter: cluster.stageBand,
    });
    const dock = regions.find((region) => region.id === 'mission-dock');
    expect(dock?.rect).toEqual(cluster.dock);
    expect(dock?.rect.height).toBe(cluster.stageBand.height);
    expect(dock?.rect.y).toBe(cluster.stageBand.y);
    expect(dock?.rect.x).toBe(cluster.stageBand.x + cluster.stageBand.width + MISSION_DOCK_GAP);
    expect(dock?.zIndex).toBe(MISSION_DOCK_Z_INDEX);
    const letterbox = regions.filter(
      (region) => region.id?.startsWith('stageFrameLetterbox:') === true,
    );
    expect(letterbox.length).toBeGreaterThan(0);
    for (const band of letterbox) {
      expect(band.zIndex ?? 0).toBeLessThan(MISSION_DOCK_Z_INDEX);
    }
  });

  it('keeps the dock off narrow frames and mounts the fallback band instead', () => {
    const width = 120;
    const height = 40;
    const state = createState(width, height);
    state.missionControlPanel.setView(busyView());

    const regions = buildTUIStateNativeFrameRegions(state, width, height);
    expect(regions.some((region) => region.id === 'mission-dock')).toBe(false);
    // The in-stack band renders the same panel at the content width.
    const band = state.missionControlContainer.render(100);
    expect(band.length).toBeGreaterThan(0);
    expect(band.join('\n')).toContain('Mission Control');
  });

  it('collapses both surfaces while hidden or empty', () => {
    const state = createState(200, 80);
    expect(state.missionControlContainer.render(100)).toEqual([]);
    const regions = buildTUIStateNativeFrameRegions(state, 200, 80);
    expect(regions.some((region) => region.id === 'mission-dock')).toBe(false);
  });
});
