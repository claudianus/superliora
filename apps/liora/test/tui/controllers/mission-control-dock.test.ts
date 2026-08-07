import { describe, expect, it } from 'vitest';

import {
  MISSION_DOCK_MIN_COLUMNS,
  MISSION_DOCK_WIDTH,
  MISSION_DOCK_Z_INDEX,
  missionDockActive,
  missionFallbackActive,
  missionWorkspaceCenterRect,
} from '#/tui/features/mission-control/dock';
import { buildTUIStateNativeFrameRegions } from '#/tui/features/native-layout/native-layout-frame';
import { STAGE_MAX_WIDTH } from '#/tui/controllers/layout/stage-layout';
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

  it('shrinks the workspace center band by the dock width', () => {
    const state = createState(200, 80);
    state.missionControlPanel.setView(busyView());
    const center = missionWorkspaceCenterRect(state, 200, 80);
    expect(center).toEqual({ x: 0, y: 0, width: 200 - MISSION_DOCK_WIDTH, height: 80 });
    expect(missionWorkspaceCenterRect(state, 120, 80)).toBeUndefined();
  });

  it('paints the dock region at the right band and centers the stage left of it', () => {
    const width = 200;
    const height = 80;
    const state = createState(width, height);
    state.missionControlPanel.setView(busyView());

    const center = missionWorkspaceCenterRect(state, width, height);
    const regions = buildTUIStateNativeFrameRegions(state, width, height, {
      workspaceCenter: center ?? undefined,
    });
    const dock = regions.find((region) => region.id === 'mission-dock');
    expect(dock?.rect).toEqual({
      x: width - MISSION_DOCK_WIDTH,
      y: 0,
      width: MISSION_DOCK_WIDTH,
      height,
    });
    // Letterbox sky is z=4 and the stage frame rim is z=5; without a higher
    // dock z-index the night-sky gutters bury Mission Control on wide frames.
    expect(dock?.zIndex).toBe(MISSION_DOCK_Z_INDEX);
    expect(MISSION_DOCK_Z_INDEX).toBeGreaterThan(5);
    const letterbox = regions.filter((region) => region.id.startsWith('stageFrameLetterbox:'));
    expect(letterbox.length).toBeGreaterThan(0);
    for (const band of letterbox) {
      expect(band.zIndex ?? 0).toBeLessThan(MISSION_DOCK_Z_INDEX);
    }
    const transcript = regions.find((region) => region.id === 'transcript');
    expect(transcript?.rect.width).toBe(STAGE_MAX_WIDTH);
    expect(transcript?.rect.x).toBe(Math.floor((width - MISSION_DOCK_WIDTH - STAGE_MAX_WIDTH) / 2));
  });

  it('keeps the dock above letterbox when the stage is near-fullscreen', () => {
    const width = 200;
    const height = 80;
    const state = createState(width, height);
    state.missionControlPanel.setView(busyView());
    // Large enough to feel fullscreen, but leave STAGE_FRAME_MARGIN on every
    // edge so the letterbox sky still paints — including over the dock band.
    state.userStageSize = {
      width: width - MISSION_DOCK_WIDTH - 6,
      height: height - 6,
    };

    const center = missionWorkspaceCenterRect(state, width, height);
    const regions = buildTUIStateNativeFrameRegions(state, width, height, {
      workspaceCenter: center ?? undefined,
    });
    const dock = regions.find((region) => region.id === 'mission-dock');
    expect(dock?.rect).toEqual({
      x: width - MISSION_DOCK_WIDTH,
      y: 0,
      width: MISSION_DOCK_WIDTH,
      height,
    });
    expect(dock?.zIndex).toBe(MISSION_DOCK_Z_INDEX);
    const rightLetterbox = regions.find(
      (region) =>
        region.id.startsWith('stageFrameLetterbox:') &&
        region.rect.x + region.rect.width === width,
    );
    expect(rightLetterbox).toBeDefined();
    expect(rightLetterbox!.zIndex ?? 0).toBeLessThan(MISSION_DOCK_Z_INDEX);
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
