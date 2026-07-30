import { describe, expect, it } from 'vitest';

import {
  checkSwarmFileLease,
  createSwarmFileLeaseRegistry,
  normalizeLeasePath,
} from '../../src/collaboration/swarm-file-lease';

describe('swarm-file-lease', () => {
  it('claims a path for an owner and lists by runId', () => {
    const registry = createSwarmFileLeaseRegistry({ baseDir: '/work' });
    const claim = registry.claim('src/a.ts', 'expert-a', 'run-1');
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.claim.ownerId).toBe('expert-a');
    expect(claim.claim.path).toBe(normalizeLeasePath('src/a.ts', '/work'));
    expect(registry.listClaims('run-1')).toHaveLength(1);
    expect(registry.listClaims('run-other')).toHaveLength(0);
  });

  it('returns conflict when another owner holds the path and enqueues claimant', () => {
    const registry = createSwarmFileLeaseRegistry({ baseDir: '/work' });
    expect(registry.claim('src/a.ts', 'expert-a', 'run-1').ok).toBe(true);
    const second = registry.claim('src/a.ts', 'expert-b', 'run-1');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.conflict.holder.ownerId).toBe('expert-a');
    expect(second.conflict.queued).toBe(true);
    expect(second.conflict.queuePosition).toBe(1);
    expect(registry.listQueue('src/a.ts')).toHaveLength(1);
    expect(registry.listQueue('src/a.ts')[0]?.ownerId).toBe('expert-b');
  });

  it('FIFO queue: second waiter is position 2; head claims after release', () => {
    const registry = createSwarmFileLeaseRegistry({ baseDir: '/work' });
    expect(registry.claim('src/a.ts', 'expert-a', 'run-1').ok).toBe(true);
    const b = registry.claim('src/a.ts', 'expert-b', 'run-1');
    const c = registry.claim('src/a.ts', 'expert-c', 'run-1');
    expect(b.ok).toBe(false);
    expect(c.ok).toBe(false);
    if (b.ok || c.ok) return;
    expect(b.conflict.queuePosition).toBe(1);
    expect(c.conflict.queuePosition).toBe(2);

    expect(registry.release('src/a.ts', 'expert-a')).toBe(true);
    // Non-head cannot jump the queue
    const cJump = registry.claim('src/a.ts', 'expert-c', 'run-1');
    expect(cJump.ok).toBe(false);
    // Head of queue succeeds
    const bClaim = registry.claim('src/a.ts', 'expert-b', 'run-1');
    expect(bClaim.ok).toBe(true);
    if (!bClaim.ok) return;
    expect(bClaim.claim.ownerId).toBe('expert-b');
    expect(registry.listQueue('src/a.ts').map((w) => w.ownerId)).toEqual(['expert-c']);
  });

  it('allows idempotent re-claim by the same owner+run', () => {
    const registry = createSwarmFileLeaseRegistry({ baseDir: '/work' });
    const first = registry.claim('src/a.ts', 'expert-a', 'run-1');
    const second = registry.claim('src/a.ts', 'expert-a', 'run-1');
    expect(first.ok && second.ok).toBe(true);
  });

  it('releases only when owner matches', () => {
    const registry = createSwarmFileLeaseRegistry({ baseDir: '/work' });
    registry.claim('src/a.ts', 'expert-a', 'run-1');
    expect(registry.release('src/a.ts', 'expert-b')).toBe(false);
    expect(registry.release('src/a.ts', 'expert-a')).toBe(true);
    expect(registry.listClaims('run-1')).toHaveLength(0);
  });

  it('releaseAll clears only the given run and drops its waiters', () => {
    const registry = createSwarmFileLeaseRegistry({ baseDir: '/work' });
    registry.claim('a.ts', 'a', 'run-1');
    registry.claim('a.ts', 'b', 'run-1'); // queued
    registry.claim('b.ts', 'c', 'run-2');
    expect(registry.releaseAll('run-1')).toBe(1);
    expect(registry.listClaims()).toHaveLength(1);
    expect(registry.listClaims()[0]?.runId).toBe('run-2');
    expect(registry.listQueue('a.ts')).toHaveLength(0);
  });

  it('checkSwarmFileLease returns message on conflict and skips without context', () => {
    const registry = createSwarmFileLeaseRegistry({ baseDir: '/work' });
    expect(checkSwarmFileLease('a.ts', undefined, 'run-1', registry)).toBeUndefined();
    expect(checkSwarmFileLease('a.ts', 'owner', undefined, registry)).toBeUndefined();
    registry.claim('a.ts', 'owner-a', 'run-1');
    const msg = checkSwarmFileLease('a.ts', 'owner-b', 'run-1', registry);
    expect(msg).toContain('File lease conflict');
    expect(msg).toContain('owner-a');
    expect(msg).toContain('Queued at position');
  });
});
