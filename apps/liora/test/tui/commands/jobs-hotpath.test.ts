/** Operator Job Deck actions call Session RPC without a model fallback. */

import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { routeJobDeckAction } from '#/tui/commands/jobs-deck';
import { handleJobCommand } from '#/tui/commands/jobs';
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


describe('routeJobDeckAction hotpath', () => {
  it('calls session.jobCancel without injecting a model prompt', async () => {
    const host = createHost();
    routeJobDeckAction(host, 'cancel', card());
    await vi.waitFor(() => {
      expect(host._mocks.jobCancel).toHaveBeenCalledWith({ jobId: 'job_abcd1234' });
    });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalled();
  });


  it('shows error and does not fall back to LLM when cancel RPC fails', async () => {
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
    const host = createHost();
    handleJobCommand(host, 'resume');
    await vi.waitFor(() => {
      expect(host._mocks.jobResume).toHaveBeenCalledWith({});
    });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });
});

describe('explicit operator Job actions', () => {
  function operatorHost() {
    const source = {
      id: 'job_source',
      title: 'Fix startup',
      resultSummary: 'Startup handling changed',
    };
    const session = {
      jobCreate: vi.fn(async (_input: unknown) => ({ jobs: [], text: 'Job queued' })),
      jobInspect: vi.fn(async (_id: string) => ({ job: source, text: '' })),
      jobPush: vi.fn(async (_input: unknown) => ({ ok: true, text: 'Push queued', error: undefined as string | undefined })),
    };
    const host = {
      requireSession: () => session,
      showStatus: vi.fn(),
      showError: vi.fn(),
      sendNormalUserInput: vi.fn(),
    };
    return { host: host as unknown as SlashCommandHost & typeof host, session };
  }

  it('creates a requested autonomous task directly through Session', async () => {
    const { host, session } = operatorHost();
    handleJobCommand(host, 'create Fix startup');
    await vi.waitFor(() => expect(session.jobCreate).toHaveBeenCalledWith({
      title: 'Fix startup', prompt: 'Fix startup', kind: 'task',
    }));
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it.each(['review', 'verify'] as const)('creates an explicit %s child with user instructions and factual context', async (action) => {
    const { host, session } = operatorHost();
    handleJobCommand(host, `${action} job_source Check the startup path`);
    await vi.waitFor(() => expect(session.jobCreate).toHaveBeenCalledWith({
      title: `${action === 'review' ? 'Review' : 'Verify'}: Fix startup`,
      kind: 'verify',
      parentJobId: 'job_source',
      prompt: 'Check the startup path\n\nSource Job: job_source — Fix startup\nWorker summary (context, not verification):\nStartup handling changed',
    }));
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('publishes only after an explicit push request', async () => {
    const { host, session } = operatorHost();
    handleJobCommand(host, 'push job_source');
    await vi.waitFor(() => expect(session.jobPush).toHaveBeenCalledWith({
      jobId: 'job_source', approve: true, forceUserConfirm: true,
    }));
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('reports a rejected publish request without a model fallback', async () => {
    const { host, session } = operatorHost();
    session.jobPush.mockResolvedValueOnce({ ok: false, text: 'Publish blocked', error: 'Branch unavailable' });
    handleJobCommand(host, 'push job_source');
    await vi.waitFor(() => expect(host.showError).toHaveBeenCalledWith('Branch unavailable'));
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it.each(['create', 'review', 'verify', 'push'])('shows usage for %s without starting work', (action) => {
    const { host, session } = operatorHost();
    handleJobCommand(host, action);
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining(`Usage: /job ${action}`));
    expect(session.jobCreate).not.toHaveBeenCalled();
    expect(session.jobPush).not.toHaveBeenCalled();
  });
});
