import { describe, expect, it } from 'vitest';

import {
  XAI_GROK_API_BASE_URL,
  XAI_GROK_BUILD_BASE_URL,
} from '@superliora/oauth';

import {
  applyXaiGrokRouteToProvider,
  readXaiGrokRouteFromProvider,
} from '#/tui/commands/provider-connect/xai-grok-route';

describe('xai-grok route helpers', () => {
  it('reads Build vs API from camelCase or snake_case base URL', () => {
    expect(
      readXaiGrokRouteFromProvider({ baseUrl: XAI_GROK_BUILD_BASE_URL }),
    ).toBe('build');
    expect(
      readXaiGrokRouteFromProvider({ base_url: XAI_GROK_API_BASE_URL }),
    ).toBe('api');
    expect(readXaiGrokRouteFromProvider(undefined)).toBe('build');
  });

  it('clears Build headers when switching to the API route', () => {
    const next = applyXaiGrokRouteToProvider(
      {
        type: 'openai',
        baseUrl: XAI_GROK_BUILD_BASE_URL,
        customHeaders: {
          'X-XAI-Token-Auth': 'xai-grok-cli',
          'x-grok-client-version': '1.0.0',
        },
        oauth: { storage: 'file', key: 'xai-grok' },
      },
      'api',
    );
    expect(next['baseUrl']).toBe(XAI_GROK_API_BASE_URL);
    expect(next['customHeaders']).toEqual({});
    expect(next['oauth']).toEqual({ storage: 'file', key: 'xai-grok' });
    expect(next['base_url']).toBeUndefined();
  });

  it('restores Build headers when switching back from API', () => {
    const next = applyXaiGrokRouteToProvider(
      {
        type: 'openai',
        baseUrl: XAI_GROK_API_BASE_URL,
        customHeaders: {},
        oauth: { storage: 'file', key: 'xai-grok' },
      },
      'build',
    );
    expect(next['baseUrl']).toBe(XAI_GROK_BUILD_BASE_URL);
    expect(next['customHeaders']).toMatchObject({
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-grok-client-surface': 'grok-build',
    });
  });
});
