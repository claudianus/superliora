import { describe, expect, it, vi } from 'vitest';

import { ActivityPaneComponent } from '#/tui/components/panes/activity-pane';
import type { SessionEventHandler } from '#/tui/controllers/session-event/handler';
import { LioraTUI, type LioraTUIStartupInput, type TUIState } from '#/tui/liora-tui';

interface ActivityDriver {
  state: TUIState;
  sessionEventHandler: SessionEventHandler;
  updateActivityPane(): void;
}

function makeStartupInput(): LioraTUIStartupInput {
  return {
    cliOptions: {
      session: undefined,
      continue: false,
      yolo: false,
      auto: false,
      plan: false,
      model: undefined,
      outputFormat: undefined,
      prompt: undefined,
      skillsDirs: [],
    pluginDirs: [],
    channelServers: [],
    },
    tuiConfig: {
      theme: 'dark',
      locale: 'auto',
      permissionMode: 'yolo',
      disablePasteBurst: false,
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: true },
    },
    version: '0.0.0-test',
    workDir: '/tmp/proj-a',
  };
}

function makeDriverWithTerminalProgress(): {
  driver: ActivityDriver;
  state: TUIState;
  setProgress: ReturnType<typeof vi.fn<(active: boolean) => void>>;
} {
  const setProgress = vi.fn<(active: boolean) => void>();
  const driver = new LioraTUI({} as never, makeStartupInput()) as unknown as ActivityDriver;
  vi.spyOn(driver.state.ui, 'requestRender').mockImplementation(() => {});
  driver.state.terminal = { columns: 80, setProgress } as unknown as TUIState['terminal'];
  driver.state.terminalState.supportsProgress = true;
  return { driver, state: driver.state, setProgress };
}

describe('updateActivityPane terminal progress', () => {
  it('toggles terminal progress when the activity pane enters and leaves work mode', () => {
    vi.useFakeTimers();
    try {
      const { driver, state, setProgress } = makeDriverWithTerminalProgress();

      state.livePane = { ...state.livePane, mode: 'waiting' };
      driver.updateActivityPane();

      expect(setProgress).toHaveBeenCalledTimes(1);
      expect(setProgress).toHaveBeenLastCalledWith(true);
      expect(state.terminalState.progressActive).toBe(true);

      state.livePane = { ...state.livePane, mode: 'idle' };
      driver.updateActivityPane();

      expect(setProgress).toHaveBeenCalledTimes(2);
      expect(setProgress).toHaveBeenLastCalledWith(false);
      expect(state.terminalState.progressActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never emits terminal progress when the terminal does not support OSC 9;4', () => {
    vi.useFakeTimers();
    try {
      const { driver, state, setProgress } = makeDriverWithTerminalProgress();
      state.terminalState.supportsProgress = false;

      state.livePane = { ...state.livePane, mode: 'waiting' };
      driver.updateActivityPane();
      state.livePane = { ...state.livePane, mode: 'idle' };
      driver.updateActivityPane();

      expect(setProgress).not.toHaveBeenCalled();
      expect(state.terminalState.progressActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps compaction visible as terminal progress even though the pane is hidden', () => {
    const { driver, state, setProgress } = makeDriverWithTerminalProgress();
    state.appState.isCompacting = true;
    state.appState.streamingPhase = 'waiting';

    driver.updateActivityPane();
    driver.updateActivityPane();

    expect(setProgress).toHaveBeenCalledTimes(1);
    expect(setProgress).toHaveBeenLastCalledWith(true);

    state.appState.isCompacting = false;
    state.appState.streamingPhase = 'idle';
    driver.updateActivityPane();

    expect(setProgress).toHaveBeenCalledTimes(2);
    expect(setProgress).toHaveBeenLastCalledWith(false);
  });

  it('keeps terminal progress active without showing a thinking spinner', () => {
    vi.useFakeTimers();
    try {
      const { driver, state, setProgress } = makeDriverWithTerminalProgress();
      state.livePane = { ...state.livePane, mode: 'idle' };
      state.appState.streamingPhase = 'thinking';

      driver.updateActivityPane();

      expect(setProgress).toHaveBeenCalledTimes(1);
      expect(setProgress).toHaveBeenLastCalledWith(true);
      expect(state.activitySpinner).toBeNull();
      // The thinking phase mounts the activity pane but runs no spinner
      // (updateActivityPane 'thinking' case: pane added, spinner stopped).
      expect(state.activityContainer.children).toHaveLength(1);
      expect(state.activityContainer.children[0]).toBeInstanceOf(ActivityPaneComponent);

      state.appState.streamingPhase = 'idle';
      driver.updateActivityPane();

      expect(setProgress).toHaveBeenCalledTimes(2);
      expect(setProgress).toHaveBeenLastCalledWith(false);
      expect(state.activitySpinner).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
