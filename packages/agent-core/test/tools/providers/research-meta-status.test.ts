import { describe, expect, it } from 'vitest';

import {
  SEARXNG_URL_ENV,
  buildMetaChannelStatus,
  researchMetaCh2Tip,
  resolveSearxngUrl,
} from '../../../src/tools/providers/research-meta-status';

describe('research-meta-status', () => {
  it('resolveSearxngUrl prefers config over env', () => {
    const env = { [SEARXNG_URL_ENV]: 'http://127.0.0.1:8080' } as NodeJS.ProcessEnv;
    expect(resolveSearxngUrl(env, 'http://config.example.test/')).toBe(
      'http://config.example.test/',
    );
    expect(resolveSearxngUrl(env)).toBe('http://127.0.0.1:8080');
    expect(resolveSearxngUrl({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('buildMetaChannelStatus reports ready when URL is configured', () => {
    const status = buildMetaChannelStatus({
      env: { [SEARXNG_URL_ENV]: 'http://127.0.0.1:8080' } as NodeJS.ProcessEnv,
    });
    expect(status.configured).toBe(true);
    expect(status.ready).toBe(true);
    expect(status.url).toBe('http://127.0.0.1:8080');
    expect(status.hint).toContain('Ch2 Meta ready');
  });

  it('buildMetaChannelStatus is off without URL', () => {
    const status = buildMetaChannelStatus({ env: {} as NodeJS.ProcessEnv });
    expect(status.ready).toBe(false);
    expect(status.hint).toBe(researchMetaCh2Tip());
  });
});
