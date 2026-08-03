/**
 * V3-1 — input → JobCreate ACK latency instrumentation.
 *
 * The window opens when `MessageDispatchController.sendMessageInternal`
 * hands a prompt to the session and closes on the first Conductor job event
 * reaching the desk (`job.updated` protocol event or a Job* tool-output
 * backfill that changes the board). Samples feed the p95 ≤ 1s budget check.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JobUpdatedEvent } from '@superliora/protocol';

import {
  MessageDispatchController,
  type MessageDispatchHost,
} from '#/tui/controllers/transcript/message-dispatch';
import {
  INPUT_ACK_P95_BUDGET_MS,
  InputAckLatencyTracker,
  p95Ms,
} from '#/tui/features/control-tower/input-ack-latency';
import { JobBoardStore } from '#/tui/features/control-tower/job-board-store';
import {
  ControlTowerJobDesk,
  type JobDeskEventsHost,
} from '#/tui/features/control-tower/job-desk-events';

import { fakeDispatchHost } from './control-tower-fakes';

let jobSeq = 0;

function makeJobUpdated(overrides: Record<string, unknown> = {}): JobUpdatedEvent {
  jobSeq += 1;
  const event = {
    event: 'job.updated',
    seq: jobSeq,
    at: Date.now(),
    job: {
      id: `job_${jobSeq}`,
      title: 'Test job',
      status: 'queued',
      createdAt: Date.now() - 5_000,
      updatedAt: Date.now(),
      ...overrides,
    },
  };
  return event as unknown as JobUpdatedEvent;
}

function fakeDesk() {
  const host = {
    state: { appState: {}, jobBoard: undefined },
    setAppState: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
  };
  return new ControlTowerJobDesk(host as unknown as JobDeskEventsHost, new JobBoardStore());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InputAckLatencyTracker', () => {
  it('reports an empty, vacuously budget-clean stats snapshot', () => {
    const tracker = new InputAckLatencyTracker();
    expect(tracker.stats()).toEqual({
      count: 0,
      lastMs: undefined,
      maxMs: undefined,
      p95Ms: undefined,
      withinP95Budget: true,
    });
    expect(tracker.pending).toBe(false);
  });

  it('records the delay and closes the window on the first job event', () => {
    const tracker = new InputAckLatencyTracker();
    tracker.markInputSubmitted(1_000);
    expect(tracker.pending).toBe(true);

    expect(tracker.markJobEventReceived(1_350)).toBe(350);
    expect(tracker.pending).toBe(false);
    expect(tracker.samplesSnapshot()).toEqual([350]);
    expect(tracker.stats().lastMs).toBe(350);
  });

  it('ignores job events with no open window', () => {
    const tracker = new InputAckLatencyTracker();
    expect(tracker.markJobEventReceived(9_999)).toBeUndefined();
    expect(tracker.sampleCount).toBe(0);
  });

  it('re-submissions restart the window last-write-wins', () => {
    const tracker = new InputAckLatencyTracker();
    tracker.markInputSubmitted(1_000);
    tracker.markInputSubmitted(2_000);
    expect(tracker.markJobEventReceived(2_100)).toBe(100);
    expect(tracker.samplesSnapshot()).toEqual([100]);
  });

  it('never records negative delays for out-of-order clocks', () => {
    const tracker = new InputAckLatencyTracker();
    tracker.markInputSubmitted(5_000);
    expect(tracker.markJobEventReceived(4_999)).toBe(0);
  });

  it('computes p95 (nearest-rank) and the budget flag', () => {
    expect(p95Ms([])).toBeUndefined();
    expect(p95Ms([42])).toBe(42);
    expect(p95Ms([500, 100, 300, 200, 400])).toBe(500);

    // 96 fast + 4 slow samples: nearest-rank p95 (index 95 of 100) stays fast.
    const within = new InputAckLatencyTracker();
    for (let i = 0; i < 96; i += 1) {
      within.markInputSubmitted(i * 10);
      within.markJobEventReceived(i * 10 + 200);
    }
    for (let i = 0; i < 4; i += 1) {
      within.markInputSubmitted(1_000 + i * 10);
      within.markJobEventReceived(1_000 + i * 10 + 5_000);
    }
    expect(within.stats().p95Ms).toBeLessThanOrEqual(INPUT_ACK_P95_BUDGET_MS);
    expect(within.stats().withinP95Budget).toBe(true);

    // 90 fast + 10 slow samples: p95 crosses the 1s budget.
    const over = new InputAckLatencyTracker();
    for (let i = 0; i < 90; i += 1) {
      over.markInputSubmitted(i * 10);
      over.markJobEventReceived(i * 10 + 200);
    }
    for (let i = 0; i < 10; i += 1) {
      over.markInputSubmitted(1_000 + i * 10);
      over.markJobEventReceived(1_000 + i * 10 + 5_000);
    }
    expect(over.stats().p95Ms).toBeGreaterThan(INPUT_ACK_P95_BUDGET_MS);
    expect(over.stats().withinP95Budget).toBe(false);
    expect(over.stats().maxMs).toBe(5_000);
  });

  it('bounds the sample window to the most recent samples', () => {
    const tracker = new InputAckLatencyTracker({ maxSamples: 3 });
    for (let i = 1; i <= 5; i += 1) {
      tracker.markInputSubmitted(i * 1_000);
      tracker.markJobEventReceived(i * 1_000 + i * 10);
    }
    expect(tracker.samplesSnapshot()).toEqual([30, 40, 50]);
  });
});

describe('ControlTowerJobDesk wiring', () => {
  it('records a sample when a job.updated event follows a submitted input', () => {
    const desk = fakeDesk();
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(10_000);
    desk.markInputSubmitted();
    now.mockReturnValue(10_420);
    desk.handleUpdated(makeJobUpdated());
    now.mockRestore();

    expect(desk.inputAckLatency.stats().count).toBe(1);
    expect(desk.inputAckLatency.stats().lastMs).toBe(420);
  });

  it('also treats a board-changing Job* tool output as the ACK', () => {
    const desk = fakeDesk();
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(20_000);
    desk.markInputSubmitted();
    now.mockReturnValue(20_150);
    const changed = desk.applyToolOutput('Jobs: 2▸ 1… 1? inbox 3\npool: warm=2 maxConcurrent=4');
    now.mockRestore();

    expect(changed).toBe(true);
    expect(desk.inputAckLatency.stats().lastMs).toBe(150);
  });

  it('keeps the window open across job events that precede any input', () => {
    const desk = fakeDesk();
    desk.handleUpdated(makeJobUpdated());
    desk.handleUpdated(makeJobUpdated({ status: 'running' }));
    expect(desk.inputAckLatency.sampleCount).toBe(0);

    desk.markInputSubmitted();
    desk.handleUpdated(makeJobUpdated({ status: 'needs_user' }));
    expect(desk.inputAckLatency.sampleCount).toBe(1);
  });
});

describe('dispatch start hook', () => {
  it('starts the window when a prompt is handed to the session', () => {
    const host = fakeDispatchHost();
    const dispatch = new MessageDispatchController(host as unknown as MessageDispatchHost);

    dispatch.sendNormalUserInput('kick off the docs job');

    expect(host.session.prompt).toHaveBeenCalledWith('kick off the docs job');
    expect(host.controlTowerDesk.markInputSubmitted).toHaveBeenCalledTimes(1);
  });

  it('does not start the window while the input is queued instead of sent', () => {
    const host = fakeDispatchHost({ streamingPhase: 'running' });
    const dispatch = new MessageDispatchController(host as unknown as MessageDispatchHost);

    dispatch.sendNormalUserInput('wait your turn');

    expect(host.session.prompt).not.toHaveBeenCalled();
    expect(host.controlTowerDesk.markInputSubmitted).not.toHaveBeenCalled();
    expect(host.state.queuedMessages).toHaveLength(1);
  });
});
