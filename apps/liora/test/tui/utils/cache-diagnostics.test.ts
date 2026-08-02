import { describe, expect, it } from 'vitest';

import {
  buildCacheMissDumpExportLines,
  buildCacheMissDumpPayload,
  formatCacheDiagnosticsLine,
  formatCacheMissDumpJson,
  formatCacheMissReasonGlance,
  formatCacheMissReasonHistogram,
  formatCacheMissReasonOpsHealthLine,
  resolveCacheMissReasonHistogram,
  CACHE_MISS_REASON_STUB_TIP,
} from '#/tui/utils/cache/cache-diagnostics';

describe('formatCacheDiagnosticsLine', () => {
  it('returns null when diagnostics are missing', () => {
    expect(formatCacheDiagnosticsLine(undefined)).toBeNull();
    expect(formatCacheDiagnosticsLine(null)).toBeNull();
  });

  it('returns stable line when tool block unchanged', () => {
    expect(formatCacheDiagnosticsLine({ toolBlockChanged: false })).toEqual({
      line: 'Prefix: stable',
      warn: false,
    });
  });

  it('returns warn line when tool block changed', () => {
    expect(formatCacheDiagnosticsLine({ toolBlockChanged: true })).toEqual({
      line: 'Prefix: tool block changed',
      warn: true,
    });
  });
});

describe('formatCacheMissReasonHistogram', () => {
  it('returns null when histogram is empty or missing', () => {
    expect(formatCacheMissReasonHistogram(undefined)).toBeNull();
    expect(formatCacheMissReasonHistogram({})).toBeNull();
    expect(formatCacheMissReasonHistogram({ schema_change: 0 })).toBeNull();
  });

  it('formats live histogram with percentage buckets', () => {
    expect(
      formatCacheMissReasonHistogram({
        schema_change: 2,
        prefix_drift: 1,
        model_switch: 1,
      }),
    ).toEqual({
      line: 'Miss reasons: schema_change 50% · prefix_drift 25% · model_switch 25%',
      warn: true,
    });
  });

  it('resolves nested usage cacheMissReasons and cacheDiagnostics.missReasons', () => {
    const usage = {
      cacheDiagnostics: { missReasons: { prefix_drift: 3 } },
      cacheMissReasons: { model_switch: 1 },
    };
    expect(resolveCacheMissReasonHistogram(usage)).toEqual({
      prefix_drift: 3,
      model_switch: 1,
    });
    expect(formatCacheMissReasonGlance(usage)).toEqual({
      line: 'Miss reasons: prefix_drift 75% · model_switch 25%',
      warn: true,
    });
  });

  it('exposes stub tip constant for Settings when no provider data', () => {
    expect(CACHE_MISS_REASON_STUB_TIP).toContain('schema_change');
    expect(formatCacheMissReasonGlance(undefined)).toBeNull();
  });
});

describe('formatCacheMissReasonOpsHealthLine', () => {
  it('returns null when usage or missReasons are absent', () => {
    expect(formatCacheMissReasonOpsHealthLine(undefined)).toBeNull();
    expect(formatCacheMissReasonOpsHealthLine({})).toBeNull();
    expect(formatCacheMissReasonOpsHealthLine({ cacheDiagnostics: {} })).toBeNull();
  });

  it('maps live usage.cacheDiagnostics.missReasons into Runtime Health line', () => {
    expect(
      formatCacheMissReasonOpsHealthLine({
        cacheDiagnostics: { missReasons: { schema_change: 2, prefix_drift: 1 } },
      }),
    ).toBe('Miss reasons: schema_change 67% · prefix_drift 33%');
  });
});

describe('cache miss dump export', () => {
  it('buildCacheMissDumpPayload exports superliora.cache_miss.v1 schema', () => {
    const payload = buildCacheMissDumpPayload({
      usage: {
        cacheDiagnostics: {
          toolBlockChanged: true,
          missReasons: { schema_change: 3, prefix_drift: 1 },
        },
      },
      cacheHitRate: 0.91,
      cacheWarmStreak: 4,
      cacheFrozen: true,
      capturedAtIso: '2026-08-02T06:00:00.000Z',
    });
    expect(payload.schema).toBe('superliora.cache_miss.v1');
    expect(payload.toolBlockChanged).toBe(true);
    expect(payload.topMissReasons[0]).toEqual({ reason: 'schema_change', count: 3 });
    expect(payload.cacheHitRate).toBe(0.91);
    const json = formatCacheMissDumpJson(payload);
    expect(json).toContain('"schema": "superliora.cache_miss.v1"');
    expect(json).toContain('"capturedAt": "2026-08-02T06:00:00.000Z"');
  });

  it('buildCacheMissDumpExportLines includes JSON copy block', () => {
    const lines = buildCacheMissDumpExportLines({
      usage: {
        cacheDiagnostics: {
          toolBlockChanged: false,
          missReasons: { model_switch: 2 },
        },
      },
      cacheHitRate: 0.5,
      capturedAtIso: '2026-08-02T06:00:00.000Z',
    }).join('\n');
    expect(lines).toContain('Cache miss dump export');
    expect(lines).toContain('Tool block: stable');
    expect(lines).toContain('model_switch×2');
    expect(lines).toContain('Hit rate: 50.0%');
    expect(lines).toContain('JSON (copy)');
    expect(lines).toContain('superliora.cache_miss.v1');
  });
});
