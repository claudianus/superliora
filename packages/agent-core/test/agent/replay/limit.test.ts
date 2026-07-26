import { describe, expect, it } from 'vitest';

import {
  limitReplayRecordsByTurn,
  RESUME_REPLAY_TURN_LIMIT,
} from '../../../src/agent/replay/limit';
import type { AgentReplayRecord } from '../../../src/rpc/resumed';
import type { ContextMessage } from '../../../src/agent/context';

function userMessage(text: string): ContextMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    origin: { kind: 'user' },
  };
}

function assistantMessage(text: string): ContextMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
  };
}

function messageRecord(message: ContextMessage, time = 1): AgentReplayRecord {
  return { type: 'message', time, message };
}

describe('limitReplayRecordsByTurn', () => {
  it('keeps the default resume window at 10 turns', () => {
    expect(RESUME_REPLAY_TURN_LIMIT).toBe(10);
  });

  it('returns all records when under the turn limit', () => {
    const records = [
      messageRecord(userMessage('u1')),
      messageRecord(assistantMessage('a1')),
      messageRecord(userMessage('u2')),
      messageRecord(assistantMessage('a2')),
    ];
    expect(limitReplayRecordsByTurn(records, 10)).toEqual(records);
  });

  it('slices from the Nth-last user turn', () => {
    const records: AgentReplayRecord[] = [];
    for (let i = 1; i <= 5; i += 1) {
      records.push(messageRecord(userMessage(`u${i}`), i));
      records.push(messageRecord(assistantMessage(`a${i}`), i));
    }
    const limited = limitReplayRecordsByTurn(records, 2);
    expect(limited).toHaveLength(4);
    expect(limited[0]).toMatchObject({
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'u4' }] },
    });
    expect(limited.at(-1)).toMatchObject({
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'a5' }] },
    });
  });

  it('treats shell ! input as a user-turn anchor but not shell output', () => {
    const records: AgentReplayRecord[] = [
      messageRecord({
        role: 'user',
        content: [{ type: 'text', text: 'old' }],
        origin: { kind: 'user' },
      }),
      messageRecord(assistantMessage('old-a')),
      messageRecord({
        role: 'user',
        content: [{ type: 'text', text: 'ls' }],
        origin: { kind: 'shell_command', phase: 'input' },
      }),
      messageRecord({
        role: 'user',
        content: [{ type: 'text', text: 'out' }],
        origin: { kind: 'shell_command', phase: 'output' },
      }),
      messageRecord(assistantMessage('after')),
    ];
    const limited = limitReplayRecordsByTurn(records, 1);
    expect(limited).toHaveLength(3);
    expect(limited[0]).toMatchObject({
      message: { origin: { kind: 'shell_command', phase: 'input' } },
    });
  });

  it('returns an empty list for non-positive limits', () => {
    const records = [messageRecord(userMessage('u1'))];
    expect(limitReplayRecordsByTurn(records, 0)).toEqual([]);
    expect(limitReplayRecordsByTurn(records, -1)).toEqual([]);
  });
});
