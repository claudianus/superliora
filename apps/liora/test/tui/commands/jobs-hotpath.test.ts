/**
 * Conductor UX v2 Job Deck /job hotpath — Session.job* RPC, no LLM fallback.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { routeJobDeckAction } from '#/tui/commands/jobs-deck';
import { handleJobCommand } from '#/tui/commands/jobs';
import {
  setExperimentalFeatures,
} from '#/tui/commands/experimental-flags';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';

function card(id = 'job_abcd1234'): ConductorJobCard {
  return {
    id,
    title: 'fix flaky test',
    status: 'running',
    kind: 'task',
    priority: 1,
    updatedAtMs: Date.now(),
  };
}

function createHost(jobCancel?: ReturnType<typeof vi.fn>) {
  const cancel =
    jobCancel ??
    vi.fn(async () => ({
      ok: true,
      text: 'cancelled',
    }));
  const jobResume = vi.fn(async () => ({
    ok: true,
    resumed: [],
    text: 'resumed 0',
  }));
  const jobSteer = vi.fn(async () => ({
    ok: true,
    text: 'steered',
  }));
  return {
    showStatus: vi.fn(),
    showError: vi.fn(),
    showNotice: vi.fn(),
    sendNormalUserInput: vi.fn(),
    restoreEditor: vi.fn(),
    mountEditorReplacement: vi.fn(),
    setAppState: vi.fn(),
    requireSession: () => ({
      jobCancel: cancel,
      jobResume,
      jobSteer,
      jobList: vi.fn(async () => []),
      jobInspect: vi.fn(async () => undefined),
      jobInbox: vi.fn(async () => ({ events: [], marked: 0, text: '' })),
      jobGcWorktrees: vi.fn(async () => ({ removedJobIds: [], removed: 0, kept: 0 })),
    }),
    session: {},
    state: {
      appState: { conductorJobs: undefined },
      livePane: { pendingApproval: null, pendingQuestion: null },
      renderer: { requestRender: vi.fn() },
    },
    jobBoardController: { openDeck: vi.fn() },
    controlTowerDesk: { markInboxRead: vi.fn(), maybeShowInterruptedBanner: vi.fn() },
    _mocks: { jobCancel: cancel, jobResume, jobSteer },
  } as unknown as SlashCommandHost & {
    showStatus: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    sendNormalUserInput: ReturnType<typeof vi.fn>;
    restoreEditor: ReturnType<typeof vi.fn>;
    _mocks: {
      jobCancel: ReturnType<typeof vi.fn>;
      jobResume: ReturnType<typeof vi.fn>;
      jobSteer: ReturnType<typeof vi.fn>;
    };
  };
}

afterEach(() => {
  setExperimentalFeatures([]);
});

describe('routeJobDeckAction hotpath', () => {
  it('calls session.jobCancel when conductor_ux_v2 is on — no LLM fallback', async () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: true }]);
    const host = createHost();
    routeJobDeckAction(host, 'cancel', card());
    await vi.waitFor(() => {
      expect(host._mocks.jobCancel).toHaveBeenCalledWith({ jobId: 'job_abcd1234' });
    });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalled();
  });

  it('injects LLM prompt when conductor_ux_v2 is off', () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: false }]);
    const host = createHost();
    routeJobDeckAction(host, 'cancel', card());
    expect(host._mocks.jobCancel).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledOnce();
  });

  it('shows error and does not fall back to LLM when cancel RPC fails', async () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: true }]);
    const jobCancel = vi.fn(async () => {
      throw new Error('rpc down');
    });
    const host = createHost(jobCancel);
    routeJobDeckAction(host, 'cancel', card());
    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalled();
    });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });
});

describe('/job resume hotpath', () => {
  it('resumes all via RPC when id omitted', async () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: true }]);
    const host = createHost();
    handleJobCommand(host, 'resume');
    await vi.waitFor(() => {
      expect(host._mocks.jobResume).toHaveBeenCalledWith({});
    });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });
});
