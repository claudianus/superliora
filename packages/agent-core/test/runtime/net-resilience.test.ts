import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BROWSER_USER_AGENTS,
  NetHostCooldownError,
  NetResilienceRegistry,
  backoffMs,
  classifyHttpBlock,
  looksLikeCaptchaBody,
} from '../../src/runtime/net-resilience';

function harness(start = 1_000_000) {
  let now = start;
  const sleeps: number[] = [];
  const registry = new NetResilienceRegistry({
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0.5,
  });
  return { registry, sleeps, advance: (ms: number) => { now += ms; } };
}

describe('classifyHttpBlock', () => {
  it('classifies block statuses and ignores normal ones', () => {
    expect(classifyHttpBlock(429)).toBe('rate_limited');
    expect(classifyHttpBlock(403)).toBe('forbidden');
    expect(classifyHttpBlock(202)).toBe('captcha');
    expect(classifyHttpBlock(500)).toBe('server');
    expect(classifyHttpBlock(503)).toBe('server');
    expect(classifyHttpBlock(200)).toBeUndefined();
    expect(classifyHttpBlock(301)).toBeUndefined();
    // 401 is an auth/config problem, not a transient block.
    expect(classifyHttpBlock(401)).toBeUndefined();
    expect(classifyHttpBlock(404)).toBeUndefined();
  });
});

describe('looksLikeCaptchaBody', () => {
  it('detects bot-wall pages and passes normal html', () => {
    expect(looksLikeCaptchaBody('<html>Please complete the CAPTCHA to continue</html>')).toBe(true);
    expect(looksLikeCaptchaBody('<html>unusual traffic detected</html>')).toBe(true);
    expect(looksLikeCaptchaBody('<html><body>normal results page</body></html>')).toBe(false);
    expect(looksLikeCaptchaBody('')).toBe(false);
  });
});

describe('backoffMs', () => {
  it('stays within [0, base * 2^attempt]', () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cap = 600 * 2 ** attempt;
      expect(backoffMs(attempt, 600, () => 0)).toBe(0);
      expect(backoffMs(attempt, 600, () => 0.9999)).toBeLessThan(cap);
      expect(backoffMs(attempt, 600, () => 0.5)).toBe(Math.floor(cap / 2));
    }
  });
});

describe('NetResilienceRegistry pacing', () => {
  it('never sleeps on the first request to a host', async () => {
    const { registry, sleeps } = harness();
    await registry.pace('example.com', { minIntervalMs: 350, jitterMs: 500 });
    expect(sleeps).toEqual([]);
  });

  it('sleeps the remaining interval plus jitter on a fast repeat', async () => {
    const { registry, sleeps, advance } = harness();
    await registry.pace('example.com', { minIntervalMs: 350, jitterMs: 500 });
    advance(100);
    await registry.pace('example.com', { minIntervalMs: 350, jitterMs: 500 });
    // remaining 250 + jitter 0.5*500=250
    expect(sleeps).toEqual([500]);
  });

  it('does not sleep after a quiet period', async () => {
    const { registry, sleeps, advance } = harness();
    await registry.pace('example.com', { minIntervalMs: 350 });
    advance(10_000);
    await registry.pace('example.com', { minIntervalMs: 350 });
    expect(sleeps).toEqual([]);
  });

  it('paces hosts independently', async () => {
    const { registry, sleeps } = harness();
    await registry.pace('a.com', { minIntervalMs: 350 });
    await registry.pace('b.com', { minIntervalMs: 350 });
    expect(sleeps).toEqual([]);
  });
});

describe('NetResilienceRegistry cooldown', () => {
  it('trips into cooldown after blockThreshold consecutive blocks', () => {
    const { registry } = harness();
    const policy = { blockThreshold: 2, cooldownMs: 60_000 };
    expect(registry.noteBlock('example.com', 'rate_limited', policy)).toBe(false);
    expect(registry.cooldownRemainingMs('example.com')).toBe(0);
    expect(registry.noteBlock('example.com', 'forbidden', policy)).toBe(true);
    expect(registry.cooldownRemainingMs('example.com')).toBe(60_000);
    expect(() => { registry.assertReady('example.com'); }).toThrow(NetHostCooldownError);
  });

  it('recovers after the cooldown window', () => {
    const { registry, advance } = harness();
    const policy = { blockThreshold: 1, cooldownMs: 30_000 };
    registry.noteBlock('example.com', 'captcha', policy);
    expect(registry.snapshot('example.com').coolingDown).toBe(true);
    advance(31_000);
    expect(registry.snapshot('example.com').coolingDown).toBe(false);
    expect(() => { registry.assertReady('example.com'); }).not.toThrow();
  });

  it('resets the consecutive counter on success', () => {
    const { registry } = harness();
    const policy = { blockThreshold: 2, cooldownMs: 60_000 };
    registry.noteBlock('example.com', 'server', policy);
    registry.noteSuccess('example.com');
    expect(registry.noteBlock('example.com', 'server', policy)).toBe(false);
  });

  it('reports a snapshot for unknown hosts without creating state', () => {
    const { registry } = harness();
    expect(registry.snapshot('never-seen.com')).toEqual({
      coolingDown: false,
      cooldownRemainingMs: 0,
      consecutiveBlocks: 0,
    });
  });
});

describe('NetResilienceRegistry user agents', () => {
  it('rotates through the pool round-robin', () => {
    const { registry } = harness();
    const pool = ['ua-a', 'ua-b'];
    expect(registry.pickUserAgent('example.com', pool)).toBe('ua-a');
    expect(registry.pickUserAgent('example.com', pool)).toBe('ua-b');
    expect(registry.pickUserAgent('example.com', pool)).toBe('ua-a');
  });

  it('defaults to the bundled browser UA pool', () => {
    const { registry } = harness();
    const ua = registry.pickUserAgent('example.com');
    expect(DEFAULT_BROWSER_USER_AGENTS).toContain(ua);
  });

  it('bumps the cursor on block so the next attempt presents a new identity', () => {
    const { registry } = harness();
    const pool = ['ua-a', 'ua-b', 'ua-c'];
    expect(registry.pickUserAgent('example.com', pool)).toBe('ua-a');
    registry.noteBlock('example.com', 'forbidden', { blockThreshold: 99 });
    expect(registry.pickUserAgent('example.com', pool)).toBe('ua-c');
  });
});
