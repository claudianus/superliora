import { beforeEach, describe, expect, it } from 'vitest';

import { IDEMPOTENCY_REPLAY_CODE, ToolGuardState } from '../../src/loop';

describe('mutation tool idempotency (Loop26a)', () => {
  let guards: ToolGuardState;

  beforeEach(() => {
    guards = new ToolGuardState();
  });

  it('builds stable keys for identical mutation args', () => {
    const args = { path: 'x.ts', old_string: 'a', new_string: 'b' };
    const a = guards.toolCallIdempotencyKey('Edit', args);
    const b = guards.toolCallIdempotencyKey('Edit', args);
    const c = guards.toolCallIdempotencyKey('Edit', { ...args, new_string: 'c' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('distinguishes large payloads that share a long prefix', () => {
    // A truncated key made these collide, so the second write was skipped as a
    // replay of the first.
    const prefix = 'x'.repeat(4000);
    const first = { path: 'a.ts', content: `${prefix}FIRST` };
    const second = { path: 'a.ts', content: `${prefix}SECOND` };
    expect(guards.toolCallIdempotencyKey('Write', first)).not.toBe(
      guards.toolCallIdempotencyKey('Write', second),
    );
  });

  it('replays prior successful mutation result within the window', () => {
    const args = { path: 'a.ts', content: 'hello' };
    const key = guards.toolCallIdempotencyKey('Write', args);
    expect(guards.checkToolCallIdempotency(key)).toBeUndefined();
    guards.recordToolCallExecution(key, 'Write', args, 'wrote a.ts');
    const prior = guards.checkToolCallIdempotency(key);
    expect(prior).toBeDefined();
    expect(prior?.result).toBe('wrote a.ts');
    expect(prior?.toolName).toBe('Write');
    expect(IDEMPOTENCY_REPLAY_CODE).toBe('IDEMPOTENCY_REPLAY');
  });

  it('clears on turn-boundary reset', () => {
    const args = { patch: '***' };
    const key = guards.toolCallIdempotencyKey('ApplyPatch', args);
    guards.recordToolCallExecution(key, 'ApplyPatch', args, 'ok');
    guards.resetForTurn();
    expect(guards.checkToolCallIdempotency(key)).toBeUndefined();
  });

  it('does not share recorded mutations with another agent', () => {
    const args = { path: 'a.ts', content: 'hello' };
    const key = guards.toolCallIdempotencyKey('Write', args);
    guards.recordToolCallExecution(key, 'Write', args, 'wrote a.ts');
    expect(new ToolGuardState().checkToolCallIdempotency(key)).toBeUndefined();
  });
});
