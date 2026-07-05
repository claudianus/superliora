import type { SwarmBusMessage } from '@superliora/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import type { Session } from '../../src/session';
import {
  deliverSwarmBusCoordination,
  emitSwarmCollaborationMessage,
  emitSwarmCollaborationMention,
  startSwarmStandupTimer,
  SWARM_STANDUP_INTERVAL_MS,
} from '../../src/session/swarm-bus-coordination';
import { createUltraSwarmRunContext } from '../../src/agent/ultra-swarm-run';
import type { TeamPlan } from '@superliora/protocol';
import { initSwarmRunBus } from '../../src/tools/builtin/state/swarm-bus';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../src/tools/store';

function mockToolStore(): ToolStore {
  const data: Partial<ToolStoreData> = {};
  return {
    get<K extends ToolStoreKey>(key: K): ToolStoreData[K] | undefined {
      return data[key];
    },
    set<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
      data[key] = value;
    },
  };
}

function mockTeam(): TeamPlan {
  return {
    id: 'team_1',
    runId: 'uw_1',
    intensity: 'premium',
    maxExperts: 4,
    experts: [
      {
        id: 'impl-engineer',
        name: 'Impl Engineer',
        role: 'implementation',
        focus: 'implement',
        status: 'running',
        division: 'engineering',
      },
      {
        id: 'security-appsec-engineer',
        name: 'AppSec Engineer',
        role: 'security',
        focus: 'review',
        status: 'running',
        division: 'security',
      },
    ],
  };
}

function mockMessage(
  input: Partial<SwarmBusMessage> & Pick<SwarmBusMessage, 'channel' | 'body'>,
): SwarmBusMessage {
  return {
    id: 'swarm-msg-1',
    runId: 'uw_1',
    parentToolCallId: 'call_uw',
    at: '2026-07-01T00:00:01.000Z',
    from: {
      expertId: 'impl-engineer',
      agentId: 'child-impl',
      name: 'Impl Engineer',
    },
    kind: 'mention',
    ...input,
  };
}

function mockChild(appendSystemReminder = vi.fn()): Agent {
  return {
    turn: { hasActiveTurn: true },
    context: { appendSystemReminder },
  } as unknown as Agent;
}

describe('swarm-bus coordination', () => {
  it('emits ultrawork.collaboration.message on the parent agent', () => {
    const emitEvent = vi.fn();
    const parent = { emitEvent } as unknown as Agent;
    const message = mockMessage({ channel: 'lane', body: 'status update' });

    emitSwarmCollaborationMessage(parent, message);

    expect(emitEvent).toHaveBeenCalledWith({
      type: 'ultrawork.collaboration.message',
      runId: 'uw_1',
      message,
    });
  });

  it('injects mention reminders into active peer subagents', () => {
    const appendMention = vi.fn();
    const appendBlocker = vi.fn();
    const session = {
      getReadyAgent: vi.fn((agentId: string) => {
        if (agentId === 'child-sec') {
          return mockChild(appendMention);
        }
        if (agentId === 'child-impl') {
          return mockChild(appendBlocker);
        }
        return undefined;
      }),
    } as unknown as Session;
    const parent = {
      ultraSwarmRun: createUltraSwarmRunContext({
        runId: 'uw_1',
        parentToolCallId: 'call_uw',
        team: mockTeam(),
        busEnabled: true,
      }),
      turn: { hasActiveTurn: false },
      context: { appendSystemReminder: vi.fn() },
    } as unknown as Agent;
    parent.ultraSwarmRun?.expertAgentIds.set('security-appsec-engineer', 'child-sec');
    parent.ultraSwarmRun?.expertAgentIds.set('impl-engineer', 'child-impl');

    deliverSwarmBusCoordination(
      session,
      parent,
      mockMessage({
        channel: 'direct',
        body: 'Need auth review @security-appsec-engineer',
        to: { expertId: 'security-appsec-engineer' },
      }),
      ['security-appsec-engineer'],
    );

    expect(appendMention).toHaveBeenCalledWith(
      '[Swarm bus mention] Impl Engineer: Need auth review @security-appsec-engineer',
      { kind: 'system_trigger', name: 'swarm-bus-mention' },
    );
    expect(appendBlocker).not.toHaveBeenCalled();
  });

  it('broadcasts blocker reminders to all active staffed subagents', () => {
    const appendSec = vi.fn();
    const appendImpl = vi.fn();
    const appendParent = vi.fn();
    const session = {
      getReadyAgent: vi.fn((agentId: string) => {
        if (agentId === 'child-sec') return mockChild(appendSec);
        if (agentId === 'child-impl') return mockChild(appendImpl);
        return undefined;
      }),
    } as unknown as Session;
    const parent = {
      ultraSwarmRun: createUltraSwarmRunContext({
        runId: 'uw_1',
        parentToolCallId: 'call_uw',
        team: mockTeam(),
        busEnabled: true,
      }),
      turn: { hasActiveTurn: true },
      context: { appendSystemReminder: appendParent },
    } as unknown as Agent;
    parent.ultraSwarmRun?.expertAgentIds.set('security-appsec-engineer', 'child-sec');
    parent.ultraSwarmRun?.expertAgentIds.set('impl-engineer', 'child-impl');

    deliverSwarmBusCoordination(
      session,
      parent,
      mockMessage({
        channel: 'blocker',
        body: '<ignore-me> auth middleware missing tests',
      }),
      [],
    );

    expect(appendSec).toHaveBeenCalledWith(
      '[Swarm bus blocker] Impl Engineer: &lt;ignore-me&gt; auth middleware missing tests',
      { kind: 'system_trigger', name: 'swarm-bus-blocker' },
    );
    expect(appendParent).toHaveBeenCalledWith(
      '[Swarm bus blocker] Impl Engineer: &lt;ignore-me&gt; auth middleware missing tests',
      { kind: 'system_trigger', name: 'swarm-bus-blocker' },
    );
  });

  it('emits ultrawork.collaboration.mention for direct and @mention targets', () => {
    const emitEvent = vi.fn();
    const parent = { emitEvent } as unknown as Agent;
    const message = mockMessage({
      channel: 'direct',
      body: 'Need auth review @security-appsec-engineer',
      to: { expertId: 'security-appsec-engineer' },
    });

    emitSwarmCollaborationMention(parent, message, ['security-appsec-engineer']);

    expect(emitEvent).toHaveBeenCalledWith({
      type: 'ultrawork.collaboration.mention',
      runId: 'uw_1',
      message,
      mentionExpertIds: ['security-appsec-engineer'],
    });
  });

  it('posts periodic standup messages on the configured interval', () => {
    vi.useFakeTimers();
    const emitEvent = vi.fn();
    const appendReminder = vi.fn();
    const session = {
      getReadyAgent: vi.fn(() => mockChild(appendReminder)),
    } as unknown as Session;
    const team = mockTeam();
    const store = mockToolStore();
    initSwarmRunBus(store, { runId: 'uw_1', parentToolCallId: 'call_uw', team });
    const parent = {
      emitEvent,
      ultraSwarmRun: createUltraSwarmRunContext({
        runId: 'uw_1',
        parentToolCallId: 'call_uw',
        team,
        busEnabled: true,
      }),
      turn: { hasActiveTurn: false },
      context: { appendSystemReminder: vi.fn() },
    } as unknown as Agent;
    parent.ultraSwarmRun?.expertAgentIds.set('impl-engineer', 'child-impl');

    const handle = startSwarmStandupTimer(
      session,
      parent,
      store,
      {
        parentAgentId: 'parent-1',
        runId: 'uw_1',
        parentToolCallId: 'call_uw',
      },
      1_000,
    );

    vi.advanceTimersByTime(1_000);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ultrawork.collaboration.message',
        runId: 'uw_1',
        message: expect.objectContaining({
          channel: 'standup',
          body: expect.stringContaining('Periodic standup 1'),
        }),
      }),
    );
    expect(appendReminder).toHaveBeenCalled();

    handle.stop();
    vi.useRealTimers();
    expect(SWARM_STANDUP_INTERVAL_MS).toBe(30 * 60 * 1000);
  });
});
