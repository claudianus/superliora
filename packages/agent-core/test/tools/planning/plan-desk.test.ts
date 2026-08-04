/**
 * Plan Desk: Conductor EnterPlanMode delegates to a mission Job.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../../src/agent';
import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '../../../src/profile/main-profile';
import { EnterPlanModeTool } from '../../../src/tools/builtin/planning/enter-plan-mode';
import {
  delegateConductorPlanDesk,
  isConductorPlanDeskLane,
} from '../../../src/tools/builtin/planning/plan-desk';
import { listUnreadJobInbox } from '../../../src/tools/builtin/job/job-inbox';
import { listJobs, patchJob } from '../../../src/tools/builtin/job/job-ledger';
import {
  bindJobWorkerLedger,
  raiseJobNeedsUserForWorker,
  __resetJobWorkerLedgerBridgeForTests,
} from '../../../src/tools/builtin/job/job-worker-ledger-bridge';
import type { ToolStore } from '../../../src/tools/store';
import { executeTool } from '../fixtures/execute-tool';

const signal = new AbortController().signal;

function makeStore(): ToolStore {
  const data = new Map<string, unknown>();
  return {
    get: (key) => data.get(key) as never,
    set: (key, value) => {
      data.set(key, value);
    },
  };
}

function makeConductorAgent(store: ToolStore): Agent {
  let planActive = false;
  return {
    type: 'main',
    config: { profileName: SOVEREIGN_CONDUCTOR_PROFILE_NAME },
    planMode: {
      get isActive() {
        return planActive;
      },
      get isUltraMode() {
        return false;
      },
      get planFilePath() {
        return null;
      },
      enter: vi.fn(async () => {
        planActive = true;
      }),
      cancel: vi.fn(() => {
        planActive = false;
      }),
    },
    ultrawork: { getRun: () => null },
    tools: { toolStore: store },
    subagentHost: undefined,
    telemetry: { track: vi.fn() },
  } as unknown as Agent;
}

describe('Plan Desk', () => {
  it('detects the conductor lane only for main + conductor profile', () => {
    const store = makeStore();
    expect(isConductorPlanDeskLane(makeConductorAgent(store))).toBe(true);
    expect(
      isConductorPlanDeskLane({
        type: 'sub',
        config: { profileName: SOVEREIGN_CONDUCTOR_PROFILE_NAME },
      } as unknown as Agent),
    ).toBe(false);
    expect(
      isConductorPlanDeskLane({
        type: 'main',
        config: { profileName: 'agent' },
      } as unknown as Agent),
    ).toBe(false);
  });

  it('delegateConductorPlanDesk creates a mission Job without entering plan mode', async () => {
    const store = makeStore();
    const agent = makeConductorAgent(store);
    const result = await delegateConductorPlanDesk(agent, {
      ultra: true,
      initialContext: 'Build a Galaga clone',
    });

    expect(agent.planMode.isActive).toBe(false);
    expect(agent.planMode.enter).not.toHaveBeenCalled();
    expect(result.job.kind).toBe('mission');
    expect(result.output).toContain('Plan Desk');
    expect(result.output).toContain(result.job.id);
    expect(listJobs(store)).toHaveLength(1);
    expect(listJobs(store)[0]?.prompt).toContain('Galaga');
  });

  it('EnterPlanMode on conductor delegates and never activates inline plan mode', async () => {
    const store = makeStore();
    const agent = makeConductorAgent(store);
    const result = await executeTool(new EnterPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'tc_desk',
      args: { ultra: true, initial_context: 'Ship a Galaga game' },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Plan Desk');
    expect(result.output).toContain('ACK');
    expect(agent.planMode.isActive).toBe(false);
    expect(agent.planMode.enter).not.toHaveBeenCalled();
    expect(agent.telemetry.track).toHaveBeenCalledWith(
      'plan_enter_resolved',
      expect.objectContaining({ outcome: 'plan_desk_delegated' }),
    );
    expect(listJobs(store)[0]?.kind).toBe('mission');
  });

  it('raiseJobNeedsUserForWorker pushes inbox while keeping running jobs running', async () => {
    __resetJobWorkerLedgerBridgeForTests();
    const store = makeStore();
    const agent = makeConductorAgent(store);
    const created = await delegateConductorPlanDesk(agent, { initialContext: 'Q' });
    patchJob(store, created.job.id, { status: 'running' });
    bindJobWorkerLedger('worker-1', store, created.job.id);
    const raised = raiseJobNeedsUserForWorker('worker-1', { question: 'Canvas or WebGL?' });
    expect(raised?.status).toBe('running');
    expect(raised?.resultSummary).toContain('Canvas');
    expect(listUnreadJobInbox(store).some((e) => e.kind === 'job.needs_user')).toBe(true);
    __resetJobWorkerLedgerBridgeForTests();
  });
});
