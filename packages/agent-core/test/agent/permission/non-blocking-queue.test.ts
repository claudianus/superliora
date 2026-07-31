import { describe, expect, it } from 'vitest';

import { NonBlockingPermissionQueue } from '../../../src/agent/permission/non-blocking-queue';

describe('NonBlockingPermissionQueue', () => {
  it('enqueues, lists, resolves, and tracks pending count', () => {
    const queue = new NonBlockingPermissionQueue();

    const first = queue.enqueue({
      toolName: 'Bash',
      rule: 'bash(*)',
      risk: 'high',
    });
    const second = queue.enqueue({
      toolName: 'Write',
      rule: 'write(*)',
      risk: 'low',
    });

    expect(first.id).toMatch(/^perm-\d+$/);
    expect(first.enqueuedAtMs).toBeTypeOf('number');
    expect(queue.pendingCount()).toBe(2);
    expect(queue.snapshot()).toEqual({ count: 2, items: [first, second] });
    expect(queue.list()).toEqual([first, second]);

    const resolved = queue.resolve(first.id, 'approved');
    expect(resolved).toEqual(first);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.snapshot()).toEqual({ count: 1, items: [second] });
    expect(queue.list()).toEqual([second]);
    expect(queue.resolve('missing', 'denied')).toBeUndefined();
  });

  it('auto-expires stale entries', () => {
    const queue = new NonBlockingPermissionQueue();
    const item = queue.enqueue({
      toolName: 'Read',
      rule: 'read(*)',
      risk: 'low',
    });

    expect(queue.autoExpire(1, item.enqueuedAtMs + 1)).toBe(1);
    expect(queue.pendingCount()).toBe(0);
  });

  it('skips in-flight ids during auto-expire', () => {
    const queue = new NonBlockingPermissionQueue();
    const inFlight = queue.enqueue({
      toolName: 'Bash',
      rule: 'bash(*)',
      risk: 'high',
    });
    const orphan = queue.enqueue({
      toolName: 'Read',
      rule: 'read(*)',
      risk: 'low',
    });

    const expired = queue.autoExpire(1, orphan.enqueuedAtMs + 1, {
      skipIds: new Set([inFlight.id]),
    });

    expect(expired).toBe(1);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.list()[0]?.id).toBe(inFlight.id);
  });

  it('allows multiple pending entries while approvals wait', () => {
    const queue = new NonBlockingPermissionQueue();

    const first = queue.enqueue({
      toolName: 'Bash',
      rule: 'bash(*)',
      risk: 'high',
    });
    const second = queue.enqueue({
      toolName: 'Write',
      rule: 'write(*)',
      risk: 'low',
    });
    const third = queue.enqueue({
      toolName: 'Read',
      rule: 'read(*)',
      risk: 'low',
    });

    expect(queue.pendingCount()).toBe(3);
    expect(queue.list()).toEqual([first, second, third]);
    expect(queue.resolve(first.id, 'approved')).toEqual(first);
    expect(queue.pendingCount()).toBe(2);
  });
});
