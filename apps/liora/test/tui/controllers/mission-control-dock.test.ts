import { describe, expect, it } from 'vitest';

import { missionBandActive } from '#/tui/features/mission-control/dock';
import { buildTUIStateNativeFrameRegions } from '#/tui/features/native-layout/native-layout-frame';
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

describe('mission control bottom band', () => {
  it('activates with content in auto mode on any width', () => {
    const state = createState(200, 80);
    expect(missionBandActive(state)).toBe(false);
    state.missionControlPanel.setView(busyView());
    expect(missionBandActive(state)).toBe(true);
    const narrow = createState(80, 24);
    narrow.missionControlPanel.setView(busyView());
    expect(missionBandActive(narrow)).toBe(true);
  });

  it('pinned mode shows the band even when idle; hidden disables everything', () => {
    const state = createState(200, 80);
    state.appState.appearance = {
      ...state.appState.appearance,
      missionControl: 'pinned',
    } as AppState['appearance'];
    state.missionControlPanel.setPinned(true);
    expect(missionBandActive(state)).toBe(true);

    state.appState.appearance = {
      ...state.appState.appearance,
      missionControl: 'hidden',
    } as AppState['appearance'];
    state.missionControlPanel.setView(busyView());
    expect(missionBandActive(state)).toBe(false);
  });

  it('paints Mission Control in the stage stack, never as a side dock', () => {
    const width = 200;
    const height = 80;
    const state = createState(width, height);
    state.missionControlPanel.setView(busyView());

    const regions = buildTUIStateNativeFrameRegions(state, width, height);
    expect(regions.some((region) => region.id === 'mission-dock')).toBe(false);
    const mission = regions.find((region) => region.id === 'mission');
    expect(mission).toBeDefined();
    expect(mission!.rect.width).toBeGreaterThan(40);
    // Band sits above the editor inside the stage column.
    const editor = regions.find((region) => region.id === 'editor');
    expect(editor).toBeDefined();
    expect(mission!.rect.y + mission!.rect.height).toBeLessThanOrEqual(editor!.rect.y);
    expect(mission!.rect.x).toBe(editor!.rect.x);
  });

  it('keeps the band off while hidden or empty', () => {
    const state = createState(200, 80);
    expect(state.missionControlContainer.render(100)).toEqual([]);
    const regions = buildTUIStateNativeFrameRegions(state, 200, 80);
    expect(regions.some((region) => region.id === 'mission')).toBe(false);
    expect(regions.some((region) => region.id === 'mission-dock')).toBe(false);
  });

  it('renders the shared panel at stage width when active', () => {
    const state = createState(120, 40);
    state.missionControlPanel.setView(busyView());
    const band = state.missionControlContainer.render(100);
    expect(band.length).toBeGreaterThan(0);
    expect(band.join('\n')).toContain('Mission Control');
  });
});
