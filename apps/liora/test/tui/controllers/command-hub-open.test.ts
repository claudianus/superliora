import { describe, expect, it, vi } from 'vitest';

import { showCommandHub } from '#/tui/controllers/dialogs/command-hub';
import { ttui } from '#/tui/utils/tui-i18n';
import { createTUIState } from '#/tui/tui-state';
import { createInitialAppState } from '#/tui/utils/initial-app-state';
import { DEFAULT_APPEARANCE_PREFERENCES, DEFAULT_TUI_CONFIG } from '#/tui/config';
import { createTUIStateNativeInputRouter } from '#/tui/features/native-layout/native-input-router';
import type { CommandHubComponent } from '#/tui/components/dialogs/command-hub/index';
import { resetHubRecentsForTests } from '#/tui/utils/command/hub-recents';

describe('showCommandHub', () => {
  it('explains why Hub stays closed over a workspace dialog', () => {
    const showStatus = vi.fn();
    showCommandHub(
      {
        state: { activeDialog: 'files' },
        showStatus,
      } as never,
      {} as never,
    );
    expect(showStatus).toHaveBeenCalledWith(ttui('tui.hub.dialogOpen'), 'info');
  });

  it('prefills Create Job and keeps its prompt editable without dispatching it', () => {
    resetHubRecentsForTests();
    const state = createTUIState({
      initialAppState: createInitialAppState({
        cliOptions: {} as never,
        tuiConfig: { ...DEFAULT_TUI_CONFIG, appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' } },
        version: '0.0.0-test',
        workDir: '/tmp/liora-test',
      }),
      startup: { continueLast: false, yolo: false, auto: false },
    });
    const nativeInputRouter = createTUIStateNativeInputRouter(state, { requestRender: false });
    const host = {
      state,
      nativeInputRouter,
      centerModalSequence: 0,
      nativeInputModalSequence: 0,
      openCommandHub: undefined as CommandHubComponent | undefined,
      getSlashCommands: () => [],
      dispatchSlash: vi.fn(),
      updateEditorBorderHighlight: vi.fn(),
    };
    showCommandHub(host as never, {} as never, { initialQuery: 'create job' });
    host.openCommandHub!.handleInput('\r');
    expect(state.centerModalStack).toHaveLength(0);
    expect(state.editor.getText()).toBe('/job create ');
    expect(host.dispatchSlash).not.toHaveBeenCalled();
    nativeInputRouter.dispatch({ type: 'paste', raw: '', text: 'Inspect the build failure' });
    expect(state.editor.getText()).toBe('/job create Inspect the build failure');
    nativeInputRouter.dispose();
    resetHubRecentsForTests();
  });
});
