import nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';

import { beforeEach, describe, expect, it } from 'vitest';

import { IDEMPOTENCY_REPLAY_CODE, ToolGuardState } from '../../src/loop';
// Local mirror of the loop's target fingerprint (not exported): same shape.
async function fingerprintTarget(path: string): Promise<string | undefined> {
  const st = await nodeFs.stat(path).catch(() => undefined);
  if (st === undefined) return undefined;
  return `${String(st.mtimeMs)}:${String(st.size)}`;
}

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

describe('mutation idempotency target fingerprint', () => {
  let guards: ToolGuardState;

  beforeEach(() => {
    guards = new ToolGuardState();
  });

  it('replays only while the mutated file still matches the recorded fingerprint', async () => {
    const dir = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'liora-idem-'));
    const file = nodePath.join(dir, 'a.ts');
    await nodeFs.writeFile(file, 'hello', 'utf8');
    const args = { path: file, content: 'hello' };
    const key = guards.toolCallIdempotencyKey('Write', args);
    const fingerprint = await fingerprintTarget(file);
    expect(fingerprint).toBeDefined();
    guards.recordToolCallExecution(key, 'Write', args, 'wrote a.ts', fingerprint);

    // Unchanged file → replay stays valid.
    expect(guards.checkToolCallIdempotency(key)?.targetFingerprint).toBe(
      await fingerprintTarget(file),
    );

    // External rewrite (formatter/linter/user) → fingerprint changes, so the
    // caller's verify step must treat the cached success as stale.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await nodeFs.writeFile(file, 'changed externally', 'utf8');
    expect(await fingerprintTarget(file)).not.toBe(fingerprint);
    expect(guards.checkToolCallIdempotency(key)?.targetFingerprint).not.toBe(
      await fingerprintTarget(file),
    );
    await nodeFs.rm(dir, { recursive: true, force: true });
  });

  it('records entries without a fingerprint when no target can be identified', () => {
    const args = { note: 'no path field' };
    const key = guards.toolCallIdempotencyKey('Edit', args);
    guards.recordToolCallExecution(key, 'Edit', args, 'ok');
    const prior = guards.checkToolCallIdempotency(key);
    expect(prior?.targetFingerprint).toBeUndefined();
  });
});
