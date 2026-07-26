import { describe, expect, it } from 'vitest';

import { DEFAULT_SUPERLIORA_OAUTH_HOST, SUPERLIORA_FLOW_CONFIG } from '../src/constants';

describe('oauth/constants — host + flow config', () => {
  it('exposes a non-empty SuperLiora OAuth host as a valid URL', () => {
    expect(DEFAULT_SUPERLIORA_OAUTH_HOST).toMatch(/^https:\/\//);
    expect(() => new URL(DEFAULT_SUPERLIORA_OAUTH_HOST)).not.toThrow();
  });

  it('exposes a flow config object with at least one expected key', () => {
    expect(typeof SUPERLIORA_FLOW_CONFIG).toBe('object');
    expect(SUPERLIORA_FLOW_CONFIG).not.toBeNull();
    expect(Object.keys(SUPERLIORA_FLOW_CONFIG).length).toBeGreaterThan(0);
  });

  it('keeps every URL-shaped field in the flow config as a non-empty string', () => {
    const cfg = SUPERLIORA_FLOW_CONFIG as Record<string, unknown>;
    for (const [key, value] of Object.entries(cfg)) {
      if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        expect(value.length, `expected non-empty URL for ${key}`).toBeGreaterThan(8);
      }
    }
  });
});
