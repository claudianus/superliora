import { afterEach, describe, expect, it } from 'vitest';

import {
  IDEMPOTENCY_REPLAY_CODE,
  checkToolCallIdempotency,
  recordToolCallExecution,
  resetIdempotencyTracker,
  toolCallIdempotencyKey,
} from '../../src/loop';

describe('mutation tool idempotency (Loop26a)', () => {
  afterEach(() => {
    resetIdempotencyTracker();
  });

  it('builds stable keys for identical mutation args', () => {
    const args = { path: 'x.ts', old_string: 'a', new_string: 'b' };
    const a = toolCallIdempotencyKey('Edit', args);
    const b = toolCallIdempotencyKey('Edit', args);
    const c = toolCallIdempotencyKey('Edit', { ...args, new_string: 'c' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('replays prior successful mutation result within the window', () => {
    const args = { path: 'a.ts', content: 'hello' };
    const key = toolCallIdempotencyKey('Write', args);
    expect(checkToolCallIdempotency(key)).toBeUndefined();
    recordToolCallExecution(key, 'Write', args, 'wrote a.ts');
    const prior = checkToolCallIdempotency(key);
    expect(prior).toBeDefined();
    expect(prior?.result).toBe('wrote a.ts');
    expect(prior?.toolName).toBe('Write');
    expect(IDEMPOTENCY_REPLAY_CODE).toBe('IDEMPOTENCY_REPLAY');
  });

  it('clears on turn-boundary reset', () => {
    const args = { patch: '***' };
    const key = toolCallIdempotencyKey('ApplyPatch', args);
    recordToolCallExecution(key, 'ApplyPatch', args, 'ok');
    resetIdempotencyTracker();
    expect(checkToolCallIdempotency(key)).toBeUndefined();
  });
});
