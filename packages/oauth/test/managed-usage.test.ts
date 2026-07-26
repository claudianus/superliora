import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SUPERLIORA_BASE_URL,
  formatDuration,
  formatResetTime,
  isManagedKimiCode,
  kimiCodeBaseUrl,
  kimiCodeUsageUrl,
  parseManagedUsagePayload,
} from '../src/managed-usage';

describe('oauth/managed-usage — pure helpers', () => {
  it('exposes the canonical SuperLiora base URL constant', () => {
    expect(DEFAULT_SUPERLIORA_BASE_URL).toBe('https://api.kimi.com/coding/v1');
  });

  describe('isManagedKimiCode', () => {
    it('rejects unrelated or empty values', () => {
      expect(isManagedKimiCode('openai')).toBe(false);
      expect(isManagedKimiCode('')).toBe(false);
      expect(isManagedKimiCode(undefined)).toBe(false);
      expect(isManagedKimiCode(null)).toBe(false);
    });
  });

  it('kimiCodeBaseUrl and kimiCodeUsageUrl return https URLs on the same host', () => {
    const base = new URL(kimiCodeBaseUrl());
    const usage = new URL(kimiCodeUsageUrl());
    expect(base.protocol).toBe('https:');
    expect(usage.protocol).toBe('https:');
    expect(usage.host).toBe(base.host);
  });

  describe('formatDuration', () => {
    it('omits day and second segments when zero', () => {
      expect(formatDuration(2 * 86400 + 3 * 3600 + 4 * 60)).toBe('2d 3h 4m');
    });

    it('returns 0s for zero', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('handles negative inputs by coercing to zero', () => {
      expect(formatDuration(-30)).toBe('0s');
    });
  });

  describe('formatResetTime', () => {
    it('returns a "resets at …" message for empty input', () => {
      expect(formatResetTime('')).toMatch(/resets at /);
    });

    it('returns a "resets at …" message for non-numeric input', () => {
      expect(formatResetTime('not-a-number')).toBe('resets at not-a-number');
    });

    it('returns a "resets at …" message for numeric input', () => {
      expect(formatResetTime('1700000000')).toBe('resets at 1700000000');
    });
  });

  describe('parseManagedUsagePayload', () => {
    it('returns a graceful empty result for an empty payload', () => {
      const result = parseManagedUsagePayload({});
      expect(result.limits).toEqual([]);
    });

    it('returns an empty limits list for null/undefined', () => {
      expect(parseManagedUsagePayload(null).limits).toEqual([]);
      expect(parseManagedUsagePayload(undefined).limits).toEqual([]);
    });
  });
});
