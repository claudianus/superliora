import { describe, expect, it } from 'vitest';

import {
  GOAL_NO_PROGRESS_SENSOR_ORIGIN,
  GOAL_NO_PROGRESS_STREAK_K,
  formatGoalNoProgressTip,
} from '../../src/agent/goal';
import {
  buildGoalProgressSignature,
  fingerprintGoalTodos,
} from '../../src/agent/turn/goal-driver';
import { TODO_STORE_KEY } from '../../src/tools/builtin/state/todo-list-store-key';

describe('formatGoalNoProgressTip (Loop31a)', () => {
  it('includes stable prefix, streak, and threshold', () => {
    const tip = formatGoalNoProgressTip(6);
    expect(tip.startsWith('GOAL_NO_PROGRESS:')).toBe(true);
    expect(tip).toContain('6 consecutive');
    expect(tip).toContain(`K=${String(GOAL_NO_PROGRESS_STREAK_K)}`);
    expect(tip).toContain('UpdateGoal(blocked)');
  });

  it('embeds progress signature when provided', () => {
    const tip = formatGoalNoProgressTip(7, 6, 'sig:abc');
    expect(tip).toContain('Signature: sig:abc');
  });

  it('exports stable wire origin code', () => {
    expect(GOAL_NO_PROGRESS_SENSOR_ORIGIN).toBe('goal-no-progress-sensor');
  });
});

describe('buildGoalProgressSignature (AC-C1)', () => {
  function fakeAgent(opts: {
    goalId?: string;
    status?: string;
    turnsUsed?: number;
    todos?: readonly { title: string; status: 'pending' | 'in_progress' | 'done' }[];
  }) {
    const data: Record<string, unknown> = {};
    if (opts.todos !== undefined) data[TODO_STORE_KEY] = opts.todos;
    return {
      goal: {
        getGoal: () => ({
          goal: {
            goalId: opts.goalId ?? 'g1',
            status: opts.status ?? 'active',
            turnsUsed: opts.turnsUsed ?? 0,
            completionCriterion: 'tests pass',
          },
        }),
      },
      tools: {
        getStore: () => ({
          get: (key: string) => data[key] as never,
          set: (key: string, value: unknown) => {
            data[key] = value;
          },
        }),
      },
    } as never;
  }

  it('does not change when only turnsUsed advances', () => {
    const a = buildGoalProgressSignature(fakeAgent({ turnsUsed: 1 }));
    const b = buildGoalProgressSignature(fakeAgent({ turnsUsed: 99 }));
    expect(a).toBe(b);
    expect(a).not.toContain(':99');
  });

  it('changes when TodoList material progress lands', () => {
    const before = buildGoalProgressSignature(
      fakeAgent({ todos: [{ title: 'ship', status: 'pending' }] }),
    );
    const after = buildGoalProgressSignature(
      fakeAgent({ todos: [{ title: 'ship', status: 'done' }] }),
    );
    expect(before).not.toBe(after);
  });

  it('fingerprints todos compactly', () => {
    expect(fingerprintGoalTodos([])).toBe('0');
    expect(fingerprintGoalTodos([{ title: 'a', status: 'done' }])).toContain('d:a');
  });
});
