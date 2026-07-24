import { describe, expect, it, vi } from 'vitest';

import { handleFeedCommand } from '#/tui/commands/feed';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { StatusMessageComponent } from '#/tui/components/messages/status-message';
import { TranscriptViewportComponent } from '#/tui/components/messages/transcript-viewport';
import type { AppState } from '#/tui/types';
import { createTranscriptViewportState } from '#/tui/utils/transcript-viewport';

function makeAppState(overrides?: Partial<AppState>): AppState {
  return {
    version: '1.2.3',
    workDir: '/tmp/project',
    additionalDirs: [],
    sessionId: 'ses-1',
    sessionTitle: null,
    model: 'kimi-k2',
    permissionMode: 'manual',
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    planMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    theme: 'dark',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    availableModels: {},
    availableProviders: {},
    mcpServersSummary: null,
    ...overrides,
  };
}

function makeHost(appState: AppState, transcriptRows = 24): {
  host: SlashCommandHost;
  container: TranscriptViewportComponent;
  showError: ReturnType<typeof vi.fn>;
  showStatus: ReturnType<typeof vi.fn>;
  invalidateFrame: ReturnType<typeof vi.fn>;
} {
  const container = new TranscriptViewportComponent(
    0,
    0,
    createTranscriptViewportState(),
    () => transcriptRows,
  );
  const showError = vi.fn();
  const showStatus = vi.fn();
  const invalidateFrame = vi.fn();
  const host = {
    state: {
      appState,
      transcriptContainer: container,
      terminal: { columns: 80, rows: transcriptRows },
      renderer: {
        invalidateFrame,
      },
    },
    showStatus,
    showError,
  } as unknown as SlashCommandHost;
  return { host, container, showError, showStatus, invalidateFrame };
}

describe('handleFeedCommand', () => {
  it('drops food into the visible tank at an in-bounds column', () => {
    const { host, container, showStatus, showError, invalidateFrame } = makeHost(makeAppState());
    const tank = new IdleStageComponent({ state: makeAppState() });
    container.addChild(tank);
    const drop = vi.spyOn(tank, 'tryDropFoodAtContent').mockReturnValue(true);

    handleFeedCommand(host);

    expect(drop).toHaveBeenCalledOnce();
    const col = drop.mock.calls[0]?.[0];
    expect(col).toBeGreaterThanOrEqual(2);
    expect(showStatus).toHaveBeenCalledOnce();
    expect(showError).not.toHaveBeenCalled();
    expect(invalidateFrame).toHaveBeenCalledWith('layout');
  });

  it('feeds through the real tank sim once a render initializes it', () => {
    const { host, container, showStatus, showError } = makeHost(makeAppState());
    container.addChild(new IdleStageComponent({ state: makeAppState() }));

    handleFeedCommand(host);

    expect(showError).not.toHaveBeenCalled();
    expect(showStatus).toHaveBeenCalledOnce();
  });

  it('reports the tank-full error when the drop is rejected', () => {
    const { host, container, showStatus, showError } = makeHost(makeAppState());
    const tank = new IdleStageComponent({ state: makeAppState() });
    container.addChild(tank);
    vi.spyOn(tank, 'tryDropFoodAtContent').mockReturnValue(false);

    handleFeedCommand(host);

    expect(showError).toHaveBeenCalledOnce();
    expect(showStatus).not.toHaveBeenCalled();
  });

  it('errors when no tank is visible', () => {
    const { host, container, showError, showStatus } = makeHost(makeAppState());
    container.addChild(new StatusMessageComponent('chat'));

    handleFeedCommand(host);

    expect(showError).toHaveBeenCalledOnce();
    expect(showStatus).not.toHaveBeenCalled();
  });

  it('blocks while session history is replaying', () => {
    const { host, container, showError, showStatus } = makeHost(
      makeAppState({ isReplaying: true }),
    );
    container.addChild(new IdleStageComponent({ state: makeAppState() }));

    handleFeedCommand(host);

    expect(showError).toHaveBeenCalledOnce();
    expect(showStatus).not.toHaveBeenCalled();
  });
});
