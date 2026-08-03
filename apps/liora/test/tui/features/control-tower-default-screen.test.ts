/**
 * V5-1 — control tower board is the Conductor default screen.
 *
 * Covers: default-screen policy (profile resolution), startup wiring
 * (`finishStartupSession` opens the board for the conductor profile),
 * controller-level mount proof (board becomes the sole UI child), and the
 * frame budget for a full 64-card board repaint.
 */

import { describe, expect, it, vi } from 'vitest';

import { JobBoardApp } from '#/tui/components/job-board/job-board';
import { JobBoardController, type JobBoardHost } from '#/tui/controllers/panes/job-board';
import { finishStartupSession } from '#/tui/controllers/startup-lifecycle/finish';
import {
  isControlTowerDefaultScreenProfile,
  shouldOpenControlTowerAtStartup,
} from '#/tui/features/control-tower/default-screen';
import type {
  ConductorJobCard,
  ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function card(
  id: string,
  status: ConductorJobCard['status'],
  extra: Partial<ConductorJobCard> = {},
): ConductorJobCard {
  return {
    id,
    title: `work on ${id}`,
    status,
    kind: 'task',
    priority: 1,
    updatedAtMs: Date.now(),
    ...extra,
  };
}

function snapshot(overrides: Partial<ConductorJobsSnapshot> = {}): ConductorJobsSnapshot {
  return {
    total: 0,
    queued: 0,
    running: 0,
    blocked: 0,
    needsUser: 0,
    interrupted: 0,
    failed: 0,
    unreadInbox: 0,
    jobs: [],
    inbox: [],
    ...overrides,
  };
}

describe('control tower default screen policy', () => {
  it('boots the control tower only for the conductor profile', () => {
    expect(isControlTowerDefaultScreenProfile('conductor')).toBe(true);
    expect(isControlTowerDefaultScreenProfile('agent')).toBe(false);
    expect(isControlTowerDefaultScreenProfile('coder')).toBe(false);
    expect(isControlTowerDefaultScreenProfile('core')).toBe(false);
  });

  it('resolves conductor as the default profile when nothing is configured', async () => {
    const open = await shouldOpenControlTowerAtStartup({
      getConfigProfile: async () => undefined,
      env: {},
    });
    expect(open).toBe(true);
  });

  it('lets env SUPERLIORA_PROFILE win over config', async () => {
    const open = await shouldOpenControlTowerAtStartup({
      getConfigProfile: async () => 'conductor',
      env: { SUPERLIORA_PROFILE: 'coder' },
    });
    expect(open).toBe(false);
  });

  it('falls back to env resolution when the config read fails', async () => {
    const open = await shouldOpenControlTowerAtStartup({
      getConfigProfile: async () => {
        throw new Error('config offline');
      },
      env: {},
    });
    expect(open).toBe(true);
  });
});

describe('startup wiring opens the control tower default screen', () => {
  function fakeStartupHost(options: { readonly profile?: string } = {}) {
    const session = {
      id: 'sess_1',
      getResumeState: () => undefined,
      getSessionWarnings: async () => [],
      onEvent: () => () => {},
    };
    const state = {
      startupState: 'ready' as string,
      appState: { updateLifecycle: null, sessionId: 'sess_1', isReplaying: false },
      toast: { show: vi.fn() },
      activeDialog: null,
    };
    const host = {
      harness: {
        getConfig: async () => ({ agent: { profile: options.profile } }),
      },
      options: { startup: {} },
      session,
      state,
      aborted: false,
      lastUserInput: undefined,
      promptStash: { toArray: () => [], replaceAll: () => {} },
      signalCleanupHandlers: [],
      isShuttingDown: false,
      eventLoopStarted: true,
      startupNotice: undefined,
      nativeInputRouter: undefined,
      nativeInputModalDispose: undefined,
      clipboardImageHintController: undefined,
      terminalFocusTrackingDispose: undefined,
      fdPath: null,
      fdDownloadStarted: false,
      detachHintClearTimer: undefined,
      sessionLoadingOverlay: undefined,
      nativeRendererDiagnosticsHudEnabled: false,
      reverseRpcDisposers: [],
      disposables: { disposeAll: () => {} },
      transcriptRender: {},
      authFlow: {},
      appearanceController: { dispose: () => {} },
      sessionBrowser: {
        fetchSessions: vi.fn(),
        updateTerminalTitle: vi.fn(),
        applyStartupPermissionAndPlanToAppState: vi.fn(),
        bootstrapFromPicker: vi.fn(),
      },
      sessionReplay: { hydrateFromReplay: vi.fn() },
      sessionEventHandler: { startSubscription: vi.fn() },
      usageMonitor: { start: vi.fn() },
      editorKeyboard: { clearPendingExit: () => {} },
      tasksBrowserController: { close: vi.fn() },
      jobBoardController: { close: vi.fn(), show: vi.fn() },
      promptIntelligence: {},
      dialogs: { stopSessionLoadingPulse: vi.fn() },
      panes: {},
      streamingUI: {},
      requireSession: () => session,
      setSession: async () => {},
      syncRuntimeState: async () => {},
      closeSession: async () => {},
      showStatus: vi.fn(),
      showNotice: vi.fn(),
      showCommandHub: vi.fn(),
      sendNormalUserInput: vi.fn(),
      isSessionLoadingOverlayActive: () => false,
      beginSessionLoading: vi.fn(),
      reportSessionLoading: vi.fn(),
      endSessionLoading: vi.fn(),
      refreshTerminalThemeTracking: vi.fn(),
      appStateController: { supportsCurrentModelCapability: () => true },
      stop: async () => {},
      setupAutocomplete: vi.fn(),
      loadPersistedInputHistory: async () => {},
      refreshDynamicSlashCommands: async () => {},
      updateQueueDisplay: vi.fn(),
    };
    return host;
  }

  it('opens the job desk board as the default screen for conductor sessions', async () => {
    const host = fakeStartupHost({ profile: 'conductor' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await finishStartupSession(host as any, false);
    expect(host.jobBoardController.show).toHaveBeenCalledTimes(1);
  });

  it('keeps the transcript as the first screen for non-conductor profiles', async () => {
    const host = fakeStartupHost({ profile: 'coder' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await finishStartupSession(host as any, false);
    expect(host.jobBoardController.show).not.toHaveBeenCalled();
  });

  it('does not open the board when startup stays in the session picker', async () => {
    const host = fakeStartupHost({ profile: 'conductor' });
    host.state.startupState = 'picker';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await finishStartupSession(host as any, false);
    expect(host.jobBoardController.show).not.toHaveBeenCalled();
  });
});

describe('control tower board mount (default screen render proof)', () => {
  function fakeBoardHost(snap: ConductorJobsSnapshot | undefined) {
    const children: unknown[] = ['transcript', 'activity', 'editor'];
    const ui = {
      children,
      clear: vi.fn(() => {
        children.length = 0;
      }),
      addChild: vi.fn((child: unknown) => {
        children.push(child);
      }),
      setFocus: vi.fn(),
      requestRender: vi.fn(),
    };
    const state = {
      jobBoard: undefined as unknown,
      terminal: { rows: 24, columns: 100, write: () => {} },
      ui,
      editor: { name: 'editor' },
      appState: { conductorJobs: snap },
    };
    const host = {
      state,
      setJobBoard: vi.fn((value: unknown) => {
        state.jobBoard = value;
      }),
      sendNormalUserInput: vi.fn(),
      showStatus: vi.fn(),
    };
    return { host: host as unknown as JobBoardHost, ui, state };
  }

  it('show() swaps the whole screen to the job desk board', () => {
    const snap = snapshot({
      total: 2,
      running: 1,
      queued: 1,
      jobs: [card('job_run1', 'running'), card('job_que1', 'queued')],
    });
    const { host, ui, state } = fakeBoardHost(snap);
    const controller = new JobBoardController(host);

    controller.show();

    expect(ui.clear).toHaveBeenCalledTimes(1);
    expect(ui.children).toHaveLength(1);
    const board = ui.children[0];
    expect(board).toBeInstanceOf(JobBoardApp);
    expect(ui.setFocus).toHaveBeenCalledWith(board);
    expect(ui.requestRender).toHaveBeenCalledWith(true);
    expect(state.jobBoard).toBeDefined();

    // The board renders the full control tower screen as the sole UI child.
    const lines = (board as JobBoardApp).render(100);
    expect(lines).toHaveLength(24);
    const text = stripAnsi(lines.join('\n'));
    expect(text).toContain('CONDUCTOR JOB DESK');
    expect(text).toContain('1 running');
    expect(text).toContain('1 queued');
    expect(text).toContain('job_run1');
  });

  it('close() restores the saved transcript screen and editor focus', () => {
    const { host, ui, state } = fakeBoardHost(snapshot());
    const controller = new JobBoardController(host);
    controller.show();
    controller.close();
    expect(ui.children).toEqual(['transcript', 'activity', 'editor']);
    expect(ui.setFocus).toHaveBeenLastCalledWith(state.editor);
    expect(state.jobBoard).toBeUndefined();
  });
});

describe('control tower frame budget', () => {
  function fullBoardSnapshot(): ConductorJobsSnapshot {
    const statuses: ConductorJobCard['status'][] = [
      'running',
      'needs_user',
      'blocked',
      'queued',
      'interrupted',
      'failed',
      'done',
      'cancelled',
    ];
    const jobs: ConductorJobCard[] = [];
    for (let i = 0; i < 64; i++) {
      const status = statuses[i % statuses.length]!;
      jobs.push(
        card(`job_${String(i).padStart(4, '0')}`, status, {
          priority: (i % 3) + 1,
          worktreePath: `/tmp/wt/job-${String(i)}`,
          progress: {
            phase: 'implementing',
            recentTools: ['Read', 'Edit', 'Bash'],
            lastHeartbeatAt: new Date().toISOString(),
          },
        }),
      );
    }
    return snapshot({
      total: 64,
      running: 8,
      needsUser: 8,
      blocked: 8,
      queued: 8,
      interrupted: 8,
      failed: 8,
      unreadInbox: 3,
      maxConcurrent: 8,
      jobs,
      inbox: Array.from({ length: 24 }, (_, i) => ({
        eventId: `evt_${String(i)}`,
        kind: 'job.completed' as const,
        jobId: `job_${String(i % 64).padStart(4, '0')}`,
        title: `completion notice ${String(i)}`,
        summary: 'worker finished cleanly',
        atMs: Date.now() - i * 1000,
      })),
    });
  }

  function p95(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  }

  it('full 64-card board repaint stays under the 8ms single-event budget', () => {
    const app = new JobBoardApp(
      {
        snapshot: fullBoardSnapshot(),
        selectedJobId: 'job_0000',
        flashMessage: undefined,
        onSelect: () => {},
        onCancel: () => {},
        onInspect: () => {},
      },
      { rows: 40, columns: 120, write: () => {} },
    );
    // Warmup (theme/pulse caches) before measuring.
    for (let i = 0; i < 5; i++) app.render(120);
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      app.render(120);
      samples.push(performance.now() - start);
    }
    const p95Ms = p95(samples);
    // apps/liora AGENTS.md frame budget: a single event repaint under 8ms.
    expect(p95Ms).toBeLessThan(8);
  });

  it('per-event repaint (setProps + render) stays under budget for a 20-event burst', () => {
    const base = fullBoardSnapshot();
    const app = new JobBoardApp(
      {
        snapshot: base,
        selectedJobId: 'job_0000',
        flashMessage: undefined,
        onSelect: () => {},
        onCancel: () => {},
        onInspect: () => {},
      },
      { rows: 40, columns: 120, write: () => {} },
    );
    for (let i = 0; i < 3; i++) app.render(120);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const next = snapshot({
        ...base,
        jobs: base.jobs.map((job, index) =>
          index === i % base.jobs.length
            ? { ...job, updatedAtMs: Date.now(), priority: ((job.priority + 1) % 3) + 1 }
            : job,
        ),
      });
      const start = performance.now();
      app.setProps({
        snapshot: next,
        selectedJobId: 'job_0000',
        flashMessage: undefined,
        onSelect: () => {},
        onCancel: () => {},
        onInspect: () => {},
      });
      app.render(120);
      samples.push(performance.now() - start);
    }
    expect(p95(samples)).toBeLessThan(8);
  });
});
