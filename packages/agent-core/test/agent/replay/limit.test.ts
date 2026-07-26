import { describe, expect, it } from 'vitest';

import type { AgentReplayRecord } from '#/rpc/resumed';
import {
  RESUME_REPLAY_TURN_LIMIT,
  isReplayUserTurnRecord,
  limitReplayRecordsByTurn,
} from '#/agent/replay/limit';

const userMessage = (overrides: Record<string, unknown> = {}): AgentReplayRecord => ({
  type: 'message',
  message: {
    role: 'user',
    content: [{ type: 'text', text: 'hi' }],
    ...overrides,
  },
} as unknown as AgentReplayRecord);

const assistantMessage = (): AgentReplayRecord =>
  ({
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  } as unknown as AgentReplayRecord);

const toolMessage = (): AgentReplayRecord =>
  ({
    type: 'message',
    message: { role: 'tool', content: [{ type: 'text', text: 'tool' }] },
  } as unknown as AgentReplayRecord);

describe('agent/replay/limit — RESUME_REPLAY_TURN_LIMIT', () => {
  it('exposes the documented constant', () => {
    expect(RESUME_REPLAY_TURN_LIMIT).toBe(10);
  });
});

describe('agent/replay/limit — isReplayUserTurnRecord', () => {
  it('returns false for non-message records', () => {
    expect(isReplayUserTurnRecord({ type: 'tool', payload: {} } as unknown as AgentReplayRecord)).toBe(false);
  });

  it('returns false for non-user role', () => {
    expect(isReplayUserTurnRecord(assistantMessage())).toBe(false);
    expect(isReplayUserTurnRecord(toolMessage())).toBe(false);
  });

  it('returns true for a user message with no origin', () => {
    expect(isReplayUserTurnRecord(userMessage())).toBe(true);
  });

  it('returns true for a user origin', () => {
    expect(
      isReplayUserTurnRecord(
        userMessage({ origin: { kind: 'user', source: 'user' } }),
      ),
    ).toBe(true);
  });

  it('returns true for skill_activation with user-slash trigger', () => {
    expect(
      isReplayUserTurnRecord(
        userMessage({ origin: { kind: 'skill_activation', trigger: 'user-slash' } }),
      ),
    ).toBe(true);
  });

  it('returns false for skill_activation without user-slash', () => {
    expect(
      isReplayUserTurnRecord(
        userMessage({ origin: { kind: 'skill_activation', trigger: 'auto' } }),
      ),
    ).toBe(false);
  });

  it('returns true for shell_command at input phase', () => {
    expect(
      isReplayUserTurnRecord(
        userMessage({ origin: { kind: 'shell_command', phase: 'input' } }),
      ),
    ).toBe(true);
  });

  it('returns false for synthetic origins', () => {
    expect(
      isReplayUserTurnRecord(
        userMessage({ origin: { kind: 'injection', variant: 'todo_list' } }),
      ),
    ).toBe(false);
    expect(
      isReplayUserTurnRecord(
        userMessage({ origin: { kind: 'compaction_summary' } }),
      ),
    ).toBe(false);
  });
});

describe('agent/replay/limit — limitReplayRecordsByTurn', () => {
  it('returns an empty array when maxTurns <= 0', () => {
    const records = [userMessage()];
    expect(limitReplayRecordsByTurn(records, 0)).toEqual([]);
    expect(limitReplayRecordsByTurn(records, -3)).toEqual([]);
  });

  it('returns the same array when there are fewer user turns than the limit', () => {
    const records = [userMessage(), assistantMessage(), userMessage()];
    expect(limitReplayRecordsByTurn(records, 5)).toBe(records);
  });

  it('keeps only the last N user-turn windows', () => {
    const records = [
      userMessage(), // turn 0 start
      assistantMessage(),
      userMessage(), // turn 1 start
      assistantMessage(),
      userMessage(), // turn 2 start
      assistantMessage(),
      userMessage(), // turn 3 start
    ];
    const result = limitReplayRecordsByTurn(records, 2);
    // turnStarts = [0, 2, 4, 6]; last 2 → slice(4) = records[4..6] (3 items).
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(records[4]);
    expect(result[result.length - 1]).toBe(records[6]);
  });
});
