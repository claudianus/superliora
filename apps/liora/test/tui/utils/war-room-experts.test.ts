import { describe, expect, it } from 'vitest';

import {
  formatSessionTraceLines,
  matchWarRoomExpert,
  warRoomMessageMode,
  type WarRoomExpertView,
} from '#/tui/utils/war-room-experts';

const experts: readonly WarRoomExpertView[] = [
  {
    expertId: 'alice',
    name: 'Alice',
    agentId: 'agent-alice',
    phase: 'running',
  },
  {
    expertId: 'bob-qa',
    name: 'Bob',
    agentId: 'agent-bob',
    phase: 'completed',
  },
];

describe('matchWarRoomExpert', () => {
  it('matches by name, id, or agent id', () => {
    expect(matchWarRoomExpert(experts, 'Alice')?.expertId).toBe('alice');
    expect(matchWarRoomExpert(experts, 'bob-qa')?.name).toBe('Bob');
    expect(matchWarRoomExpert(experts, 'agent-bob')?.expertId).toBe('bob-qa');
  });

  it('returns undefined when the query is ambiguous or empty', () => {
    expect(matchWarRoomExpert(experts, '')).toBeUndefined();
    expect(matchWarRoomExpert(experts, 'zzz')).toBeUndefined();
  });
});

describe('warRoomMessageMode', () => {
  it('steers running experts and prompts others', () => {
    expect(warRoomMessageMode('running')).toBe('steer');
    expect(warRoomMessageMode('completed')).toBe('prompt');
    expect(warRoomMessageMode('queued')).toBe('prompt');
  });
});

describe('formatSessionTraceLines', () => {
  it('formats user/assistant text and trims long histories', () => {
    const lines = formatSessionTraceLines(
      [
        { role: 'system', content: [{ type: 'text', text: 'ignore' }] },
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
      ],
      { maxLines: 80 },
    );
    expect(lines).toEqual(['◇ Hello', '◆ Hi there']);
  });
});
