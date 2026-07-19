import { describe, expect, it, vi } from 'vitest';

import { handleAquariumCommand } from '#/tui/commands/aquarium';
import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { TranscriptViewportComponent } from '#/tui/components/messages/transcript-viewport';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import type { AppState } from '#/tui/types';
import { createTranscriptViewportState } from '#/tui/utils/transcript-viewport';
import { StatusMessageComponent } from '#/tui/components/messages/status-message';

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

function makeHost(appState: AppState): {
  host: SlashCommandHost;
  container: TranscriptViewportComponent;
  showStatus: ReturnType<typeof vi.fn>;
  showError: ReturnType<typeof vi.fn>;
} {
  const container = new TranscriptViewportComponent(0, 0, createTranscriptViewportState(), () => 20);
  const showStatus = vi.fn((message: string, color?: string) => {
    container.addChild(new StatusMessageComponent(message, color as never));
  });
  const showError = vi.fn();
  const host = {
    state: {
      appState,
      transcriptContainer: container,
      renderer: {
        invalidateFrame: vi.fn(),
      },
    },
    showStatus,
    showError,
  } as unknown as SlashCommandHost;
  return { host, container, showStatus, showError };
}

describe('handleAquariumCommand', () => {
  it('mounts Jewel Tank after a restore status when missing', () => {
    const { host, container, showStatus } = makeHost(makeAppState());
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(false);

    handleAquariumCommand(host);

    expect(showStatus).toHaveBeenCalledOnce();
    expect(container.children.some((c) => c instanceof StatusMessageComponent)).toBe(true);
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(true);
    // Idle must come after status so the notice does not dismiss it.
    const idleIndex = container.children.findIndex((c) => c instanceof IdleStageComponent);
    const statusIndex = container.children.findIndex((c) => c instanceof StatusMessageComponent);
    expect(idleIndex).toBeGreaterThan(statusIndex);
  });

  it('keeps the same tank instance when already visible', () => {
    const { host, container, showStatus } = makeHost(makeAppState());
    const tank = new IdleStageComponent({
      state: host.state.appState,
      getPreferredRows: () => 12,
    });
    container.addChild(tank);

    handleAquariumCommand(host);

    expect(showStatus).not.toHaveBeenCalled();
    const idleKids = container.children.filter((c) => c instanceof IdleStageComponent);
    expect(idleKids).toHaveLength(1);
    expect(idleKids[0]).toBe(tank);
  });

  it('blocks while session history is replaying', () => {
    const { host, container, showError } = makeHost(makeAppState({ isReplaying: true }));
    handleAquariumCommand(host);
    expect(showError).toHaveBeenCalledOnce();
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(false);
  });
});
