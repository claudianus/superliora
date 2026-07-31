import { describe, expect, it } from 'vitest';

import {
  CACHE_INVALIDATE_TIP,
  buildCacheSettingsLines,
  cacheInvalidateStatusMessage,
  nextCacheInvalidateEpoch,
  resolveCacheHitFromAppState,
  resolveCacheHitSources,
  resolveCacheSessionGlance,
} from '#/tui/utils/cache/cache-glance';

describe('cache invalidate epoch helpers', () => {
  it('mentions Settings invalidate in the tip', () => {
    expect(CACHE_INVALIDATE_TIP).toContain('Settings → Cache');
  });

  it('bumps epoch from zero or undefined', () => {
    expect(nextCacheInvalidateEpoch(undefined)).toBe(1);
    expect(nextCacheInvalidateEpoch(0)).toBe(1);
    expect(nextCacheInvalidateEpoch(2)).toBe(3);
  });

  it('formats status message with epoch when provided', () => {
    expect(cacheInvalidateStatusMessage(2)).toContain('epoch v2');
    expect(cacheInvalidateStatusMessage()).toBe(CACHE_INVALIDATE_TIP);
  });
});

describe('resolveCacheHitFromAppState', () => {
  it('returns rate and streak when cacheMeter is populated', () => {
    expect(resolveCacheHitFromAppState({ rate: 0.995, streak: 4 })).toEqual({
      rate: 0.995,
      streak: 4,
    });
  });

  it('returns undefined for null, missing, or non-finite rate', () => {
    expect(resolveCacheHitFromAppState(null)).toBeUndefined();
    expect(resolveCacheHitFromAppState(undefined)).toBeUndefined();
    expect(resolveCacheHitFromAppState({ rate: Number.NaN, streak: 0 })).toBeUndefined();
  });
});

describe('resolveCacheHitSources', () => {
  it('prefers live status hit rate and streak over AppState', () => {
    const meter = resolveCacheHitSources({
      appStateCacheMeter: { rate: 0.5, streak: 1 },
      statusHitRate: 0.995,
      statusWarmStreak: 7,
    });
    expect(meter.line).toContain('100%');
    expect(meter.line).toContain('streak×7');
    expect(meter.meetsTarget).toBe(true);
  });

  it('falls back to AppState cacheMeter when status has no hit rate', () => {
    const meter = resolveCacheHitSources({
      appStateCacheMeter: { rate: 0.995, streak: 3 },
    });
    expect(meter.line).toContain('100%');
    expect(meter.line).toContain('streak×3');
  });

  it('returns no-data line when neither source is available', () => {
    expect(resolveCacheHitSources({}).line).toBe('Cache hit: (no data yet)');
  });
});

describe('resolveCacheSessionGlance', () => {
  it('builds live session lines from getStatus hit rate, streak, and freeze', () => {
    const glance = resolveCacheSessionGlance({
      statusHitRate: 0.995,
      statusWarmStreak: 4,
      cacheFrozen: true,
      usage: {
        cacheDiagnostics: { toolBlockChanged: false, toolBlockHash: 'abc', injectionCount: 0, messageCount: 3 },
      },
    });
    expect(glance.hitLine).toContain('streak×4');
    expect(glance.statusLine.text).toContain('Status: warm');
    expect(glance.freezeLine?.text).toBe('Freeze: active (mid-turn)');
    expect(glance.prefixLine?.text).toBe('Prefix: stable');
  });

  it('buildCacheSettingsLines puts session live block before tips', () => {
    const glance = resolveCacheSessionGlance({
      statusHitRate: 0.5,
      statusWarmStreak: 0,
      cacheFrozen: false,
    });
    const lines = buildCacheSettingsLines(glance);
    const liveIdx = lines.findIndex((line) => line.includes('Session (live)'));
    const tipsIdx = lines.findIndex((line) => line.includes('Cache Sacred rules'));
    expect(liveIdx).toBeGreaterThan(-1);
    expect(tipsIdx).toBeGreaterThan(liveIdx);
    expect(lines.some((line) => line.includes('Session cache hit:'))).toBe(true);
    expect(lines.some((line) => line.includes('Invalidate:'))).toBe(true);
    expect(lines.some((line) => line.includes('Freeze policy:'))).toBe(true);
  });
});
