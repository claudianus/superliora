import { describe, expect, it } from 'vitest';

import type { ManagedKimiCodeModelInfo } from '../src/kimi';
import {
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
  OPEN_PLATFORMS,
  OpenPlatformApiError,
} from '../src/registry/open-platform';

function sampleModel(id: string): ManagedKimiCodeModelInfo {
  return {
    id,
    contextLength: 131072,
    supportsReasoning: false,
    supportsImageIn: false,
    supportsVideoIn: false,
  };
}

describe('oauth/open-platform — pure helpers', () => {
  it('exposes a non-empty OPEN_PLATFORMS list', () => {
    expect(OPEN_PLATFORMS.length).toBeGreaterThan(0);
    for (const p of OPEN_PLATFORMS) {
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
    }
  });

  it('isOpenPlatformId is consistent with OPEN_PLATFORMS', () => {
    for (const p of OPEN_PLATFORMS) {
      expect(isOpenPlatformId(p.id)).toBe(true);
    }
    expect(isOpenPlatformId('not-a-platform')).toBe(false);
  });

  it('getOpenPlatformById returns the matching entry or undefined', () => {
    if (OPEN_PLATFORMS[0] === undefined) throw new Error('OPEN_PLATFORMS[0] is undefined');
    const first = OPEN_PLATFORMS[0];
    expect(getOpenPlatformById(first.id)).toEqual(first);
    expect(getOpenPlatformById('missing')).toBeUndefined();
  });

  it('OpenPlatformApiError is an Error subclass that preserves message and status', () => {
    const err = new OpenPlatformApiError('boom', 503);
    expect(err.message).toBe('boom');
    expect(err.status).toBe(503);
    expect(err).toBeInstanceOf(Error);
  });

  describe('filterModelsByPrefix', () => {
    it('keeps only the models a platform allows by prefix', () => {
      const platform = OPEN_PLATFORMS[0];
      if (platform === undefined) throw new Error('OPEN_PLATFORMS[0] is undefined');
      const allowed = `${platform.allowedPrefixes?.[0] ?? ''}2-preview`;
      const models = [sampleModel(allowed), sampleModel('some-other-model')];
      expect(filterModelsByPrefix(models, platform).map((m) => m.id)).toEqual([allowed]);
    });

    it('passes every model through when the platform declares no prefixes', () => {
      const models = [sampleModel('a'), sampleModel('b')];
      const platform = OPEN_PLATFORMS[0];
      if (platform === undefined) throw new Error('OPEN_PLATFORMS[0] is undefined');
      expect(filterModelsByPrefix(models, { ...platform, allowedPrefixes: [] })).toEqual(models);
    });

    it('returns an empty-array-friendly result for an empty input', () => {
      const platform = OPEN_PLATFORMS[0];
      if (platform === undefined) throw new Error('OPEN_PLATFORMS[0] is undefined');
      expect(filterModelsByPrefix([], platform)).toEqual([]);
    });
  });
});
