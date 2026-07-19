import { describe, expect, it, vi } from 'vitest';

import { handleAquariumCommand } from '#/tui/commands/aquarium';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
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
} {
  const container = new TranscriptViewportComponent(
    0,
    0,
    createTranscriptViewportState(),
    () => transcriptRows,
  );
  const showError = vi.fn();
  const host = {
    state: {
      appState,
      transcriptContainer: container,
      renderer: {
        invalidateFrame: vi.fn(),
      },
    },
    showStatus: vi.fn(),
    showError,
  } as unknown as SlashCommandHost;
  return { host, container, showError };
}

describe('handleAquariumCommand', () => {
  it('overlays Welcome + Welcome-sized tank and hides prior chat', () => {
    const transcriptRows = 30;
    const { host, container } = makeHost(makeAppState(), transcriptRows);
    for (let i = 0; i < 8; i++) {
      container.addChild(new StatusMessageComponent(`line ${String(i)}`));
    }
    expect(container.children.some((c) => c instanceof StatusMessageComponent)).toBe(true);

    handleAquariumCommand(host);

    expect(container.isAquariumOverlayActive).toBe(true);
    expect(container.children.some((c) => c instanceof StatusMessageComponent)).toBe(false);
    expect(container.children.some((c) => c instanceof WelcomeComponent)).toBe(true);
    const tank = container.children.find(
      (c): c is IdleStageComponent => c instanceof IdleStageComponent,
    );
    expect(tank).toBeDefined();
    const painted = tank!.render(80);
    // Welcome-sized: idleTargetRows with Welcome sibling, not the full budget.
    expect(painted.length).toBe(container.idleTargetRows(80));
    expect(painted.length).toBeLessThan(transcriptRows);
  });

  it('restores prior chat when a real message is added', () => {
    const { host, container } = makeHost(makeAppState(), 28);
    container.addChild(new StatusMessageComponent('kept'));
    handleAquariumCommand(host);
    expect(container.isAquariumOverlayActive).toBe(true);
    expect(container.children.filter((c) => c instanceof StatusMessageComponent)).toHaveLength(0);

    container.addChild(new StatusMessageComponent('next'));

    expect(container.isAquariumOverlayActive).toBe(false);
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(false);
    expect(container.children.filter((c) => c instanceof StatusMessageComponent).length).toBe(2);
  });

  it('blocks while session history is replaying', () => {
    const { host, container, showError } = makeHost(makeAppState({ isReplaying: true }));
    handleAquariumCommand(host);
    expect(showError).toHaveBeenCalledOnce();
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(false);
  });
});
