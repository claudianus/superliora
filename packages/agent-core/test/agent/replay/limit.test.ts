import { describe, expect, it } from 'vitest';

import type { ContextMessage, PromptOrigin } from '../../../src/agent/context';
import {
  RESUME_REPLAY_TURN_LIMIT,
  isReplayUserTurnRecord,
  limitReplayRecordsByTurn,
} from '../../../src/agent/replay/limit';
import type { AgentReplayRecord } from '../../../src/rpc/resumed';
import { testAgent } from '../harness/agent';

function message(role: ContextMessage['role'], text: string, origin?: PromptOrigin): AgentReplayRecord {
  return {
    type: 'message',
    time: 1,
    message: {
      role, content: [{ type: 'text', text }], toolCalls: [], origin,
      ...(role === 'tool' ? { toolCallId: 'bash-call' } : {}),
    },
  };
}

const syntheticOrigins: readonly PromptOrigin[] = [
  { kind: 'shell_command', phase: 'output' },
  { kind: 'compaction_summary' },
  { kind: 'system_trigger', name: 'operator-note' },
  { kind: 'background_task', taskId: 'bash-1', status: 'completed', notificationId: 'n-1' },
  { kind: 'retry', trigger: 'operator' },
];

const permission: AgentReplayRecord = { type: 'permission_updated', mode: 'auto', time: 1 };

describe('native replay user-turn anchors', () => {
  it('does not count state changes or non-user messages as user intent', () => {
    expect(isReplayUserTurnRecord(permission)).toBe(false);
    expect(isReplayUserTurnRecord(message('assistant', 'response'))).toBe(false);
    expect(isReplayUserTurnRecord(message('tool', 'output'))).toBe(false);
  });

  it.each([undefined, { kind: 'user' }, { kind: 'shell_command', phase: 'input' }] satisfies readonly (PromptOrigin | undefined)[])(
    'counts explicit user intent for %j',
    (origin) => {
      expect(isReplayUserTurnRecord(message('user', 'input', origin))).toBe(true);
    },
  );

  it.each(syntheticOrigins)('does not count %j as a new user turn', (origin) => {
    expect(isReplayUserTurnRecord(message('user', 'notification', origin))).toBe(false);
  });
});

describe('limitReplayRecordsByTurn', () => {
  it.each([0, -3])('returns no records with a %i-turn window', (limit) => {
    expect(limitReplayRecordsByTurn([message('user', 'input')], limit)).toEqual([]);
  });

  it('copies the array without copying records when under or at the limit', () => {
    const records = [permission, message('user', 'first'), message('assistant', 'reply')];
    for (const limit of [1, 5]) {
      const limited = limitReplayRecordsByTurn(records, limit);
      expect(limited).toEqual(records);
      expect(limited).not.toBe(records);
      expect(limited[0]).toBe(permission);
    }
  });

  it('retains an unanchored stream without inventing user turns', () => {
    const records = [permission, ...syntheticOrigins.map((origin) => message('user', 'event', origin))];
    expect(limitReplayRecordsByTurn(records, 1)).toEqual(records);
  });

  it('keeps complete windows including shell output, notifications and state records', () => {
    const shellInput = message('user', 'pwd', { kind: 'shell_command', phase: 'input' });
    const shellOutput = message('user', '/workspace', { kind: 'shell_command', phase: 'output' });
    const records = [
      permission,
      message('user', 'old input'),
      message('assistant', 'old response'),
      shellInput,
      shellOutput,
      ...syntheticOrigins.slice(1).map((origin) => message('user', 'event', origin)),
      permission,
      message('user', 'latest input', { kind: 'user' }),
      message('assistant', 'latest response'),
    ];
    expect(limitReplayRecordsByTurn(records, 2)).toEqual(records.slice(3));
    expect(limitReplayRecordsByTurn(records, 1)).toEqual(records.slice(-2));
  });
});

describe('ReplayBuilder retention', () => {
  it('keeps records even when keepOnly receives the builder-owned array', () => {
    const { agent } = testAgent({ type: 'sub' });
    agent.records.restore({
      type: 'context.append_message',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [], origin: { kind: 'user' } },
    });
    agent.records.restore({
      type: 'context.append_message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'world' }], toolCalls: [] },
    });
    const built = agent.replayBuilder.buildResult();
    const expected = [...built];
    agent.replayBuilder.keepOnly(built);
    expect(agent.replayBuilder.buildResult()).toEqual(expected);
    agent.replayBuilder.keepOnly(limitReplayRecordsByTurn(built, RESUME_REPLAY_TURN_LIMIT));
    expect(agent.replayBuilder.buildResult()).toEqual(expected);
  });

  it('retains the latest complete user windows while restoring a longer journal', () => {
    const { agent } = testAgent({ type: 'sub' });
    const total = RESUME_REPLAY_TURN_LIMIT + 5;
    for (let i = 1; i <= total; i += 1) {
      for (const [role, text] of [['user', `u${i}`], ['assistant', `a${i}`]] as const) {
        agent.records.restore({
          type: 'context.append_message',
          message: { role, content: [{ type: 'text', text }], toolCalls: [], ...(role === 'user' ? { origin: { kind: 'user' } as const } : {}) },
        });
      }
    }
    const replay = agent.replayBuilder.buildResult();
    expect(replay.filter(isReplayUserTurnRecord)).toHaveLength(RESUME_REPLAY_TURN_LIMIT);
    expect(replay).toHaveLength(RESUME_REPLAY_TURN_LIMIT * 2);
    expect(replay[0]).toMatchObject({ type: 'message', message: { content: [{ type: 'text', text: `u${total - RESUME_REPLAY_TURN_LIMIT + 1}` }] } });
    expect(replay.at(-1)).toMatchObject({ type: 'message', message: { content: [{ type: 'text', text: `a${total}` }] } });
    expect(agent.context.history).toHaveLength(total * 2);
  });
});
