import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import {
  MISSION_EVIDENCE_SENSOR_TIPS,
  MISSION_IMPORT_PATH_TIPS,
  MISSION_PROTOCOL_ALIAS_TIPS,
  MISSION_RESUME_E2E_TIP,
  missionDualEmitStatusLine,
  missionMdArtifactTip,
  showMissionSettings,
} from '#/tui/commands/config/mission/mission-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { readGoalQueue } from '#/tui/goal-queue-store';
import { MISSION_DUAL_EMIT_ENV } from '@superliora/sdk';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

vi.mock('#/tui/goal-queue-store', () => ({
  readGoalQueue: vi.fn(async () => ({ goals: [] })),
}));

describe('mission evidence sensor tips', () => {
  it('documents soft advisory and RunProjectChecks PostToolUse sensor', () => {
    const text = MISSION_EVIDENCE_SENSOR_TIPS.join('\n');
    expect(text).toContain('soft advisory');
    expect(text).toContain('RunProjectChecks');
    expect(text).toContain('hard-blocks');
    expect(text).toContain('W6 soft sensor');
    expect(text).toContain('non-blocking');
  });
});

describe('mission resume e2e tip', () => {
  it('documents artifact-only resume path for mission-resume-smoke', () => {
    expect(MISSION_RESUME_E2E_TIP).toContain('/mission resume');
    expect(MISSION_RESUME_E2E_TIP).toContain('mission-resume-smoke');
  });
});

describe('mission protocol alias tips', () => {
  it('documents env-gated dual-emit and read-side normalize', () => {
    const text = MISSION_PROTOCOL_ALIAS_TIPS.join('\n');
    expect(text).toContain(MISSION_DUAL_EMIT_ENV);
    expect(text).toContain('SUPERLIORA_SOVEREIGN=1');
    expect(text).toContain('never journal');
    expect(text).toContain('normalize');
    expect(text).toContain('golden sequences');
  });

  it('documents import-path soft rename via mission facade', () => {
    const text = MISSION_IMPORT_PATH_TIPS.join('\n');
    expect(text).toContain('Compat aliases');
    expect(text).toContain('#/mission');
    expect(text).toContain('@superliora/sdk/mission');
    expect(text).toContain('not #/ultrawork');
    expect(text).toContain('mission-contract');
    expect(text).toContain('not commands/ultrawork/ultrawork-contract');
  });

  it('missionDualEmitStatusLine reports OFF by default', () => {
    expect(missionDualEmitStatusLine({})).toContain('OFF');
  });
});

describe('missionMdArtifactTip', () => {
  it('reports present when MISSION.md exists under workDir', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'mission-md-'));
    try {
      writeFileSync(join(workDir, 'MISSION.md'), '# objective\n');
      expect(missionMdArtifactTip(workDir)).toContain('present');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('reports not found when MISSION.md is missing', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'mission-md-'));
    try {
      expect(missionMdArtifactTip(workDir)).toContain('not found');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

function makeHost(options: {
  getUltraworkRun?: () => Promise<Record<string, unknown> | null>;
  getGoal?: () => Promise<{ goal: Record<string, unknown> | null }>;
  readGoalQueue?: () => Promise<{ goals: readonly unknown[] }>;
  appState?: Record<string, unknown>;
  hasSession?: boolean;
} = {}) {
  const session = {
    id: 'ses_mission',
    summary: { sessionDir: '/tmp/ses_mission' },
    getUltraworkRun:
      options.getUltraworkRun ??
      vi.fn(async () => ({
        id: 'run-1',
        objective: 'Wire live mission glance',
        status: 'running',
        stage: 'plan',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    getGoal:
      options.getGoal ??
      vi.fn(async () => ({
        goal: {
          goalId: 'g-live',
          objective: 'Verify settings panel',
          status: 'active',
          turnsUsed: 2,
          tokensUsed: 500,
          wallClockMs: 1000,
          budget: {
            tokenBudget: null,
            turnBudget: null,
            wallClockBudgetMs: null,
            remainingTokens: null,
            remainingTurns: null,
            remainingWallClockMs: null,
            tokenBudgetReached: false,
            turnBudgetReached: false,
            wallClockBudgetReached: false,
            overBudget: false,
          },
        },
      })),
  };

  return {
    state: {
      appState: {
        workDir: '/tmp/proj',
        ultraworkMode: true,
        goal: null,
        ...options.appState,
      },
      centerModalStack: [],
      transcriptContainer: { addChild: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => session),
  } as unknown as SlashCommandHost;
}

describe('showMissionSettings', () => {
  it('shows live mission run, active goal, and queue count when session is wired', async () => {
    vi.mocked(readGoalQueue).mockResolvedValueOnce({
      goals: [{ id: 'q1', objective: 'next', createdAt: '', updatedAt: '' }],
    });

    const host = makeHost();
    showMissionSettings(host);
    await vi.waitFor(() => {
      expect(host.mountCenterModal).toHaveBeenCalled();
    });
    const picker = vi.mocked(host.mountCenterModal).mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    // presets=0, status=1
    picker.handleInput('\u001B[B');
    picker.handleInput('\r');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Mission run: active · stage plan');
    expect(text).toContain('Active goal: active · turns 2 · tokens 500');
    expect(text).toContain('Upcoming goals: 1 queued goal');
    expect(text).toContain('Mission Resume: artifacts');
  });

  it('falls back when session is unavailable', async () => {
    const host = makeHost({ hasSession: false, appState: { ultraworkMode: false } });
    showMissionSettings(host);
    await vi.waitFor(() => {
      expect(host.mountCenterModal).toHaveBeenCalled();
    });
    const picker = vi.mocked(host.mountCenterModal).mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    // presets=0, status=1
    picker.handleInput('\u001B[B');
    picker.handleInput('\r');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Mission run: (session unavailable)');
    expect(text).toContain('Active goal: (session unavailable)');
    expect(text).toContain('Upcoming goals: (session unavailable)');
  });
});
