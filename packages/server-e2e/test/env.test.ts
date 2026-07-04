import { describe, expect, it } from 'vitest';

import { resolveServerUrl } from '../src/env.js';

describe('resolveServerUrl', () => {
  it('prefers SUPERLIORA_SERVER_URL over legacy KIMI_SERVER_URL', () => {
    expect(
      resolveServerUrl({
        SUPERLIORA_SERVER_URL: 'http://superliora.test:1',
        KIMI_SERVER_URL: 'http://kimi.test:2',
      }),
    ).toBe('http://superliora.test:1');
  });

  it('falls back to KIMI_SERVER_URL then the default local URL', () => {
    expect(resolveServerUrl({ KIMI_SERVER_URL: 'http://kimi.test:2' })).toBe('http://kimi.test:2');
    expect(resolveServerUrl({})).toBe('http://127.0.0.1:58627');
  });
});
